import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SceneDocument } from "@furnace/core/scene";
import { EditorError } from "./errors.ts";
import type { RegistryLoader } from "./registry-bundle.ts";
import { readScene } from "./scenes.ts";
import type { WatchFile } from "./watch.ts";

const UNDO_CAP = 100;

export type SessionEvent =
  | { type: "scene-opened"; path: string; revision: number }
  | { type: "document-changed"; revision: number; command: string }
  | { type: "saved"; revision: number }
  | { type: "file-conflict"; path: string }
  | { type: "file-invalid"; path: string; message: string };

export type SessionView = {
  document: SceneDocument;
  path: string;
  revision: number;
  dirty: boolean;
  conflict: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export type SessionDeps = {
  root: string;
  watchFile: WatchFile;
  registry: RegistryLoader;
  emit(event: SessionEvent): void;
  /**
   * File reader for the watch-reload path. Defaults to `node:fs/promises`
   * `readFile`; injected only so tests can control the mid-`await` interleaving
   * that the `onFileChanged` staleness guards protect against.
   */
  readTextFile?: (path: string, encoding: "utf8") => Promise<string>;
};

export type Session = {
  open(path: string, force: boolean): Promise<SessionView>;
  get(): SessionView;
  save(): Promise<SessionView>;
  /** The transactional core: clone → edit → validate → commit-or-reject. */
  apply(
    command: string,
    edit: (doc: SceneDocument) => void,
  ): Promise<SessionView>;
  undo(): SessionView;
  redo(): SessionView;
  validate(input: {
    path?: string;
    document?: unknown;
  }): Promise<{ valid: boolean; message?: string }>;
  introspect(): Promise<unknown>;
  dispose(): void;
};

/** Canonical document serialization — also the exact bytes scene.save writes. */
export function serialize(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

type OpenState = {
  path: string;
  abs: string;
  document: SceneDocument;
  /** Canonical serialization of the last opened/saved/reloaded document. */
  savedText: string;
  revision: number;
  conflict: boolean;
  undoStack: SceneDocument[];
  redoStack: SceneDocument[];
  unwatch(): void;
};

export function createSession(deps: SessionDeps): Session {
  let state: OpenState | undefined;

  const requireState = (): OpenState => {
    if (!state) throw new EditorError("no-session", "no scene is open");
    return state;
  };

  const isDirty = (s: OpenState): boolean =>
    serialize(s.document) !== s.savedText;

  const view = (s: OpenState): SessionView => ({
    document: s.document,
    path: s.path,
    revision: s.revision,
    dirty: isDirty(s),
    conflict: s.conflict,
    canUndo: s.undoStack.length > 0,
    canRedo: s.redoStack.length > 0,
  });

  const pushUndo = (s: OpenState): void => {
    // The current document object is itself the snapshot: commits SWAP the
    // document reference (never mutate it in place), so no clone is needed.
    s.undoStack.push(s.document);
    if (s.undoStack.length > UNDO_CAP) s.undoStack.shift();
  };

  async function onFileChanged(): Promise<void> {
    const s = state;
    if (!s) return;
    const read = deps.readTextFile ?? readFile;
    let text: string;
    try {
      text = await read(s.abs, "utf8");
    } catch {
      // stale callback for a no-longer-open doc — drop (a file-conflict for the
      // swapped-out path is notification-only anyway).
      if (s !== state) return;
      // Deleted (or unreadable): the user decides — save restores, open moves on.
      s.conflict = true;
      deps.emit({ type: "file-conflict", path: s.path });
      return;
    }
    // A concurrent open()/dispose() may have swapped `state` across the read
    // await: `s` is now orphaned, so drop the reload. Silent is correct —
    // file-reload events are notification-only dirty-bits (nothing is owed).
    if (s !== state) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      deps.emit({ type: "file-invalid", path: s.path, message: message(err) });
      return;
    }
    // One comparison covers both the daemon's own save echoing back and
    // genuine no-op rewrites: canonical form unchanged → nothing happened.
    if (serialize(parsed) === s.savedText) return;
    if (isDirty(s)) {
      s.conflict = true;
      deps.emit({ type: "file-conflict", path: s.path });
      return;
    }
    const registry = await deps.registry.current();
    // Same guard after the registry await (see above): a swap here also orphans `s`.
    if (s !== state) return;
    try {
      registry.validateDocument(parsed);
    } catch (err) {
      deps.emit({ type: "file-invalid", path: s.path, message: message(err) });
      return;
    }
    pushUndo(s);
    s.redoStack = [];
    // Boundary cast: validateDocument proved the parsed JSON against the
    // registry; SceneDocument is its parse-don't-validate result shape.
    s.document = parsed as SceneDocument;
    s.savedText = serialize(parsed);
    s.revision++;
    deps.emit({
      type: "document-changed",
      revision: s.revision,
      command: "file-reload",
    });
  }

  return {
    async open(path, force) {
      if (state && isDirty(state) && !force) {
        throw new EditorError(
          "unsaved-changes",
          `"${state.path}" has unsaved changes (pass force: true to discard them)`,
        );
      }
      // Fresh registry per open: re-opening is how extension edits are picked up.
      const registry = await deps.registry.reload();
      const raw = await readScene(deps.root, path);
      try {
        registry.validateDocument(raw);
      } catch (err) {
        throw new EditorError("validation-failed", message(err));
      }
      state?.unwatch();
      const abs = resolve(deps.root, path);
      state = {
        path,
        abs,
        // Boundary cast: validateDocument proved it (see onFileChanged).
        document: raw as SceneDocument,
        savedText: serialize(raw),
        revision: 0,
        conflict: false,
        undoStack: [],
        redoStack: [],
        unwatch: deps.watchFile(abs, onFileChanged),
      };
      deps.emit({ type: "scene-opened", path, revision: 0 });
      return view(state);
    },

    get() {
      return view(requireState());
    },

    async save() {
      const s = requireState();
      // savedText is set BEFORE the write so a fast watcher echo already
      // matches the canonical-form check in onFileChanged.
      s.savedText = serialize(s.document);
      await writeFile(s.abs, s.savedText, "utf8");
      s.conflict = false;
      deps.emit({ type: "saved", revision: s.revision });
      return view(s);
    },

    async apply(command, edit) {
      const s = requireState();
      const next = structuredClone(s.document);
      edit(next); // may throw EditorError("validation-failed") on missing targets
      const registry = await deps.registry.current();
      // A concurrent open()/dispose() may have swapped `state` across the
      // validation await. Unlike a file-reload, apply() owes its caller an
      // answer: throw no-session so the reroll-era client refetches and retries
      // if still relevant (App.tsx's refreshSession already swallows this).
      if (s !== state)
        throw new EditorError(
          "no-session",
          "session was replaced while the edit was validating",
        );
      try {
        registry.validateDocument(next);
      } catch (err) {
        throw new EditorError("validation-failed", message(err));
      }
      pushUndo(s);
      s.redoStack = [];
      s.document = next;
      s.revision++;
      deps.emit({ type: "document-changed", revision: s.revision, command });
      return view(s);
    },

    undo() {
      const s = requireState();
      const previous = s.undoStack.pop();
      if (!previous)
        throw new EditorError("nothing-to-undo", "undo stack is empty");
      s.redoStack.push(s.document);
      s.document = previous;
      s.revision++;
      deps.emit({
        type: "document-changed",
        revision: s.revision,
        command: "scene.undo",
      });
      return view(s);
    },

    redo() {
      const s = requireState();
      const next = s.redoStack.pop();
      if (!next)
        throw new EditorError("nothing-to-redo", "redo stack is empty");
      s.undoStack.push(s.document);
      s.document = next;
      s.revision++;
      deps.emit({
        type: "document-changed",
        revision: s.revision,
        command: "scene.redo",
      });
      return view(s);
    },

    async validate(input) {
      const registry = await deps.registry.current();
      const doc =
        input.path !== undefined
          ? await readScene(deps.root, input.path)
          : input.document;
      try {
        registry.validateDocument(doc);
        return { valid: true };
      } catch (err) {
        return { valid: false, message: message(err) };
      }
    },

    async introspect() {
      return (await deps.registry.current()).introspect();
    },

    dispose() {
      state?.unwatch();
      state = undefined;
    },
  };
}

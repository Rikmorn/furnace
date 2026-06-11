import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegistryModule } from "../src/daemon/registry-bundle.ts";
import {
  createSession,
  type Session,
  type SessionEvent,
  serialize,
} from "../src/daemon/session.ts";
import type { WatchFile } from "../src/daemon/watch.ts";

// Fake registry: rejects any document whose JSON contains the marker INVALID.
const fakeRegistry: RegistryModule = {
  validateDocument(doc: unknown) {
    if (JSON.stringify(doc).includes("INVALID"))
      throw new Error("registry says no: INVALID marker present");
  },
  introspect: () => ({ fake: true }),
  CURRENT_SCENE_VERSION: 1,
};
const registry = {
  reload: () => Promise.resolve(fakeRegistry),
  current: () => Promise.resolve(fakeRegistry),
};

type Watched = { path: string; trigger: () => Promise<void> };

function harness() {
  const root = mkdtempSync(join(tmpdir(), "furnace-session-"));
  mkdirSync(join(root, "scenes"), { recursive: true });
  const docText = `${JSON.stringify({ version: 1, entities: [{ id: "cube", components: {} }] }, null, 2)}\n`;
  writeFileSync(join(root, "scenes", "a.scene.json"), docText);
  writeFileSync(
    join(root, "scenes", "b.scene.json"),
    JSON.stringify({ version: 1, entities: [] }), // compact on purpose
  );
  const watched: Watched[] = [];
  const watchFile: WatchFile = (path, onChange) => {
    const entry = { path, trigger: onChange };
    watched.push(entry);
    return () => {
      const i = watched.indexOf(entry);
      if (i !== -1) watched.splice(i, 1);
    };
  };
  const events: SessionEvent[] = [];
  const session = createSession({
    root,
    watchFile,
    registry,
    emit: (e) => events.push(e),
  });
  return { root, session, events, watched };
}

const bump = (session: Session) =>
  session.apply("scene.addEntity", (doc) => {
    doc.entities.push({ id: `e${doc.entities.length}`, components: {} });
  });

test("open: fresh session, revision 0, clean, watched, scene-opened emitted", async () => {
  const { session, events, watched } = harness();
  const view = await session.open("scenes/a.scene.json", false);
  expect(view).toMatchObject({
    path: "scenes/a.scene.json",
    revision: 0,
    dirty: false,
    conflict: false,
  });
  expect(view.document.entities).toHaveLength(1);
  expect(events).toEqual([
    { type: "scene-opened", path: "scenes/a.scene.json", revision: 0 },
  ]);
  expect(watched).toHaveLength(1);
});

test("open a compactly-formatted file starts clean (canonical savedText)", async () => {
  const { session } = harness();
  const view = await session.open("scenes/b.scene.json", false);
  expect(view.dirty).toBe(false);
});

// bun:test's toThrow doesn't take matchers; capture sync throws and
// toMatchObject them (async sites use rejects.toMatchObject).
function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected function to throw");
}

test("get before open → no-session", () => {
  const { session } = harness();
  expect(captureError(() => session.get())).toMatchObject({
    code: "no-session",
  });
});

test("apply: commit bumps revision, dirties, emits; document updated", async () => {
  const { session, events } = harness();
  await session.open("scenes/a.scene.json", false);
  const view = await bump(session);
  expect(view.revision).toBe(1);
  expect(view.dirty).toBe(true);
  expect(view.document.entities).toHaveLength(2);
  expect(events.at(-1)).toEqual({
    type: "document-changed",
    revision: 1,
    command: "scene.addEntity",
  });
});

test("apply: a rejected edit leaves the session untouched", async () => {
  const { session } = harness();
  await session.open("scenes/a.scene.json", false);
  // Edit makes the doc INVALID per the fake registry.
  // Deviation from plan: bracket notation for noPropertyAccessFromIndexSignature
  // (components is Record<string, unknown>); ! for noUncheckedIndexedAccess.
  await expect(
    session.apply("scene.setComponent", (doc) => {
      doc.entities[0]!["components"]["marker"] = "INVALID";
    }),
  ).rejects.toMatchObject({ code: "validation-failed" });
  const view = session.get();
  expect(view.revision).toBe(0);
  expect(view.dirty).toBe(false);
  expect(view.document.entities[0]?.["components"]["marker"]).toBeUndefined();
});

test("undo/redo: roundtrip; redo cleared by a new mutation; empty stacks throw", async () => {
  const { session } = harness();
  await session.open("scenes/a.scene.json", false);
  await bump(session);
  let view = session.undo();
  expect(view.revision).toBe(2);
  expect(view.document.entities).toHaveLength(1);
  expect(view.dirty).toBe(false); // undone back to the saved state
  view = session.redo();
  expect(view.document.entities).toHaveLength(2);
  session.undo();
  await bump(session); // clears redo
  expect(captureError(() => session.redo())).toMatchObject({
    code: "nothing-to-redo",
  });
  session.undo();
  expect(captureError(() => session.undo())).toMatchObject({
    code: "nothing-to-undo",
  });
});

test("undo stack caps at 100", async () => {
  const { session } = harness();
  await session.open("scenes/a.scene.json", false);
  for (let i = 0; i < 105; i++) await bump(session);
  for (let i = 0; i < 100; i++) session.undo();
  expect(captureError(() => session.undo())).toMatchObject({
    code: "nothing-to-undo",
  });
});

test("save writes canonical JSON, cleans, emits saved", async () => {
  const { root, session, events } = harness();
  await session.open("scenes/a.scene.json", false);
  await bump(session);
  const view = await session.save();
  expect(view.dirty).toBe(false);
  expect(events.at(-1)).toEqual({ type: "saved", revision: 1 });
  const onDisk = readFileSync(join(root, "scenes", "a.scene.json"), "utf8");
  expect(onDisk).toBe(serialize(view.document));
});

test("open over a dirty session: unsaved-changes unless forced", async () => {
  const { session } = harness();
  await session.open("scenes/a.scene.json", false);
  await bump(session);
  await expect(
    session.open("scenes/b.scene.json", false),
  ).rejects.toMatchObject({ code: "unsaved-changes" });
  const view = await session.open("scenes/b.scene.json", true);
  expect(view.path).toBe("scenes/b.scene.json");
});

test("file change on a clean session reloads as an undoable mutation", async () => {
  const { root, session, events, watched } = harness();
  await session.open("scenes/a.scene.json", false);
  writeFileSync(
    join(root, "scenes", "a.scene.json"),
    JSON.stringify({ version: 1, entities: [] }),
  );
  await watched[0]!.trigger();
  const view = session.get();
  expect(view.revision).toBe(1);
  expect(view.dirty).toBe(false);
  expect(view.document.entities).toHaveLength(0);
  expect(events.at(-1)).toEqual({
    type: "document-changed",
    revision: 1,
    command: "file-reload",
  });
  // The disk edit is undoable.
  expect(session.undo().document.entities).toHaveLength(1);
});

test("file change with identical canonical content is a no-op (covers save echo)", async () => {
  const { session, events, watched } = harness();
  await session.open("scenes/a.scene.json", false);
  await bump(session);
  await session.save(); // daemon's own write — watcher will echo this
  const before = events.length;
  await watched[0]!.trigger();
  expect(events.length).toBe(before);
});

test("file change under a dirty session → conflict, never clobbers", async () => {
  const { root, session, events, watched } = harness();
  await session.open("scenes/a.scene.json", false);
  await bump(session);
  writeFileSync(
    join(root, "scenes", "a.scene.json"),
    JSON.stringify({ version: 1, entities: [] }),
  );
  await watched[0]!.trigger();
  const view = session.get();
  expect(view.conflict).toBe(true);
  expect(view.document.entities).toHaveLength(2); // session kept
  expect(events.at(-1)).toEqual({
    type: "file-conflict",
    path: "scenes/a.scene.json",
  });
});

test("invalid new disk content → file-invalid, session untouched", async () => {
  const { root, session, events, watched } = harness();
  await session.open("scenes/a.scene.json", false);
  writeFileSync(join(root, "scenes", "a.scene.json"), "{ nope");
  await watched[0]!.trigger();
  expect(session.get().revision).toBe(0);
  expect(events.at(-1)).toMatchObject({ type: "file-invalid" });
  // Registry-invalid (parses, fails validation) is also file-invalid:
  writeFileSync(
    join(root, "scenes", "a.scene.json"),
    JSON.stringify({ version: 1, entities: [], marker: "INVALID" }),
  );
  await watched[0]!.trigger();
  expect(session.get().revision).toBe(0);
  expect(events.at(-1)).toMatchObject({ type: "file-invalid" });
});

test("file deleted → conflict", async () => {
  const { root, session, events, watched } = harness();
  await session.open("scenes/a.scene.json", false);
  rmSync(join(root, "scenes", "a.scene.json"));
  await watched[0]!.trigger();
  expect(session.get().conflict).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "file-conflict" });
});

test("re-open unwatches the previous file; save clears conflict", async () => {
  const { root, session, watched } = harness();
  await session.open("scenes/a.scene.json", false);
  rmSync(join(root, "scenes", "a.scene.json"));
  await watched[0]!.trigger();
  expect(session.get().conflict).toBe(true);
  await session.save(); // restores the file, clears conflict
  expect(session.get().conflict).toBe(false);
  await session.open("scenes/b.scene.json", false);
  expect(watched).toHaveLength(1);
  expect(watched[0]!.path).toContain("b.scene.json");
});

test("validate: inline document and file path, valid and invalid", async () => {
  const { session } = harness();
  expect(
    await session.validate({ document: { version: 1, entities: [] } }),
  ).toEqual({ valid: true });
  const bad = await session.validate({
    document: { version: 1, entities: [], marker: "INVALID" },
  });
  expect(bad.valid).toBe(false);
  expect(bad.message).toContain("INVALID");
  expect(await session.validate({ path: "scenes/a.scene.json" })).toEqual({
    valid: true,
  });
});

test("introspect proxies the registry", async () => {
  const { session } = harness();
  expect(await session.introspect()).toEqual({ fake: true });
});

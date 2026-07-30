// packages/editor/src/daemon/handlers.ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { EditorError } from "./errors.ts";
import type { DaemonEvent } from "./events.ts";
import * as mutations from "./mutations.ts";
import { listScenes, readScene } from "./scenes.ts";
import type { Session } from "./session.ts";
import {
  deleteWorld,
  duplicateWorldDir,
  listWorlds,
  readWorldsIndex,
  renameWorldDir,
  WORLD_NAME_RE,
  worldDir,
  writeDefaultWorld,
} from "./worlds.ts";

type Handler = {
  input: z.ZodType;
  run(input: unknown): Promise<unknown>;
};

/** The command registry: name → zod-validated handler. Every client (chrome, HTTP, future MCP/agent bindings) funnels through dispatch(). */
export type Handlers = Map<string, Handler>;

export type HandlerContext = {
  root: string;
  scenesPattern: string;
  session: Session;
  emit(event: DaemonEvent): void;
  /** Injected capability (same pattern as watchDir): for a project-relative
   *  path, reports true (not gitignored per `git check-ignore`), false
   *  (gitignored), or null (a git error or ambiguous status — indeterminate).
   *  Undefined when no git repo is available at all — world.list then
   *  reports every row's `tracked` as null. */
  isTracked?: (rel: string) => boolean | null;
};

const componentsRecord = z.record(z.string(), z.unknown());
const tableEnum = z.enum(["geometries", "shaders", "materials"]);

/** Build the M4 command set: stateless reads + the document-session commands. */
export function createHandlers(ctx: HandlerContext): Handlers {
  const { session } = ctx;
  const handlers: Handlers = new Map();

  // Each run() opens with a boundary cast: the homogeneous Handler.run(input:
  // unknown) signature erases the per-command schema; dispatch() validated the
  // input against this command's schema immediately before invoking run.

  // The project root the daemon serves — the frontend keys its per-project UI
  // persistence store on it (chrome layout, last scene, view flags survive a restart).
  handlers.set("project.get", {
    input: z.strictObject({}),
    run: () => Promise.resolve({ root: ctx.root }),
  });

  handlers.set("scene.list", {
    input: z.strictObject({}),
    run: async () => ({
      scenes: await listScenes(ctx.root, ctx.scenesPattern),
    }),
  });

  handlers.set("scene.read", {
    input: z.strictObject({ path: z.string() }),
    run: async (input) => {
      const { path } = input as { path: string };
      return { document: await readScene(ctx.root, path) };
    },
  });

  handlers.set("scene.open", {
    input: z.strictObject({ path: z.string(), force: z.boolean().optional() }),
    run: (input) => {
      const { path, force } = input as { path: string; force?: boolean };
      return session.open(path, force ?? false);
    },
  });

  handlers.set("scene.get", {
    input: z.strictObject({}),
    run: () => Promise.resolve(session.get()),
  });

  handlers.set("scene.save", {
    input: z.strictObject({}),
    run: async () => {
      const { revision, dirty } = await session.save();
      return { revision, dirty };
    },
  });

  handlers.set("scene.validate", {
    input: z
      .strictObject({
        path: z.string().optional(),
        document: z.unknown().optional(),
      })
      .refine((v) => (v.path === undefined) !== (v.document === undefined), {
        message: "provide exactly one of path or document",
      }),
    run: (input) =>
      session.validate(input as { path?: string; document?: unknown }),
  });

  handlers.set("scene.introspect", {
    input: z.strictObject({}),
    run: () => session.introspect(),
  });

  handlers.set("scene.addEntity", {
    input: z.strictObject({
      id: z.string().optional(),
      components: componentsRecord.optional(),
    }),
    run: async (input) => {
      const args = input as {
        id?: string;
        components?: Record<string, unknown>;
      };
      let id = "";
      const { revision, dirty } = await session.apply(
        "scene.addEntity",
        (doc) => {
          id = mutations.addEntity(doc, args);
        },
      );
      return { id, revision, dirty };
    },
  });

  handlers.set("scene.removeEntity", {
    input: z.strictObject({ id: z.string() }),
    run: async (input) => {
      const { id } = input as { id: string };
      const { revision, dirty } = await session.apply(
        "scene.removeEntity",
        (doc) => mutations.removeEntity(doc, id),
      );
      return { revision, dirty };
    },
  });

  handlers.set("scene.setComponent", {
    input: z.strictObject({
      entity: z.string(),
      component: z.string(),
      params: componentsRecord,
    }),
    run: async (input) => {
      const args = input as {
        entity: string;
        component: string;
        params: Record<string, unknown>;
      };
      const { revision, dirty } = await session.apply(
        "scene.setComponent",
        (doc) =>
          mutations.setComponent(doc, args.entity, args.component, args.params),
      );
      return { revision, dirty };
    },
  });

  handlers.set("scene.removeComponent", {
    input: z.strictObject({ entity: z.string(), component: z.string() }),
    run: async (input) => {
      const args = input as { entity: string; component: string };
      const { revision, dirty } = await session.apply(
        "scene.removeComponent",
        (doc) => mutations.removeComponent(doc, args.entity, args.component),
      );
      return { revision, dirty };
    },
  });

  handlers.set("scene.setResource", {
    input: z.strictObject({
      table: tableEnum,
      id: z.string(),
      entry: componentsRecord,
    }),
    run: async (input) => {
      const args = input as {
        table: mutations.ResourceTable;
        id: string;
        entry: Record<string, unknown>;
      };
      const { revision, dirty } = await session.apply(
        "scene.setResource",
        (doc) => mutations.setResource(doc, args.table, args.id, args.entry),
      );
      return { revision, dirty };
    },
  });

  handlers.set("scene.removeResource", {
    input: z.strictObject({ table: tableEnum, id: z.string() }),
    run: async (input) => {
      const args = input as { table: mutations.ResourceTable; id: string };
      const { revision, dirty } = await session.apply(
        "scene.removeResource",
        (doc) => mutations.removeResource(doc, args.table, args.id),
      );
      return { revision, dirty };
    },
  });

  handlers.set("scene.setSettings", {
    input: z.strictObject({ settings: z.unknown() }),
    run: async (input) => {
      const { settings } = input as { settings: unknown };
      const { revision, dirty } = await session.apply(
        "scene.setSettings",
        (doc) => mutations.setSettings(doc, settings),
      );
      return { revision, dirty };
    },
  });

  handlers.set("scene.batch", {
    input: z.strictObject({
      edits: z
        .array(
          z.strictObject({
            entity: z.string(),
            component: z.string(),
            params: componentsRecord,
          }),
        )
        .min(1),
    }),
    run: async (input) => {
      const { edits } = input as {
        edits: {
          entity: string;
          component: string;
          params: Record<string, unknown>;
        }[];
      };
      const { revision, dirty } = await session.apply("scene.batch", (doc) => {
        for (const e of edits) {
          mutations.setComponent(doc, e.entity, e.component, e.params);
        }
      });
      return { revision, dirty };
    },
  });

  handlers.set("scene.undo", {
    input: z.strictObject({}),
    run: () => {
      const { revision, dirty } = session.undo();
      return Promise.resolve({ revision, dirty });
    },
  });

  handlers.set("scene.redo", {
    input: z.strictObject({}),
    run: () => {
      const { revision, dirty } = session.redo();
      return Promise.resolve({ revision, dirty });
    },
  });

  const wireFile = z.strictObject({
    // .min(1): an empty-string path resolves to the root DIR, which would slip
    // past root-containment and reach writeFileSync(rootDir, …) → EISDIR mid-loop
    // (a partial write in a multi-file batch). Reject it at the zod boundary.
    path: z.string().min(1),
    encoding: z.enum(["utf8", "base64"]),
    contents: z.string(),
  });

  // The browser bakes a world (it owns generation — the daemon carries zero
  // generator knowledge; see the slice's browser-uploads-payload fallback) and
  // POSTs the file set here. Binary .fmesh sidecars ride as base64. The daemon
  // validates root-containment for EVERY path first, then writes.
  handlers.set("generation.bake", {
    input: z.strictObject({
      files: z.array(wireFile).min(1),
      cleanDir: z.string().min(1).optional(),
    }),
    run: (input) => {
      // Boundary cast: dispatch() validated input against this command's schema.
      const { files, cleanDir } = input as {
        files: {
          path: string;
          encoding: "utf8" | "base64";
          contents: string;
        }[];
        cleanDir?: string;
      };
      const rootAbs = resolve(ctx.root);
      // Validate ALL paths root-contained BEFORE writing ANY file (an escaping
      // path must leave the FS untouched — the test asserts nothing was written).
      const targets = files.map((f) => {
        const abs = resolve(ctx.root, f.path);
        const insideRoot = abs === rootAbs || abs.startsWith(rootAbs + sep);
        if (!insideRoot) {
          throw new EditorError(
            "outside-root",
            `bake path escapes the project root: ${f.path}`,
          );
        }
        // A dotfile segment is inside the root but refused — keep the outside-root
        // code (it uniformly hides existence) with a cause-accurate message.
        const hasDotSegment = f.path.split("/").some((s) => s.startsWith("."));
        if (hasDotSegment) {
          throw new EditorError(
            "outside-root",
            `bake path refused (dotfile segment): ${f.path}`,
          );
        }
        return { abs, file: f };
      });
      // Optional clean-previous-bake: rm -rf cleanDir BEFORE writing, so a
      // smaller bake leaves no orphans from a prior larger one. Validate
      // everything (containment + no dotfile + every file lands inside
      // cleanDir) BEFORE any delete — a mismatched payload leaves the FS
      // untouched.
      if (cleanDir !== undefined) {
        const cleanAbs = resolve(ctx.root, cleanDir);
        // cleanAbs !== rootAbs: the project root itself is never a valid cleanDir.
        const insideRoot =
          cleanAbs !== rootAbs && cleanAbs.startsWith(rootAbs + sep);
        const hasDotSegment = cleanDir
          .split("/")
          .some((s) => s.startsWith("."));
        if (!insideRoot || hasDotSegment) {
          throw new EditorError(
            "outside-root",
            `bake cleanDir refused: ${cleanDir}`,
          );
        }
        // Every file must land inside cleanDir — refuse wiping one dir while
        // writing another.
        for (const { abs, file } of targets) {
          if (!abs.startsWith(cleanAbs + sep)) {
            throw new EditorError(
              "invalid-input",
              `bake file outside cleanDir (${cleanDir}): ${file.path}`,
            );
          }
        }
        rmSync(cleanAbs, { recursive: true, force: true });
      }
      for (const { abs, file } of targets) {
        mkdirSync(dirname(abs), { recursive: true });
        const data =
          file.encoding === "base64"
            ? Buffer.from(file.contents, "base64")
            : file.contents;
        writeFileSync(abs, data);
      }
      ctx.emit({ type: "generation-baked", files: files.length });
      return Promise.resolve({ files: files.length });
    },
  });

  // Read a saved field world (F1/F2) so the Field panel can reload it into the
  // FieldHost. Reads the density files (the authoring truth) + the material
  // siblings (per-chunk class assignment) + the oplog — the .fmesh render meshes
  // are re-derived on load. Every sibling path is re-validated root-contained (a
  // manifest is on-disk data, not trusted input).
  handlers.set("field.load", {
    input: z.strictObject({
      name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i),
    }),
    run: (input) => {
      const { name } = input as { name: string };
      const rootAbs = resolve(ctx.root);
      const dir = resolve(ctx.root, "worlds", name);
      if (!(dir === rootAbs || dir.startsWith(rootAbs + sep))) {
        throw new EditorError(
          "outside-root",
          `world escapes the project root: ${name}`,
        );
      }
      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) {
        throw new EditorError("not-found", `world "${name}" has no manifest`);
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        chunks?: { key: string; file: string }[];
        materials?: { key: string; file: string }[];
      };
      // One root-contained base64 reader for both sibling kinds (chunks + .mat
      // materials), so the containment guard is applied identically — a copy for
      // each kind risks the guard drifting on one path.
      const readSiblings = (
        entries: { key: string; file: string }[],
        kind: string,
      ): { key: string; data: string }[] =>
        entries.map((e) => {
          const abs = resolve(dir, e.file);
          if (!abs.startsWith(rootAbs + sep)) {
            throw new EditorError(
              "outside-root",
              `${kind} path escapes root: ${e.file}`,
            );
          }
          return { key: e.key, data: readFileSync(abs).toString("base64") };
        });
      const chunks = readSiblings(manifest.chunks ?? [], "chunk");
      const materials = readSiblings(manifest.materials ?? [], "material");
      const oplogPath = join(dir, "oplog.json");
      const oplog = existsSync(oplogPath)
        ? readFileSync(oplogPath, "utf8")
        : null;
      return Promise.resolve({ manifest, chunks, materials, oplog });
    },
  });

  // Enumerate worlds/ (read-only). Classification + the tracked-checker
  // capability live in worlds.ts.
  handlers.set("world.list", {
    input: z.strictObject({}),
    run: () => Promise.resolve(listWorlds(ctx.root, ctx.isTracked)),
  });

  const worldName = z.string().regex(WORLD_NAME_RE);

  handlers.set("world.makeDefault", {
    input: z.strictObject({ name: worldName }),
    run: (input) => {
      const { name } = input as { name: string };
      const manifestPath = join(worldDir(ctx.root, name), "manifest.json");
      if (!existsSync(manifestPath)) {
        throw new EditorError("not-found", `world "${name}" has no manifest`);
      }
      writeDefaultWorld(ctx.root, name);
      ctx.emit({ type: "worlds-changed" });
      return Promise.resolve({});
    },
  });

  handlers.set("world.delete", {
    input: z.strictObject({ name: worldName }),
    run: (input) => {
      const { name } = input as { name: string };
      if (!existsSync(worldDir(ctx.root, name))) {
        throw new EditorError("not-found", `world "${name}" does not exist`);
      }
      const isDefault = readWorldsIndex(ctx.root)?.default === name;
      if (isDefault) {
        throw new EditorError(
          "invalid-input",
          `cannot delete "${name}" — it is the current default world; make another world default first`,
        );
      }
      // No manifest check here (unlike world.makeDefault): a dir under
      // worlds/ that never finished writing a manifest is junk, and its name
      // is already regex-gated to the same namespace — deleting it is
      // cleanup, not a semantic "delete this world" operation.
      deleteWorld(ctx.root, name);
      ctx.emit({ type: "worlds-changed" });
      return Promise.resolve({});
    },
  });

  handlers.set("world.rename", {
    input: z.strictObject({ from: worldName, to: worldName }),
    run: (input) => {
      const { from, to } = input as { from: string; to: string };
      if (!existsSync(worldDir(ctx.root, from))) {
        throw new EditorError("not-found", `world "${from}" does not exist`);
      }
      // macOS's default case-insensitive filesystem means existsSync also
      // catches case-folded collisions (e.g. "Foo" vs "foo") — consistent
      // with WORLD_NAME_RE's `i` flag treating them as the same name.
      if (existsSync(worldDir(ctx.root, to))) {
        throw new EditorError("already-exists", `world "${to}" already exists`);
      }
      const wasDefault = readWorldsIndex(ctx.root)?.default === from;
      renameWorldDir(ctx.root, from, to);
      if (wasDefault) writeDefaultWorld(ctx.root, to);
      ctx.emit({ type: "worlds-changed" });
      return Promise.resolve({});
    },
  });

  handlers.set("world.duplicate", {
    input: z.strictObject({ from: worldName, to: worldName }),
    run: (input) => {
      const { from, to } = input as { from: string; to: string };
      if (!existsSync(worldDir(ctx.root, from))) {
        throw new EditorError("not-found", `world "${from}" does not exist`);
      }
      // Same case-insensitive-FS note as world.rename above.
      if (existsSync(worldDir(ctx.root, to))) {
        throw new EditorError("already-exists", `world "${to}" already exists`);
      }
      duplicateWorldDir(ctx.root, from, to);
      ctx.emit({ type: "worlds-changed" });
      return Promise.resolve({});
    },
  });

  return handlers;
}

/** Validate input against the command's schema and run it. Throws EditorError on all failures. */
// biome-ignore lint/suspicious/useAwait: async is load-bearing — synchronous throws become rejected promises, matching caller await + .rejects semantics
export async function dispatch(
  handlers: Handlers,
  command: string,
  input: unknown,
): Promise<unknown> {
  const handler = handlers.get(command);
  if (!handler)
    throw new EditorError("unknown-command", `unknown command "${command}"`);
  const parsed = handler.input.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new EditorError(
      "invalid-input",
      `invalid input at "${issue?.path.join(".") ?? ""}": ${issue?.message ?? ""}`,
    );
  }
  return handler.run(parsed.data);
}

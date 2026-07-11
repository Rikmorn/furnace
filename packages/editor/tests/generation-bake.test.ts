// packages/editor/tests/generation-bake.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import type { DaemonEvent } from "../src/daemon/events.ts";
import { createHandlers, dispatch } from "../src/daemon/handlers.ts";
import { createRegistryLoader } from "../src/daemon/registry-bundle.ts";
import { createSession, type Session } from "../src/daemon/session.ts";

// Real session + real registry over an IN-WORKSPACE copy of mini-project
// (esbuild resolves @furnace/core through the workspace node_modules; an
// os.tmpdir() copy could not — same constraint handlers.test.ts documents).
const MINI = join(import.meta.dir, "fixtures", "mini-project");

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op stub — file-change semantics are session.test.ts's job
const noopUnwatch = (): void => {};

let root: string;
let session: Session;
let handlers: ReturnType<typeof createHandlers>;
let events: DaemonEvent[];

beforeEach(() => {
  root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-bake-"));
  cpSync(MINI, root, { recursive: true });
  events = [];
  session = createSession({
    root,
    watchFile: () => noopUnwatch, // file-change semantics are session.test.ts's job
    registry: createRegistryLoader(root, "src/editor-extensions.ts"),
    emit: (e) => events.push(e),
  });
  handlers = createHandlers({
    root,
    scenesPattern: "**/*.scene.json",
    session,
    emit: (e) => events.push(e),
  });
});

afterEach(() => {
  session.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe("generation.bake", () => {
  test("writes root-contained files (utf8 + base64), emits generation-baked", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const b64 = Buffer.from(bytes).toString("base64");
    const sceneText = JSON.stringify({ version: 1, entities: [] });

    const result = (await dispatch(handlers, "generation.bake", {
      files: [
        {
          path: "regions/wing.scene.json",
          encoding: "utf8",
          contents: sceneText,
        },
        { path: "regions/wing.fmesh", encoding: "base64", contents: b64 },
      ],
    })) as { files: number };

    expect(result).toEqual({ files: 2 });

    // utf8 file written verbatim.
    expect(readFileSync(join(root, "regions", "wing.scene.json"), "utf8")).toBe(
      sceneText,
    );
    // base64 file decoded back to the exact bytes.
    const wroteBytes = new Uint8Array(
      readFileSync(join(root, "regions", "wing.fmesh")),
    );
    expect([...wroteBytes]).toEqual([...bytes]);

    // The daemon emitted the baked event with the file count.
    expect(events).toContainEqual({ type: "generation-baked", files: 2 });
  });

  test("a worlds/<name> bake (W1) is accepted and written, cleanDir clears the prior", async () => {
    // The handler is destination-agnostic (root-containment + no-dotfile only, no regions/
    // restriction), so the W1 world flow's worlds/<name>/ destination needs no daemon change.
    const bytes = new Uint8Array([9, 8, 7]);
    const b64 = Buffer.from(bytes).toString("base64");
    // Seed a prior bake with a stale sidecar so cleanDir has something to remove.
    await dispatch(handlers, "generation.bake", {
      files: [
        {
          path: "worlds/myworld/stale.fmesh",
          encoding: "base64",
          contents: b64,
        },
        {
          path: "worlds/myworld/manifest.json",
          encoding: "utf8",
          contents: "{}",
        },
      ],
    });

    const scene = JSON.stringify({ version: 1, entities: [] });
    const result = (await dispatch(handlers, "generation.bake", {
      cleanDir: "worlds/myworld",
      files: [
        {
          path: "worlds/myworld/world.scene.json",
          encoding: "utf8",
          contents: scene,
        },
        {
          path: "worlds/myworld/cave-a-0.fmesh",
          encoding: "base64",
          contents: b64,
        },
        {
          path: "worlds/myworld/manifest.json",
          encoding: "utf8",
          contents: '{"version":1}',
        },
      ],
    })) as { files: number };

    expect(result).toEqual({ files: 3 });
    // The world doc + sidecar landed under worlds/<name>/.
    expect(
      readFileSync(join(root, "worlds", "myworld", "world.scene.json"), "utf8"),
    ).toBe(scene);
    expect([
      ...new Uint8Array(
        readFileSync(join(root, "worlds", "myworld", "cave-a-0.fmesh")),
      ),
    ]).toEqual([...bytes]);
    // cleanDir removed the prior bake's stale sidecar.
    expect(existsSync(join(root, "worlds/myworld/stale.fmesh"))).toBe(false);
    expect(events).toContainEqual({ type: "generation-baked", files: 3 });
  });

  test("a path escaping the root → outside-root, and NOTHING is written", async () => {
    await expect(
      dispatch(handlers, "generation.bake", {
        files: [{ path: "../escape.txt", encoding: "utf8", contents: "x" }],
      }),
    ).rejects.toMatchObject({ code: "outside-root" });

    expect(existsSync(join(root, "..", "escape.txt"))).toBe(false);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "generation-baked" }),
    );
  });

  test("an empty-string path is rejected at the zod boundary, nothing written", async () => {
    const before = readdirSync(root).sort();
    await expect(
      dispatch(handlers, "generation.bake", {
        files: [{ path: "", encoding: "utf8", contents: "x" }],
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    // Rejected before the write loop — the root dir is untouched.
    expect(readdirSync(root).sort()).toEqual(before);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "generation-baked" }),
    );
  });

  test("a dotfile segment is refused, and the good sibling in the batch is NOT written", async () => {
    await expect(
      dispatch(handlers, "generation.bake", {
        files: [
          { path: "regions/ok.txt", encoding: "utf8", contents: "ok" },
          { path: ".env", encoding: "utf8", contents: "SECRET=1" },
        ],
      }),
    ).rejects.toMatchObject({ code: "outside-root" });

    // Validation runs over ALL paths before ANY write — the legal sibling
    // must not have landed on disk.
    expect(existsSync(join(root, "regions", "ok.txt"))).toBe(false);
    expect(existsSync(join(root, ".env"))).toBe(false);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "generation-baked" }),
    );
  });

  test("cleanDir removes a stale file from a prior larger bake before writing", async () => {
    // seed a prior bake with an extra stale file (no cleanDir → just writes)
    await dispatch(handlers, "generation.bake", {
      files: [
        {
          path: "regions/w/stale.scene.json",
          encoding: "utf8",
          contents: "{}",
        },
        { path: "regions/w/manifest.json", encoding: "utf8", contents: "{}" },
      ],
    });
    // re-bake a SMALLER set with cleanDir → the stale file must be gone
    await dispatch(handlers, "generation.bake", {
      cleanDir: "regions/w",
      files: [
        {
          path: "regions/w/manifest.json",
          encoding: "utf8",
          contents: '{"v":2}',
        },
      ],
    });
    expect(existsSync(join(root, "regions/w/stale.scene.json"))).toBe(false);
    expect(readFileSync(join(root, "regions/w/manifest.json"), "utf8")).toBe(
      '{"v":2}',
    );
  });

  test("cleanDir escaping the root is refused and the FS is untouched", async () => {
    await expect(
      dispatch(handlers, "generation.bake", {
        cleanDir: "../outside",
        files: [{ path: "regions/w/a.json", encoding: "utf8", contents: "{}" }],
      }),
    ).rejects.toMatchObject({ code: "outside-root" });
    expect(existsSync(join(root, "regions/w/a.json"))).toBe(false);
  });

  test("a file outside cleanDir is refused before any delete or write", async () => {
    // Seed a sentinel INSIDE the dir that would be wiped, so a premature rmSync
    // (rm before the file-under-cleanDir check) would delete it — discriminating the ordering.
    await dispatch(handlers, "generation.bake", {
      files: [
        { path: "regions/w/sentinel.json", encoding: "utf8", contents: "{}" },
      ],
    });
    await expect(
      dispatch(handlers, "generation.bake", {
        cleanDir: "regions/w",
        files: [
          { path: "regions/other/a.json", encoding: "utf8", contents: "{}" },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    // Validation threw before rmSync(regions/w) → the sentinel inside cleanDir survives.
    expect(existsSync(join(root, "regions/w/sentinel.json"))).toBe(true);
    // And the offending payload file was never written.
    expect(existsSync(join(root, "regions/other/a.json"))).toBe(false);
  });

  test("a cleanDir with a dotfile segment is refused", async () => {
    // The payload file itself is clean (passes per-file validation); the cleanDir's
    // dotfile segment is what must be refused.
    await expect(
      dispatch(handlers, "generation.bake", {
        cleanDir: "regions/.hidden",
        files: [
          { path: "regions/ok/a.json", encoding: "utf8", contents: "{}" },
        ],
      }),
    ).rejects.toMatchObject({ code: "outside-root" });
  });

  test("a sibling-prefix file (regions/w2 under cleanDir regions/w) is refused", async () => {
    await expect(
      dispatch(handlers, "generation.bake", {
        cleanDir: "regions/w",
        files: [
          { path: "regions/w2/a.json", encoding: "utf8", contents: "{}" },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});

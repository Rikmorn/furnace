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
});

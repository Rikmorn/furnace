// packages/editor/tests/field-load.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonEvent } from "../src/daemon/events.ts";
import { createHandlers, dispatch } from "../src/daemon/handlers.ts";
import { createRegistryLoader } from "../src/daemon/registry-bundle.ts";
import { createSession, type Session } from "../src/daemon/session.ts";

// Real session + real registry over an IN-WORKSPACE copy of mini-project (esbuild
// resolves @furnace/core through the workspace node_modules; an os.tmpdir() copy could
// not — the same constraint generation-bake.test.ts documents).
const MINI = join(import.meta.dir, "fixtures", "mini-project");

// biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op stub — file-change semantics are session.test.ts's job
const noopUnwatch = (): void => {};

let root: string;
let session: Session;
let handlers: ReturnType<typeof createHandlers>;
let events: DaemonEvent[];

beforeEach(() => {
  root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-field-load-"));
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

describe("field.load", () => {
  test("returns manifest + base64 chunks for a saved world", async () => {
    const dir = join(root, "worlds", "scratch");
    mkdirSync(join(dir, "chunks"), { recursive: true });
    const manifest = {
      version: 2,
      kind: "field",
      cellSize: 0.25,
      playerStart: [0, 0, 0],
      playerYaw: 0,
      chunks: [{ key: "0,0,0", file: "chunks/0_0_0.bin" }],
      meshes: [],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    // A chunk density file is the 8-byte header + 4096 Int8 samples (encodeChunkFile).
    const chunkBytes = new Uint8Array(8 + 4096);
    writeFileSync(join(dir, "chunks", "0_0_0.bin"), chunkBytes);

    const result = (await dispatch(handlers, "field.load", {
      name: "scratch",
    })) as {
      manifest: unknown;
      chunks: { key: string; data: string }[];
      oplog: string | null;
    };

    expect((result.manifest as { version: number }).version).toBe(2);
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0]?.key).toBe("0,0,0");
    expect(Buffer.from(result.chunks[0]?.data ?? "", "base64").byteLength).toBe(
      8 + 4096,
    );
    // No oplog.json written → null (loadWorld replays an empty op list).
    expect(result.oplog).toBeNull();
  });

  test("returns the oplog JSON when present", async () => {
    const dir = join(root, "worlds", "withops");
    mkdirSync(dir, { recursive: true });
    const manifest = {
      version: 2,
      kind: "field",
      cellSize: 0.25,
      playerStart: [0, 0, 0],
      playerYaw: 0,
      chunks: [],
      meshes: [],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    const ops = '[{"id":1,"kind":"dig"}]';
    writeFileSync(join(dir, "oplog.json"), ops);

    const result = (await dispatch(handlers, "field.load", {
      name: "withops",
    })) as { oplog: string | null };
    expect(result.oplog).toBe(ops);
  });

  test("a world with no manifest → not-found", async () => {
    await expect(
      dispatch(handlers, "field.load", { name: "ghost" }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  test("refuses names that escape the root", async () => {
    // The zod name regex rejects `../escape` at dispatch's safeParse layer BEFORE the
    // handler runs, so the code is invalid-input (not outside-root — the handler's own
    // containment guard is a defence-in-depth backstop the regex never lets it reach).
    await expect(
      dispatch(handlers, "field.load", { name: "../escape" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});

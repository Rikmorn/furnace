// packages/editor/tests/field-load.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonEvent } from "../src/daemon/events.ts";
import { createHandlers, dispatch } from "../src/daemon/handlers.ts";

// An IN-WORKSPACE copy of mini-project: the fixture carries the extensions entry the
// engine bundler resolves through the workspace node_modules, which an os.tmpdir() copy
// could not — the same constraint generation-bake.test.ts documents.
const MINI = join(import.meta.dir, "fixtures", "mini-project");

let root: string;
let handlers: ReturnType<typeof createHandlers>;
let events: DaemonEvent[];

beforeEach(() => {
  root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-field-load-"));
  cpSync(MINI, root, { recursive: true });
  events = [];
  handlers = createHandlers({ root, emit: (e) => events.push(e) });
});

afterEach(() => {
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

  test("returns base64 material siblings alongside chunks", async () => {
    const dir = join(root, "worlds", "painted");
    mkdirSync(join(dir, "chunks"), { recursive: true });
    mkdirSync(join(dir, "materials"), { recursive: true });
    const manifest = {
      version: 2,
      kind: "field",
      cellSize: 0.25,
      playerStart: [0, 0, 0],
      playerYaw: 0,
      chunks: [{ key: "0,0,0", file: "chunks/0_0_0.bin" }],
      meshes: [],
      materials: [{ key: "0,0,0", file: "materials/0_0_0.mat" }],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "chunks", "0_0_0.bin"), new Uint8Array(8 + 4096));
    const matBytes = new Uint8Array([1, 2, 3, 4, 5]);
    writeFileSync(join(dir, "materials", "0_0_0.mat"), matBytes);

    const result = (await dispatch(handlers, "field.load", {
      name: "painted",
    })) as {
      chunks: { key: string; data: string }[];
      materials: { key: string; data: string }[];
    };

    expect(result.materials.length).toBe(1);
    expect(result.materials[0]?.key).toBe("0,0,0");
    expect([...Buffer.from(result.materials[0]?.data ?? "", "base64")]).toEqual(
      [1, 2, 3, 4, 5],
    );
  });

  test("a world with no material siblings → empty materials array", async () => {
    const dir = join(root, "worlds", "rockonly");
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
    writeFileSync(join(dir, "chunks", "0_0_0.bin"), new Uint8Array(8 + 4096));

    const result = (await dispatch(handlers, "field.load", {
      name: "rockonly",
    })) as { materials: { key: string; data: string }[] };
    expect(result.materials).toEqual([]);
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

  // The manifest is on-disk data, not trusted input: a `file` field can carry a
  // `../` traversal even when the world NAME is clean. readSiblings' root-containment
  // guard (abs.startsWith(rootAbs + sep)) is the real path-traversal control on the
  // file-serving path — these two tests drive it directly (one per call site) so
  // deleting the guard fails loudly instead of opening a traversal hole. The escaped
  // path is never read: the guard throws before readFileSync, so the fixture target
  // need not (and does not) exist.
  const TRAVERSAL_FILE = "../../../../../../../../etc/passwd";

  test("refuses a manifest chunk path that escapes the root", async () => {
    const dir = join(root, "worlds", "evilchunk");
    mkdirSync(dir, { recursive: true });
    const manifest = {
      version: 2,
      kind: "field",
      cellSize: 0.25,
      playerStart: [0, 0, 0],
      playerYaw: 0,
      chunks: [{ key: "0,0,0", file: TRAVERSAL_FILE }],
      meshes: [],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));

    await expect(
      dispatch(handlers, "field.load", { name: "evilchunk" }),
    ).rejects.toMatchObject({ code: "outside-root" });
  });

  test("refuses a manifest material sibling path that escapes the root", async () => {
    const dir = join(root, "worlds", "evilmat");
    mkdirSync(dir, { recursive: true });
    const manifest = {
      version: 2,
      kind: "field",
      cellSize: 0.25,
      playerStart: [0, 0, 0],
      playerYaw: 0,
      chunks: [],
      meshes: [],
      materials: [{ key: "0,0,0", file: TRAVERSAL_FILE }],
    };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));

    await expect(
      dispatch(handlers, "field.load", { name: "evilmat" }),
    ).rejects.toMatchObject({ code: "outside-root" });
  });
});

// packages/editor/tests/worlds.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DaemonEvent } from "../src/daemon/events.ts";
import {
  createHandlers,
  dispatch,
  type Handlers,
} from "../src/daemon/handlers.ts";
import { type WorldRow, worldsIndexBytes } from "../src/daemon/worlds.ts";

// An IN-WORKSPACE copy of mini-project: the fixture carries the extensions entry the
// engine bundler resolves through the workspace node_modules, which an os.tmpdir() copy
// could not — the same constraint field-load.test.ts documents.
const MINI = join(import.meta.dir, "fixtures", "mini-project");

let root: string;
let events: DaemonEvent[];

beforeEach(() => {
  root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-worlds-"));
  cpSync(MINI, root, { recursive: true });
  events = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Build a handlers map over the current temp root, optionally injecting the
 *  tracked-checker capability under test (mirrors production's isTracked wiring). */
function build(isTracked?: (rel: string) => boolean | null): Handlers {
  return createHandlers({ root, emit: (e) => events.push(e), isTracked });
}

type ListResult = { defaultName: string | null; worlds: WorldRow[] };

/** Build a field-kind world dir with a manifest, an oplog, and a chunk
 *  sidecar — the on-disk shape world.duplicate must copy in full. Returns
 *  the world's absolute directory path. Reads the outer `root` closure
 *  variable, so it must be called from inside a test body (after beforeEach
 *  has assigned it), matching how the file's other tests already reference
 *  `root` directly. */
function makeFieldWorld(name: string): string {
  const dir = join(root, "worlds", name);
  mkdirSync(join(dir, "chunks"), { recursive: true });
  writeFileSync(join(dir, "oplog.json"), JSON.stringify([]));
  writeFileSync(join(dir, "chunks", "0_0_0.bin"), Buffer.from([1, 2, 3]));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      version: 2,
      kind: "field",
      cellSize: 0.25,
      chunks: [{ key: "0,0,0", file: "chunks/0_0_0.bin" }],
    }),
  );
  return dir;
}

describe("world.list", () => {
  test("enumerates worlds with kind, default flag, and mtime", async () => {
    mkdirSync(join(root, "worlds"), { recursive: true });
    writeFileSync(
      join(root, "worlds", "index.json"),
      JSON.stringify({ version: 1, default: "default" }),
    );

    // Field world created FIRST, legacy "default" LAST: on filesystems where
    // readdir order tracks creation order, the raw order disagrees with alpha
    // order — so the assertion below actually exercises listWorlds's own sort
    // rather than being masked by a test-side .sort() that would pass even if
    // that sort were removed.
    const scratchDir = join(root, "worlds", "scratch-a");
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(join(scratchDir, "oplog.json"), JSON.stringify([]));
    writeFileSync(
      join(scratchDir, "manifest.json"),
      JSON.stringify({
        version: 2,
        kind: "field",
        cellSize: 0.25,
        chunks: [{ key: "0,0,0", file: "chunks/0_0_0.bin" }],
      }),
    );

    // Legacy world: scene-backed, no oplog.json (matches packages/dungeon/worlds/default).
    const defaultDir = join(root, "worlds", "default");
    mkdirSync(defaultDir, { recursive: true });
    writeFileSync(
      join(defaultDir, "world.scene.json"),
      JSON.stringify({ entities: [] }),
    );
    writeFileSync(
      join(defaultDir, "manifest.json"),
      JSON.stringify({ version: 1, scene: "worlds/default/world.scene.json" }),
    );

    // Not a world: no manifest.json at all — must be excluded (crash-safety:
    // manifest-last means a dir without one is a partial/in-progress write).
    mkdirSync(join(root, "worlds", "not-a-world"), { recursive: true });

    const handlers = build();
    const res = (await dispatch(handlers, "world.list", {})) as ListResult;

    expect(res.defaultName).toBe("default");
    const names = res.worlds.map((w) => w.name);
    expect(names).toEqual(["default", "scratch-a"]);

    const def = res.worlds.find((w) => w.name === "default");
    expect(def?.kind).toBe("legacy");
    expect(def?.isDefault).toBe(true);

    const scratch = res.worlds.find((w) => w.name === "scratch-a");
    expect(scratch?.kind).toBe("field");
    expect(scratch?.isDefault).toBe(false);
    expect(scratch?.manifestMtimeMs).toBeGreaterThan(0);
  });

  test("reports tracked via the injected checker; null checker => tracked null", async () => {
    for (const name of ["default", "scratch-a"]) {
      const dir = join(root, "worlds", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version: 1 }));
    }

    const seen: string[] = [];
    const tracked = build((rel) => {
      seen.push(rel);
      return rel.endsWith("default");
    });
    const trackedRes = (await dispatch(
      tracked,
      "world.list",
      {},
    )) as ListResult;
    const trackedDefault = trackedRes.worlds.find((w) => w.name === "default");
    const trackedScratch = trackedRes.worlds.find(
      (w) => w.name === "scratch-a",
    );
    expect(trackedDefault?.tracked).toBe(true);
    expect(trackedScratch?.tracked).toBe(false);
    // Pin the path CONTRACT isTracked receives: project-relative "worlds/<name>",
    // not the bare directory name — a caller that passed entry.name straight
    // through would make every row tracked:true against a repo-root
    // .gitignore rule keyed on "worlds/". Sorted: readdir order isn't
    // guaranteed by POSIX, so the loop's call order isn't either.
    expect([...seen].sort()).toEqual(["worlds/default", "worlds/scratch-a"]);

    const untracked = build();
    const untrackedRes = (await dispatch(
      untracked,
      "world.list",
      {},
    )) as ListResult;
    expect(untrackedRes.worlds.every((w) => w.tracked === null)).toBe(true);

    // Distinguish injected-null (checker present, ambiguous per-row answer)
    // from absent-capability (checker undefined, above): a checker that
    // returns null must flow through as null, not collapse to false — a
    // `?? false` on the per-call result would silently relabel every
    // indeterminate row "scratch" and pass the assertion above by accident.
    const indeterminate = build(() => null);
    const indeterminateRes = (await dispatch(
      indeterminate,
      "world.list",
      {},
    )) as ListResult;
    expect(indeterminateRes.worlds.every((w) => w.tracked === null)).toBe(true);
  });

  test("with no worlds dir returns empty list + defaultName null", async () => {
    const handlers = build();
    const res = (await dispatch(handlers, "world.list", {})) as ListResult;
    expect(res).toEqual({ defaultName: null, worlds: [] });
  });

  test("index.default names a nonexistent world: defaultName reports the ghost name, no row is isDefault", async () => {
    mkdirSync(join(root, "worlds"), { recursive: true });
    writeFileSync(
      join(root, "worlds", "index.json"),
      JSON.stringify({ version: 1, default: "ghost-world" }),
    );
    const dir = join(root, "worlds", "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version: 1 }));

    const handlers = build();
    const res = (await dispatch(handlers, "world.list", {})) as ListResult;
    expect(res.defaultName).toBe("ghost-world");
    expect(res.worlds.some((w) => w.isDefault)).toBe(false);
  });

  test("worlds/ exists but index.json is absent: defaultName null, rows still enumerate", async () => {
    const dir = join(root, "worlds", "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version: 1 }));

    const handlers = build();
    const res = (await dispatch(handlers, "world.list", {})) as ListResult;
    expect(res.defaultName).toBeNull();
    expect(res.worlds.map((w) => w.name)).toEqual(["default"]);
  });

  test("corrupt worlds/index.json degrades to defaultName null; rows still enumerate", async () => {
    mkdirSync(join(root, "worlds"), { recursive: true });
    writeFileSync(join(root, "worlds", "index.json"), "{not valid json");
    const dir = join(root, "worlds", "default");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ version: 1 }));

    const handlers = build();
    const res = (await dispatch(handlers, "world.list", {})) as ListResult;
    expect(res.defaultName).toBeNull();
    expect(res.worlds.map((w) => w.name)).toEqual(["default"]);
  });
});

describe("world mutations", () => {
  test("world.makeDefault rewrites index.json byte-identically and emits worlds-changed", async () => {
    makeFieldWorld("scratch-a");
    const handlers = build();
    await dispatch(handlers, "world.makeDefault", { name: "scratch-a" });
    const bytes = readFileSync(join(root, "worlds", "index.json"), "utf8");
    expect(bytes).toBe('{\n  "version": 1,\n  "default": "scratch-a"\n}\n');
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(1);
  });

  test("world.makeDefault refuses a world whose dir exists but has no manifest (not-found)", async () => {
    // The dir itself DOES exist (unlike a fully-missing name) — this pins
    // "no manifest", not "no dir", which the name-only variant can't tell apart.
    mkdirSync(join(root, "worlds", "dir-no-manifest"), { recursive: true });
    const handlers = build();
    await expect(
      dispatch(handlers, "world.makeDefault", { name: "dir-no-manifest" }),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(existsSync(join(root, "worlds", "index.json"))).toBe(false);
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(0);
  });

  test("world.delete removes the directory and emits worlds-changed", async () => {
    const dir = makeFieldWorld("scratch-a");
    // A valid index naming a DIFFERENT world as default is essential here:
    // this must prove delete succeeds because scratch-a is NOT the default
    // (not merely because no index exists at all) — with no index file, a
    // mutant that treats "any index present" as "this is the default"
    // (e.g. `index !== null` instead of `index?.default === name`) would
    // slip through unnoticed, since both read as "not default" when there's
    // no index. "other-world" doesn't need its own dir — the default-guard
    // check is a plain string comparison against index.default.
    writeFileSync(
      join(root, "worlds", "index.json"),
      worldsIndexBytes("other-world"),
    );
    const handlers = build();
    await dispatch(handlers, "world.delete", { name: "scratch-a" });
    expect(existsSync(dir)).toBe(false);
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(1);
  });

  test("world.delete on a nonexistent world refuses with not-found", async () => {
    const handlers = build();
    await expect(
      dispatch(handlers, "world.delete", { name: "ghost" }),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(0);
  });

  test("world.delete on an existing dir without a manifest succeeds (junk cleanup)", async () => {
    // Pins the controller ruling: a worlds/ dir that never finished writing a
    // manifest is junk, not a "world" — deleting it is allowed, unlike
    // world.makeDefault which requires a manifest to exist.
    const dir = join(root, "worlds", "junk-dir");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stray.txt"), "leftover");
    const handlers = build();
    await dispatch(handlers, "world.delete", { name: "junk-dir" });
    expect(existsSync(dir)).toBe(false);
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(1);
  });

  test("world.delete refuses the current default (invalid-input names the fix)", async () => {
    const dir = makeFieldWorld("scratch-a");
    writeFileSync(
      join(root, "worlds", "index.json"),
      worldsIndexBytes("scratch-a"),
    );
    const handlers = build();
    await expect(
      dispatch(handlers, "world.delete", { name: "scratch-a" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    // Load-bearing: this refusal and the corrupt-index refusal below both
    // carry code "invalid-input" — only the message text distinguishes them,
    // so this regex is what actually pins THIS refusal path (delete-the-
    // default) rather than the corrupt-index one. Don't simplify it away.
    await expect(
      dispatch(handlers, "world.delete", { name: "scratch-a" }),
    ).rejects.toThrow(/make another world default first/);
    expect(existsSync(dir)).toBe(true);
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(0);
  });

  test("world.delete refuses when worlds/index.json exists but is corrupt (can't tell if this is the default)", async () => {
    // If the index degraded silently to "no default" here, the delete-default
    // guard above would be bypassed for whatever world the corrupt index
    // ACTUALLY named default — a destructive delete would go through.
    const dir = makeFieldWorld("scratch-a");
    writeFileSync(join(root, "worlds", "index.json"), "{not valid json");
    const handlers = build();
    await expect(
      dispatch(handlers, "world.delete", { name: "scratch-a" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(existsSync(dir)).toBe(true);
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(0);
  });

  test("world.rename moves the dir; renaming the default also rewrites index.json", async () => {
    const dir = makeFieldWorld("scratch-a");
    writeFileSync(
      join(root, "worlds", "index.json"),
      worldsIndexBytes("scratch-a"),
    );
    const handlers = build();
    await dispatch(handlers, "world.rename", {
      from: "scratch-a",
      to: "scratch-b",
    });
    expect(existsSync(dir)).toBe(false);
    const newDir = join(root, "worlds", "scratch-b");
    expect(existsSync(join(newDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(newDir, "oplog.json"))).toBe(true);
    const bytes = readFileSync(join(root, "worlds", "index.json"), "utf8");
    expect(bytes).toBe('{\n  "version": 1,\n  "default": "scratch-b"\n}\n');
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(1);
  });

  test("world.rename refuses from === to with invalid-input, not a self-contradicting already-exists", async () => {
    makeFieldWorld("scratch-a");
    const handlers = build();
    await expect(
      dispatch(handlers, "world.rename", {
        from: "scratch-a",
        to: "scratch-a",
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(0);
  });

  test("world.rename/duplicate refuse an existing target with already-exists", async () => {
    makeFieldWorld("scratch-a");
    makeFieldWorld("scratch-b");
    // Distinguish scratch-b's chunk bytes from scratch-a's identical fixture
    // output: cpSync defaults to force:true, so an unguarded duplicate would
    // silently overwrite scratch-b with scratch-a's bytes — invisible if the
    // two fixtures happen to be byte-identical, as makeFieldWorld's output is.
    const bChunkPath = join(root, "worlds", "scratch-b", "chunks", "0_0_0.bin");
    writeFileSync(bChunkPath, Buffer.from([9, 9, 9]));

    const handlers = build();
    await expect(
      dispatch(handlers, "world.rename", {
        from: "scratch-a",
        to: "scratch-b",
      }),
    ).rejects.toMatchObject({ code: "already-exists" });
    await expect(
      dispatch(handlers, "world.duplicate", {
        from: "scratch-a",
        to: "scratch-b",
      }),
    ).rejects.toMatchObject({ code: "already-exists" });
    // Neither refusal touched the filesystem or emitted.
    expect(existsSync(join(root, "worlds", "scratch-a"))).toBe(true);
    expect(Array.from(readFileSync(bChunkPath))).toEqual([9, 9, 9]);
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(0);
  });

  test("world.duplicate copies the whole dir recursively (manifest + oplog + chunks present)", async () => {
    const dir = makeFieldWorld("scratch-a");
    const handlers = build();
    await dispatch(handlers, "world.duplicate", {
      from: "scratch-a",
      to: "scratch-copy",
    });
    expect(existsSync(dir)).toBe(true); // source intact
    const copyDir = join(root, "worlds", "scratch-copy");
    expect(existsSync(join(copyDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(copyDir, "oplog.json"))).toBe(true);
    expect(existsSync(join(copyDir, "chunks", "0_0_0.bin"))).toBe(true);
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(1);
  });

  test("world.makeDefault on the already-default world is an idempotent rewrite, not an error", async () => {
    makeFieldWorld("scratch-a");
    writeFileSync(
      join(root, "worlds", "index.json"),
      worldsIndexBytes("scratch-a"),
    );
    const handlers = build();
    await dispatch(handlers, "world.makeDefault", { name: "scratch-a" });
    const bytes = readFileSync(join(root, "worlds", "index.json"), "utf8");
    expect(bytes).toBe('{\n  "version": 1,\n  "default": "scratch-a"\n}\n');
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(1);
  });

  test("world.duplicate of the default world: the copy is not default (index untouched)", async () => {
    makeFieldWorld("scratch-a");
    writeFileSync(
      join(root, "worlds", "index.json"),
      worldsIndexBytes("scratch-a"),
    );
    const handlers = build();
    await dispatch(handlers, "world.duplicate", {
      from: "scratch-a",
      to: "scratch-copy",
    });
    const bytes = readFileSync(join(root, "worlds", "index.json"), "utf8");
    expect(bytes).toBe('{\n  "version": 1,\n  "default": "scratch-a"\n}\n');
    const res = (await dispatch(handlers, "world.list", {})) as ListResult;
    const copy = res.worlds.find((w) => w.name === "scratch-copy");
    expect(copy?.isDefault).toBe(false);
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(1);
  });

  test("all four verbs refuse names failing WORLD_NAME_RE at the zod boundary (invalid-input) — 6/6 fields", async () => {
    const handlers = build();
    await expect(
      dispatch(handlers, "world.makeDefault", { name: "Bad Name!" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      dispatch(handlers, "world.delete", { name: "Bad Name!" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      dispatch(handlers, "world.rename", { from: "Bad Name!", to: "ok" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      dispatch(handlers, "world.rename", { from: "ok", to: "Bad Name!" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      dispatch(handlers, "world.duplicate", { from: "Bad Name!", to: "ok" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      dispatch(handlers, "world.duplicate", { from: "ok", to: "Bad Name!" }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(events.filter((e) => e.type === "worlds-changed")).toHaveLength(0);
  });
});

describe("worldsIndexBytes", () => {
  test("is byte-identical to the client's historical writer (generation.ts)", () => {
    expect(worldsIndexBytes("scratch-a")).toBe(
      '{\n  "version": 1,\n  "default": "scratch-a"\n}\n',
    );
  });
});

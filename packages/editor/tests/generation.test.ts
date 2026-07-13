import { expect, test } from "bun:test";
import {
  bakeUploadCalls,
  initialWorldSession,
  invalidateWorldPreview,
  isValidWorldName,
  layoutBounds,
  mergeContents,
  type RealizeResult,
  toWireFiles,
  type WireFile,
} from "../src/frontend/lib/generation.ts";

test("toWireFiles: utf8 passes through, binary base64 round-trips exactly", () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 128, 42]);
  const wire = toWireFiles([
    { path: "worlds/default/world.scene.json", contents: '{"version":1}' },
    { path: "worlds/default/cave-a.fmesh", contents: bytes },
  ]);

  expect(wire[0]).toEqual({
    path: "worlds/default/world.scene.json",
    encoding: "utf8",
    contents: '{"version":1}',
  });

  const binary = wire[1];
  expect(binary?.encoding).toBe("base64");
  expect(binary?.path).toBe("worlds/default/cave-a.fmesh");
  // Decode the base64 back to the exact bytes (the daemon does the same).
  const decoded = new Uint8Array(Buffer.from(binary?.contents ?? "", "base64"));
  expect([...decoded]).toEqual([...bytes]);
});

test("toWireFiles: base64 survives a > one-chunk buffer (no fromCharCode overflow)", () => {
  const big = new Uint8Array(0x8000 * 2 + 7).map((_, i) => i % 256);
  const wire = toWireFiles([
    { path: "worlds/default/big.fmesh", contents: big },
  ]);
  const decoded = new Uint8Array(
    Buffer.from(wire[0]?.contents ?? "", "base64"),
  );
  expect(decoded.length).toBe(big.length);
  expect([...decoded]).toEqual([...big]);
});

test("layoutBounds: unions min/max across boxes", () => {
  const boxes = [
    { bounds: { min: [0, 0, 0] as const, max: [2, 2, 2] as const } },
    { bounds: { min: [-3, 1, -1] as const, max: [1, 5, 0] as const } },
    { bounds: { min: [1, -2, 4] as const, max: [4, 0, 9] as const } },
  ].map((b) => ({
    bounds: { min: [...b.bounds.min], max: [...b.bounds.max] },
  }));
  const [min, max] = layoutBounds(
    boxes as {
      bounds: { min: [number, number, number]; max: [number, number, number] };
    }[],
  );
  expect(min).toEqual([-3, -2, -1]);
  expect(max).toEqual([4, 5, 9]);
});

test("layoutBounds: empty input returns a sane unit box", () => {
  expect(layoutBounds([])).toEqual([
    [-1, -1, -1],
    [1, 1, 1],
  ]);
});

test("mergeContents: flattens meshes/instanced and destroy tears down every result + the cache", () => {
  const calls: string[] = [];
  const make = (tag: string): RealizeResult => ({
    meshes: [`${tag}-m0`, `${tag}-m1`],
    instanced: [`${tag}-i0`],
    update: () => calls.push(`${tag}:update`),
    destroy: () => calls.push(`${tag}:destroy`),
  });
  const cache = { destroy: () => calls.push("cache:destroy") };

  const merged = mergeContents([make("a"), make("b")], cache);
  expect(merged.meshes).toEqual(["a-m0", "a-m1", "b-m0", "b-m1"]);
  expect(merged.instanced).toEqual(["a-i0", "b-i0"]);

  merged.update?.();
  expect(calls).toEqual(["a:update", "b:update"]);

  merged.destroy();
  // Each result destroyed, then the shared cache last.
  expect(calls.slice(2)).toEqual(["a:destroy", "b:destroy", "cache:destroy"]);
});

test("isValidWorldName", () => {
  expect(isValidWorldName("default")).toBe(true);
  expect(isValidWorldName("My_World2")).toBe(true);
  expect(isValidWorldName("")).toBe(false);
  expect(isValidWorldName("../x")).toBe(false);
  expect(isValidWorldName("a b")).toBe(false);
});

test("mergeContents: a result with no update() is skipped without throwing", () => {
  const merged = mergeContents(
    [{ meshes: [], instanced: [], destroy: () => undefined }],
    { destroy: () => undefined },
  );
  expect(() => merged.update?.()).not.toThrow();
});

// ── The world flow ─────────────────────────────────────────────────────────────

test("initialWorldSession: empty draft, makeDefault on, idle", () => {
  const s = initialWorldSession();
  expect(s.draft).toEqual({ name: "default", regions: [], startRegionId: "" });
  expect(s.makeDefault).toBe(true);
  expect(s.status).toEqual({ phase: "idle" });
  expect(initialWorldSession()).not.toBe(s); // fresh object each call
});

test("invalidateWorldPreview: previewing -> idle; other phases unchanged (same ref)", () => {
  const previewing = {
    ...initialWorldSession(),
    status: {
      phase: "previewing" as const,
      spec: { name: "w", regions: [], connectors: [], startRegion: "" },
    },
  };
  const reset = invalidateWorldPreview(previewing);
  expect(reset.status).toEqual({ phase: "idle" });
  // The draft the user is assembling survives the invalidation untouched.
  expect(reset.draft).toBe(previewing.draft);

  const idle = initialWorldSession();
  expect(invalidateWorldPreview(idle)).toBe(idle); // same reference
  const baking = {
    ...initialWorldSession(),
    status: { phase: "baking" as const },
  };
  expect(invalidateWorldPreview(baking)).toBe(baking);
});

test("bakeUploadCalls: world files cleanDir'd; index.json rides a second cleanDir-FREE call", () => {
  const files: WireFile[] = [
    { path: "worlds/w1/manifest.json", encoding: "utf8", contents: "{}" },
  ];
  const calls = bakeUploadCalls(files, "worlds/w1", "w1", true);
  expect(calls.length).toBe(2);
  expect(calls[0]).toEqual({ files, cleanDir: "worlds/w1" });
  expect(calls[1]?.cleanDir).toBeUndefined(); // outside the world dir — MUST NOT clean
  expect(calls[1]?.files[0]?.path).toBe("worlds/index.json");
  expect(JSON.parse(calls[1]?.files[0]?.contents ?? "")).toEqual({
    version: 1,
    default: "w1",
  });
});

test("bakeUploadCalls: the index write is byte-identical to the committed worlds/index.json shape", () => {
  const [, indexCall] = bakeUploadCalls([], "worlds/default", "default", true);
  // 2-space JSON + a trailing newline — re-defaulting "default" must be a no-op diff
  // against the committed packages/dungeon/worlds/index.json.
  expect(indexCall?.files[0]?.contents).toBe(
    '{\n  "version": 1,\n  "default": "default"\n}\n',
  );
});

test("bakeUploadCalls: makeDefault off -> exactly one call, no index write", () => {
  const files: WireFile[] = [
    { path: "worlds/w1/manifest.json", encoding: "utf8", contents: "{}" },
  ];
  expect(bakeUploadCalls(files, "worlds/w1", "w1", false)).toEqual([
    { files, cleanDir: "worlds/w1" },
  ]);
});

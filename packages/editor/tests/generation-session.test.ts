import { expect, test } from "bun:test";
import {
  type GenerationSession,
  initialSession,
  invalidateDonePreview,
  isValidWingName,
  layoutBounds,
  mergeContents,
  nextRerollSeed,
  type RealizeResult,
  toWireFiles,
} from "../src/frontend/lib/generation.ts";

test("initialSession is a fresh idle session at the P1-bar defaults", () => {
  const s = initialSession();
  expect(s.baseSeed).toBe("wing-1");
  expect(s.config).toEqual({ targetRooms: 6, loopChance: 0.35 });
  expect(s.history).toEqual([]);
  expect(s.status).toEqual({ phase: "idle" });
  // Fresh object each call (no shared mutable state between panels).
  expect(initialSession()).not.toBe(s);
});

test("nextRerollSeed: base first, then #2, #3, … as history grows", () => {
  expect(nextRerollSeed("wing-1", 0)).toBe("wing-1");
  expect(nextRerollSeed("wing-1", 1)).toBe("wing-1#2");
  expect(nextRerollSeed("wing-1", 2)).toBe("wing-1#3");
  expect(nextRerollSeed("cavern", 5)).toBe("cavern#6");
});

test("toWireFiles: utf8 passes through, binary base64 round-trips exactly", () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 128, 42]);
  const wire = toWireFiles([
    { path: "regions/wing.scene.json", contents: '{"version":1}' },
    { path: "regions/wing.fmesh", contents: bytes },
  ]);

  expect(wire[0]).toEqual({
    path: "regions/wing.scene.json",
    encoding: "utf8",
    contents: '{"version":1}',
  });

  const binary = wire[1];
  expect(binary?.encoding).toBe("base64");
  expect(binary?.path).toBe("regions/wing.fmesh");
  // Decode the base64 back to the exact bytes (the daemon does the same).
  const decoded = new Uint8Array(Buffer.from(binary?.contents ?? "", "base64"));
  expect([...decoded]).toEqual([...bytes]);
});

test("toWireFiles: base64 survives a > one-chunk buffer (no fromCharCode overflow)", () => {
  const big = new Uint8Array(0x8000 * 2 + 7).map((_, i) => i % 256);
  const wire = toWireFiles([{ path: "regions/big.fmesh", contents: big }]);
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

test("invalidateDonePreview: a done preview resets to idle, other fields untouched", () => {
  const session: GenerationSession = {
    baseSeed: "wing-1",
    config: { targetRooms: 10, loopChance: 0.5 },
    history: [{ attemptSeed: "wing-1:4", baseSeed: "wing-1" }],
    // The done snapshot carries the config that PRODUCED the preview (rooms 6), which
    // deliberately differs from the live config above (rooms 10) — the exact drift the
    // reset guards against.
    status: {
      phase: "done",
      attemptSeed: "wing-1:4",
      attempt: 4,
      config: { targetRooms: 6, loopChance: 0.35 },
    },
  };
  const next = invalidateDonePreview(session);
  expect(next.status).toEqual({ phase: "idle" });
  expect(next.baseSeed).toBe("wing-1");
  expect(next.config).toEqual({ targetRooms: 10, loopChance: 0.5 });
  expect(next.history).toBe(session.history);
});

test("invalidateDonePreview: a non-done phase is returned unchanged (same reference)", () => {
  const running: GenerationSession = {
    ...initialSession(),
    status: { phase: "running", attempt: 2, totalAttempts: 12 },
  };
  expect(invalidateDonePreview(running)).toBe(running);
  const idle = initialSession();
  expect(invalidateDonePreview(idle)).toBe(idle);
});

test("isValidWingName", () => {
  expect(isValidWingName("generated-wing")).toBe(true);
  expect(isValidWingName("My_Wing2")).toBe(true);
  expect(isValidWingName("")).toBe(false);
  expect(isValidWingName("../x")).toBe(false);
  expect(isValidWingName("a b")).toBe(false);
});

test("mergeContents: a result with no update() is skipped without throwing", () => {
  const merged = mergeContents(
    [{ meshes: [], instanced: [], destroy: () => undefined }],
    { destroy: () => undefined },
  );
  expect(() => merged.update?.()).not.toThrow();
});

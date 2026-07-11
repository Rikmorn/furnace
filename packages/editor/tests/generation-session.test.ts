import { expect, test } from "bun:test";
import {
  clampLoop,
  clampRooms,
  type EnvelopeRow,
  envelopeRowFor,
  type GenerationSession,
  initialSession,
  initialWorldSession,
  invalidateDonePreview,
  invalidateWorldPreview,
  isValidWingName,
  layoutBounds,
  mergeContents,
  nextRerollSeed,
  type RealizeResult,
  reliabilityText,
  rerollSeeds,
  toWireFiles,
  type WorldGenSession,
  worldSpecWithSeeds,
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

const ENVELOPE: EnvelopeRow[] = [
  { rooms: 2, singleShot: 0.9, attempts: 4, projected: 0.9999 },
  { rooms: 3, singleShot: 0.7, attempts: 4, projected: 0.9919 },
  { rooms: 4, singleShot: 0.3, attempts: 9, projected: 0.9596 },
  { rooms: 5, singleShot: 0.05, attempts: 30, projected: 0.7854 },
];

test("envelopeRowFor finds the exact row; off-table is undefined", () => {
  expect(envelopeRowFor(ENVELOPE, 3)?.attempts).toBe(4);
  expect(envelopeRowFor(ENVELOPE, 99)).toBeUndefined();
});

test("clampRooms clamps to the table's range and rounds to an integer", () => {
  expect(clampRooms(ENVELOPE, 15)).toBe(5);
  expect(clampRooms(ENVELOPE, 0)).toBe(2);
  expect(clampRooms(ENVELOPE, 3.6)).toBe(4);
  expect(clampRooms(ENVELOPE, 3)).toBe(3);
});

test("clampLoop clamps to [0, 0.6] and snaps to the 0.05 step", () => {
  expect(clampLoop(0.9)).toBe(0.6);
  expect(clampLoop(-0.2)).toBe(0);
  expect(clampLoop(0.33)).toBe(0.35);
  expect(clampLoop(0.35)).toBe(0.35);
});

test("reliabilityText reads the row; low-yield sizes say so; no row → empty", () => {
  expect(reliabilityText(ENVELOPE[3])).toBe(
    "5 rooms: ~79% within 30 attempts (measured) — low-yield size",
  );
  expect(reliabilityText(ENVELOPE[0])).toBe(
    "2 rooms: ~100% within 4 attempts (measured)",
  );
  expect(reliabilityText(undefined)).toBe("");
});

// ── W1 world flow ──────────────────────────────────────────────────────────────

test("initialWorldSession is a fresh idle session with empty seeds", () => {
  const s = initialWorldSession();
  expect(s.seeds).toEqual(["", ""]);
  expect(s.status).toEqual({ phase: "idle" });
  expect(initialWorldSession()).not.toBe(s); // fresh object each call
});

test("worldSpecWithSeeds substitutes region seeds and preserves every other field", () => {
  const template = {
    name: "default",
    startRegion: "cave-a",
    connectors: [{ id: "t1", seed: "keep" }],
    regions: [
      { id: "cave-a", seed: "old-a", params: { mouths: 1 } },
      { id: "cave-b", seed: "old-b", params: { mouths: 1 } },
    ],
  };
  const next = worldSpecWithSeeds(template, ["new-a", "new-b"]);
  expect(next.regions.map((r) => r.seed)).toEqual(["new-a", "new-b"]);
  // Non-seed region fields survive.
  expect(next.regions[0]?.["id"]).toBe("cave-a");
  expect(next.regions[0]?.["params"]).toEqual({ mouths: 1 });
  // Top-level fields survive by spread.
  expect(next["name"]).toBe("default");
  expect(next["startRegion"]).toBe("cave-a");
  expect(next["connectors"]).toEqual([{ id: "t1", seed: "keep" }]);
  // The template is not mutated.
  expect(template.regions[0]?.seed).toBe("old-a");
});

test("worldSpecWithSeeds keeps the template seed where the input seed is empty", () => {
  const template = { regions: [{ seed: "keep-a" }, { seed: "keep-b" }] };
  const next = worldSpecWithSeeds(template, ["", "new-b"]);
  expect(next.regions.map((r) => r.seed)).toEqual(["keep-a", "new-b"]);
});

test("rerollSeeds bumps a trailing -N, else appends -2", () => {
  expect(rerollSeeds(["world-default:a", "world-default:b"])).toEqual([
    "world-default:a-2",
    "world-default:b-2",
  ]);
  expect(rerollSeeds(["world-default:a-2", "x-9"])).toEqual([
    "world-default:a-3",
    "x-10",
  ]);
});

test("invalidateWorldPreview resets a previewing session to idle; other phases unchanged", () => {
  const previewing: WorldGenSession = {
    seeds: ["a", "b"],
    status: { phase: "previewing", seeds: ["a", "b"] },
  };
  const reset = invalidateWorldPreview(previewing);
  expect(reset.status).toEqual({ phase: "idle" });
  expect(reset.seeds).toEqual(["a", "b"]);

  const idle = initialWorldSession();
  expect(invalidateWorldPreview(idle)).toBe(idle); // same reference
  const baking: WorldGenSession = {
    seeds: ["a", "b"],
    status: { phase: "baking" },
  };
  expect(invalidateWorldPreview(baking)).toBe(baking);
});

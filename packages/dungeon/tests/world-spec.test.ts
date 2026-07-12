import { expect, test } from "bun:test";
import {
  DEFAULT_WORLD,
  snapGridPlacement,
  validateWorldSpec,
  type WorldSpec,
} from "../src/world-spec.ts";

test("validateWorldSpec: DEFAULT_WORLD does not throw", () => {
  expect(() => validateWorldSpec(DEFAULT_WORLD)).not.toThrow();
});

test("validateWorldSpec: an isolated region throws, naming it", () => {
  const spec: WorldSpec = {
    name: "isolated",
    regions: [
      ...DEFAULT_WORLD.regions,
      {
        id: "cave-c",
        class: "field-organic",
        algorithm: "cave",
        params: { mouths: 1 },
        seed: "world-default:c",
        placement: { translation: [20, 0, 0], yaw: 0 },
      },
    ],
    connectors: DEFAULT_WORLD.connectors,
    startRegion: "cave-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(/isolated region.*cave-c/);
});

test("validateWorldSpec: a connector referencing an unknown region throws", () => {
  const spec: WorldSpec = {
    name: "bad-connector",
    regions: DEFAULT_WORLD.regions,
    connectors: [
      {
        id: "tunnel-1",
        kind: "organic-tunnel",
        a: ["cave-a", 0],
        b: ["cave-ghost", 0],
        seed: "world-default:t1",
      },
    ],
    startRegion: "cave-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(/unknown region cave-ghost/);
});

test("validateWorldSpec: duplicate region ids throw", () => {
  const [caveA] = DEFAULT_WORLD.regions;
  if (!caveA) throw new Error("fixture: DEFAULT_WORLD has no regions");
  const spec: WorldSpec = {
    name: "dupes",
    regions: [caveA, caveA],
    connectors: [],
    startRegion: "cave-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(/duplicate region ids/);
});

test("validateWorldSpec: an empty world (no regions) throws", () => {
  const spec: WorldSpec = {
    name: "empty",
    regions: [],
    connectors: [],
    startRegion: "x",
  };
  expect(() => validateWorldSpec(spec)).toThrow(/no regions/);
});

test("validateWorldSpec: a portal claimed by two connectors throws, naming it", () => {
  const spec: WorldSpec = {
    name: "portal-reuse",
    regions: DEFAULT_WORLD.regions,
    connectors: [
      {
        id: "tunnel-1",
        kind: "organic-tunnel",
        a: ["cave-a", 0],
        b: ["cave-b", 0],
        seed: "world-default:t1",
      },
      {
        id: "tunnel-2",
        kind: "organic-tunnel",
        a: ["cave-a", 0], // reuses cave-a:0
        b: ["cave-b", 1],
        seed: "world-default:t2",
      },
    ],
    startRegion: "cave-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(
    /portal cave-a:0 is claimed by more than one connector/,
  );
});

test("validateWorldSpec: a connector whose two ends share one portal throws", () => {
  const spec: WorldSpec = {
    name: "self-loop-portal",
    regions: DEFAULT_WORLD.regions,
    connectors: [
      {
        id: "tunnel-1",
        kind: "organic-tunnel",
        a: ["cave-a", 0],
        b: ["cave-a", 0], // same [region, portal] on both ends
        seed: "world-default:t1",
      },
    ],
    startRegion: "cave-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(
    /portal cave-a:0 is claimed by more than one connector/,
  );
});

test("grid-built region spec validates: lattice translation + quarter yaw", () => {
  const snapped = snapGridPlacement({
    translation: [1.5, 0, -3],
    yaw: Math.PI / 2,
  });
  expect(snapped.translation).toEqual([1.5, 0, -3]);
  expect(snapped.yaw).toBe(Math.PI / 2);
});

test("snapGridPlacement: float dust snaps; real misalignment throws", () => {
  const dusty = snapGridPlacement({
    translation: [1.5000000001, 0, -2.9999999999],
    yaw: Math.PI / 2 + 1e-9,
  });
  expect(dusty.translation).toEqual([1.5, 0, -3]);
  expect(dusty.yaw).toBe(Math.PI / 2);
  expect(() => snapGridPlacement({ translation: [1.3, 0, 0], yaw: 0 })).toThrow(
    /lattice/,
  );
  expect(() => snapGridPlacement({ translation: [0, 0, 0], yaw: 0.3 })).toThrow(
    /quarter/,
  );
});

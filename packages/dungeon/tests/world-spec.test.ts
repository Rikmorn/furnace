import { expect, test } from "bun:test";
import {
  DEFAULT_WORLD,
  snapGridPlacement,
  validateWorldSpec,
  type WorldSpec,
} from "../src/world/world-spec.ts";

test("validateWorldSpec: DEFAULT_WORLD does not throw", () => {
  expect(() => validateWorldSpec(DEFAULT_WORLD)).not.toThrow();
});

test("validateWorldSpec: an isolated region throws, naming it", () => {
  const spec: WorldSpec = {
    name: "isolated",
    regions: [
      ...DEFAULT_WORLD.regions,
      {
        id: "cave-lost",
        class: "field-organic",
        algorithm: "cave",
        params: { mouths: 1 },
        seed: "world-default:lost",
        placement: { translation: [40, 0, 0], yaw: 0 },
      },
    ],
    connectors: DEFAULT_WORLD.connectors, // reach hall-b + cave-c, but never cave-lost
    startRegion: "hall-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(/isolated region.*cave-lost/);
});

test("validateWorldSpec: a connector referencing an unknown region throws", () => {
  const spec: WorldSpec = {
    name: "bad-connector",
    regions: DEFAULT_WORLD.regions,
    connectors: [
      {
        id: "corridor-1",
        kind: "corridor",
        a: ["hall-a", 0],
        b: ["hall-ghost", 0],
        seed: "world-default:t1",
      },
    ],
    startRegion: "hall-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(/unknown region hall-ghost/);
});

test("validateWorldSpec: duplicate region ids throw", () => {
  const [hallA] = DEFAULT_WORLD.regions;
  if (!hallA) throw new Error("fixture: DEFAULT_WORLD has no regions");
  const spec: WorldSpec = {
    name: "dupes",
    regions: [hallA, hallA],
    connectors: [],
    startRegion: "hall-a",
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
        id: "corridor-1",
        kind: "corridor",
        a: ["hall-a", 0],
        b: ["hall-b", 0],
        seed: "world-default:t1",
      },
      {
        id: "corridor-2",
        kind: "corridor",
        a: ["hall-a", 0], // reuses hall-a:0
        b: ["cave-c", 0],
        seed: "world-default:t2",
      },
    ],
    startRegion: "hall-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(
    /portal hall-a:0 is claimed by more than one connector/,
  );
});

test("validateWorldSpec: a connector whose two ends share one portal throws", () => {
  const spec: WorldSpec = {
    name: "self-loop-portal",
    regions: DEFAULT_WORLD.regions,
    connectors: [
      {
        id: "corridor-1",
        kind: "corridor",
        a: ["hall-a", 0],
        b: ["hall-a", 0], // same [region, portal] on both ends
        seed: "world-default:t1",
      },
    ],
    startRegion: "hall-a",
  };
  expect(() => validateWorldSpec(spec)).toThrow(
    /portal hall-a:0 is claimed by more than one connector/,
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

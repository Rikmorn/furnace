import { expect, test } from "bun:test";
import {
  _packScene,
  type Ambient,
  type Light,
  MAX_LIGHTS,
  SCENE_BYTE_SIZE,
} from "../../src/frame/lights.ts";

const f32 = (buf: ArrayBuffer) => new Float32Array(buf);
const u32 = (buf: ArrayBuffer) => new Uint32Array(buf);

test("SCENE_BYTE_SIZE is 1088 (64B header + 16 × 64B lights)", () => {
  expect(SCENE_BYTE_SIZE).toBe(1088);
  expect(MAX_LIGHTS).toBe(16);
});

test("packs ambient into the header (sky@0, ground@16, intensity in sky.w)", () => {
  const buf = new ArrayBuffer(SCENE_BYTE_SIZE);
  const ambient: Ambient = {
    sky: [0.6, 0.65, 0.75],
    ground: [0.2, 0.2, 0.22],
    intensity: 0.05,
  };
  const r = _packScene(buf, [], ambient);
  const v = f32(buf);
  expect([v[0], v[1], v[2]]).toEqual([
    expect.closeTo(0.6),
    expect.closeTo(0.65),
    expect.closeTo(0.75),
  ]);
  expect(v[3]).toBeCloseTo(0.05); // sky.w = intensity
  expect([v[4], v[5], v[6]]).toEqual([
    expect.closeTo(0.2),
    expect.closeTo(0.2),
    expect.closeTo(0.22),
  ]);
  expect(u32(buf)[8]).toBe(0); // lightCount @ offset 32 → element 8
  expect(r.overflowed).toBe(false);
});

test("packs a directional light into lane 0 (offset 64) with type tag 0", () => {
  const buf = new ArrayBuffer(SCENE_BYTE_SIZE);
  const lights: Light[] = [
    {
      type: "directional",
      direction: [0, -1, 0],
      color: [1, 0.9, 0.8],
      intensity: 1.2,
    },
  ];
  _packScene(buf, lights, undefined);
  expect(u32(buf)[8]).toBe(1); // count
  const base = 64 / 4; // light 0 starts at byte 64 → element 16
  // dirType lane is the 2nd vec4 of the light → +4 elements
  expect(f32(buf)[base + 4 + 0]).toBeCloseTo(0); // dir.x
  expect(f32(buf)[base + 4 + 1]).toBeCloseTo(-1); // dir.y
  expect(f32(buf)[base + 4 + 3]).toBeCloseTo(0); // type tag 0 = directional
  // colorInt lane = 3rd vec4 → +8 elements
  expect(f32(buf)[base + 8 + 3]).toBeCloseTo(1.2); // intensity
});

test("packs a spot light: range in posRange.w, type 2, angle→cosine in spotCos", () => {
  const buf = new ArrayBuffer(SCENE_BYTE_SIZE);
  const inner = Math.PI / 8;
  const outer = Math.PI / 6;
  const lights: Light[] = [
    {
      type: "spot",
      position: [1, 2, 3],
      direction: [0, -1, 0],
      color: [1, 1, 1],
      intensity: 1,
      range: 10,
      innerAngle: inner,
      outerAngle: outer,
    },
  ];
  _packScene(buf, lights, undefined);
  const base = 16; // element index of light 0
  expect(f32(buf)[base + 3]).toBeCloseTo(10); // posRange.w = range
  expect(f32(buf)[base + 4 + 3]).toBeCloseTo(2); // type tag 2 = spot
  expect(f32(buf)[base + 12 + 0]).toBeCloseTo(Math.cos(inner)); // spotCos.x
  expect(f32(buf)[base + 12 + 1]).toBeCloseTo(Math.cos(outer)); // spotCos.y
});

test("directional light in a pre-dirtied buffer: shader-read lanes correct, type-irrelevant lane stays dirty", () => {
  // This test pins the unwritten-lane contract documented in `_packScene`'s TSDoc.
  // The engine reuses a single scratch ArrayBuffer frame-to-frame without zeroing it.
  // `_packScene` must fully overwrite every lane the shader reads for a present light —
  // that is what makes buffer reuse safe. Type-irrelevant lanes are intentionally left
  // as-is; the shader is contracted not to read them (it branches on the type tag).
  const buf = new ArrayBuffer(SCENE_BYTE_SIZE);

  // Pre-dirty every float to simulate stale prior-frame content.
  new Float32Array(buf).fill(99);

  const ambient: Ambient = {
    sky: [0.1, 0.2, 0.3],
    ground: [0.4, 0.5, 0.6],
    intensity: 0.07,
  };
  const lights: Light[] = [
    {
      type: "directional",
      direction: [0, -1, 0],
      color: [1, 0.9, 0.8],
      intensity: 1.2,
    },
  ];
  _packScene(buf, lights, ambient);

  const v = f32(buf);
  const base = 16; // light 0 starts at float element 16 (byte 64)

  // lightCount must be written even into a dirtied buffer.
  expect(u32(buf)[8]).toBe(1);

  // Ambient header lanes must be correctly written.
  expect(v[0]).toBeCloseTo(0.1); // sky.r
  expect(v[1]).toBeCloseTo(0.2); // sky.g
  expect(v[2]).toBeCloseTo(0.3); // sky.b
  expect(v[3]).toBeCloseTo(0.07); // intensity in sky.w
  expect(v[4]).toBeCloseTo(0.4); // ground.r
  expect(v[5]).toBeCloseTo(0.5); // ground.g
  expect(v[6]).toBeCloseTo(0.6); // ground.b

  // dirType lane (2nd vec4, +4): the shader reads this for every light type.
  expect(v[base + 4]).toBeCloseTo(0); // dir.x
  expect(v[base + 5]).toBeCloseTo(-1); // dir.y
  expect(v[base + 6]).toBeCloseTo(0); // dir.z
  expect(v[base + 7]).toBeCloseTo(0); // type tag 0 = directional

  // colorInt lane (3rd vec4, +8): all light types share this.
  expect(v[base + 8]).toBeCloseTo(1); // color.r
  expect(v[base + 9]).toBeCloseTo(0.9); // color.g
  expect(v[base + 10]).toBeCloseTo(0.8); // color.b
  expect(v[base + 11]).toBeCloseTo(1.2); // intensity

  // posRange lane (1st vec4, +0): NOT written for directional — intentionally dirty.
  // The shader branches on type tag before reading posRange, so 99 here is correct.
  expect(v[base + 0]).toBe(99); // stale prior-frame content — shader must not read this for directional
});

test("clamps to MAX_LIGHTS and reports overflow", () => {
  const buf = new ArrayBuffer(SCENE_BYTE_SIZE);
  const many: Light[] = Array.from({ length: 20 }, () => ({
    type: "point" as const,
    position: [0, 0, 0],
    color: [1, 1, 1],
    intensity: 1,
    range: 5,
  }));
  const r = _packScene(buf, many, undefined);
  expect(u32(buf)[8]).toBe(MAX_LIGHTS);
  expect(r.overflowed).toBe(true);
});

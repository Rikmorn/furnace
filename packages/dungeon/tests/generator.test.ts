import { expect, test } from "bun:test";
import { generateProxy, generateRegion } from "../src/generator.ts";

test("a region carries provenance, an origin, and a non-empty mesh", () => {
  const region = generateRegion({
    seed: "cavern-1",
    kind: "cavern",
    origin: [0, 0, -40],
  });
  expect(region.provenance.seed).toBe("cavern-1");
  expect(region.provenance.generatorId).toBe("dungeon");
  expect(region.origin).toEqual([0, 0, -40]);
  expect(region.mesh.positions.length).toBeGreaterThan(0);
  expect(region.mesh.indices.length % 3).toBe(0);
});

test("same seed → identical mesh (deterministic)", () => {
  const a = generateRegion({ seed: "s", kind: "cavern", origin: [0, 0, 0] });
  const b = generateRegion({ seed: "s", kind: "cavern", origin: [0, 0, 0] });
  expect(Array.from(a.mesh.positions)).toEqual(Array.from(b.mesh.positions));
});

test("kind selects a different field (shaft vs cavern differ)", () => {
  const cavern = generateRegion({
    seed: "s",
    kind: "cavern",
    origin: [0, 0, 0],
  });
  const shaft = generateRegion({ seed: "s", kind: "shaft", origin: [0, 0, 0] });
  expect(cavern.mesh.positions.length).not.toBe(shaft.mesh.positions.length);
});

test("each region carries a voxel proxy + its body position", () => {
  const r = generateRegion({ seed: "c", kind: "chamber", origin: [0, 0, 0] });
  expect("voxels" in r.proxy).toBe(true);
  if ("voxels" in r.proxy)
    expect(r.proxy.voxels.coords.length).toBeGreaterThan(0);
  expect(r.proxyPosition).toHaveLength(3);
});

test("generateProxy builds a proxy without meshing, deterministically", () => {
  const a = generateProxy({
    seed: "cavern-1",
    kind: "cavern",
    origin: [0, 0, -24],
  });
  const b = generateProxy({
    seed: "cavern-1",
    kind: "cavern",
    origin: [0, 0, -24],
  });
  expect("voxels" in a.proxy).toBe(true);
  expect("voxels" in b.proxy).toBe(true);
  if ("voxels" in a.proxy && "voxels" in b.proxy) {
    expect(Array.from(a.proxy.voxels.coords)).toEqual(
      Array.from(b.proxy.voxels.coords),
    );
  }
});

// The cavern renders from a baked mesh but collides against a proxy regenerated
// at runtime by generateProxy — they MUST agree, or the player would collide with
// a surface that doesn't match what they see. Pin that bake-vs-runtime invariant.
test("generateProxy reproduces generateRegion's proxy (render/collision parity)", () => {
  const params = {
    seed: "cavern-1",
    kind: "cavern" as const,
    origin: [0, 0, -24] as [number, number, number],
  };
  const viaProxy = generateProxy(params);
  const viaRegion = generateRegion(params);
  expect("voxels" in viaProxy.proxy).toBe(true);
  expect("voxels" in viaRegion.proxy).toBe(true);
  if ("voxels" in viaProxy.proxy && "voxels" in viaRegion.proxy) {
    expect(Array.from(viaProxy.proxy.voxels.coords)).toEqual(
      Array.from(viaRegion.proxy.voxels.coords),
    );
  }
  expect(viaProxy.proxyPosition).toEqual(viaRegion.proxyPosition);
});

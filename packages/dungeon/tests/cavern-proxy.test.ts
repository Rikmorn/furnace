import { expect, test } from "bun:test";
import { bakedCavernProxy } from "../src/themes/cave.ts";

// The cavern renders from a baked `.fmesh` but collides against a voxel proxy
// regenerated at runtime by `bakedCavernProxy`. Parity with the static `.fmesh` is
// now by-construction: `bakedCavernProxy` hard-codes the exact field (rounded-box pit),
// grid, seed-derive label, and anisotropic-Y voxel size that baked the mesh, so the
// runtime collider cannot drift from what the player sees. These tests pin the proxy's
// determinism and non-emptiness; the bake/runtime alignment is the source-level invariant.

test("bakedCavernProxy is deterministic for the same seed + origin", () => {
  const a = bakedCavernProxy("cavern-1", [0, 0, -24]);
  const b = bakedCavernProxy("cavern-1", [0, 0, -24]);
  expect("voxels" in a.proxy).toBe(true);
  expect("voxels" in b.proxy).toBe(true);
  if ("voxels" in a.proxy && "voxels" in b.proxy) {
    expect(Array.from(a.proxy.voxels.coords)).toEqual(
      Array.from(b.proxy.voxels.coords),
    );
  }
  expect(a.proxyPosition).toEqual(b.proxyPosition);
});

test("bakedCavernProxy produces a non-empty voxel proxy + a body position", () => {
  const r = bakedCavernProxy("cavern-1", [0, 0, -24]);
  expect("voxels" in r.proxy).toBe(true);
  if ("voxels" in r.proxy) {
    expect(r.proxy.voxels.coords.length).toBeGreaterThan(0);
    expect(r.proxy.voxels.coords.length % 3).toBe(0);
  }
  expect(r.proxyPosition).toHaveLength(3);
});

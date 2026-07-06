import { describe, expect, test } from "bun:test";
import { decodeMeshBlob, encodeMeshBlob } from "@furnace/core/scene";
import { cave, caveDressing, caveProxy } from "../src/themes/cave.ts";

// Parity contract: the runtime paths (proxy without meshing; dressing from the DECODED
// baked mesh) must reproduce cave()'s own colliders[0] / instances byte-for-byte.
// This is what makes "regenerate dressing at load" honest (spec §0.1, §5).
describe("cave runtime extraction", () => {
  const P = {
    theme: "cave" as const,
    seed: "cave-rt-1",
    origin: [0, 0, 0] as [number, number, number],
    mouths: 2,
    capped: 1,
  };

  test("caveProxy reproduces cave()'s voxel collider without meshing", () => {
    const full = cave(P);
    const proxy = caveProxy(P);
    const fullCollider = full.colliders[0];
    const fullShape = fullCollider?.shape;
    if (
      !fullCollider ||
      !fullShape ||
      !("voxels" in fullShape) ||
      !("voxels" in proxy.shape)
    ) {
      throw new Error("expected voxels shapes");
    }
    expect([...proxy.shape.voxels.coords]).toEqual([
      ...fullShape.voxels.coords,
    ]);
    expect(proxy.position).toEqual(fullCollider.position);
  });

  test("caveDressing from the decoded .fmesh reproduces cave()'s instances", () => {
    const full = cave(P);
    const meshGeom = full.meshes[0]?.geometry;
    if (!meshGeom || !("custom" in meshGeom))
      throw new Error("expected custom mesh");
    const decoded = decodeMeshBlob(
      encodeMeshBlob({ render: meshGeom.custom }),
    ).render;
    const dressing = caveDressing(P, decoded);
    expect(dressing.instances.length).toBe(full.instances.length);
    for (let i = 0; i < dressing.instances.length; i++) {
      expect([...(dressing.instances[i]?.transforms ?? [])]).toEqual([
        ...(full.instances[i]?.transforms ?? []),
      ]);
    }
    // Materials: dressing returns wall material + scatter appends (cave() appends
    // masonry AFTER — so dressing.materials is a strict prefix of full.materials).
    expect(full.materials.slice(0, dressing.materials.length)).toEqual(
      dressing.materials,
    );
  });
});

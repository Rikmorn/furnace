import { encodeMeshBlob } from "../../../src/mesh-blob/index.ts";
import type { EntityDoc, SceneDocument } from "../../../src/scene/types.ts";

/** An encoded .fmesh for a 2-triangle floor quad (render == collision). */
export function regionBlob(): ArrayBuffer {
  return encodeMeshBlob({
    render: {
      positions: new Float32Array([-2, 0, -2, 2, 0, -2, 2, 0, 2, -2, 0, 2]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    },
  });
}

/** A scene doc with a 'mesh' geometry resource + a static-trimesh floor.
 *  camera:false drops the camera (fragment tests); trimesh:false drops the rigidBody. */
export function regionFloorDoc(opts?: {
  camera?: boolean;
  trimesh?: boolean;
}): SceneDocument {
  const withCamera = opts?.camera !== false;
  const withTrimesh = opts?.trimesh !== false;
  const floor: Record<string, unknown> = {
    transform: {},
    meshRenderer: { geometry: "regionMesh", material: "m_stone" },
  };
  if (withTrimesh)
    floor["rigidBody"] = { type: "static", shape: { trimesh: true } };
  const entities: EntityDoc[] = [{ id: "floor", components: floor }];
  if (withCamera) {
    entities.unshift({
      id: "cam",
      components: {
        camera: { kind: "perspective", aspect: 1 },
        transform: { position: [0, 3, 6] },
      },
    });
  }
  return {
    version: 1,
    resources: {
      geometries: { regionMesh: { kind: "mesh", src: "region.fmesh" } },
      shaders: { s_lit: { kind: "lit" } },
      materials: {
        m_stone: { shader: "s_lit", params: { color: [0.5, 0.5, 0.52, 1] } },
      },
    },
    entities,
  };
}

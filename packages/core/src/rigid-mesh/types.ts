import type { Geometry } from "../geometry/types.ts";
import type { Material } from "../material/types.ts";
import type { Mesh } from "../mesh/types.ts";
import type { Body, BodyDescriptor } from "../physics/types.ts";
import type { CascadeTeardownSlot } from "../resources/dispose.ts";
import type { RigidMeshHandle } from "../resources/handle.ts";
import type { Quat, Vec3 } from "../transform/types.ts";

/**
 * Opaque handle to a Body+Mesh composite — a rendered {@link Mesh} driven by a
 * physics {@link Body}, with engine-owned fixed-step interpolation.
 */
export type RigidMesh = RigidMeshHandle;

/**
 * Input bundle for {@link create}: a physics body spec (carries the collision
 * shape) plus the render mesh's geometry + material (carries the render shape).
 * The two are independent — collision shape need not equal render shape.
 */
export type RigidMeshDescriptor = {
  body: BodyDescriptor;
  mesh: { geometry: Geometry; material: Material };
};

/** Engine-private slot backing a {@link RigidMesh}. */
export type RigidMeshSlot = CascadeTeardownSlot & {
  body: Body;
  mesh: Mesh;
  /** Previous fixed-tick pose (interpolation scratch — not a source of truth). */
  prevPos: Vec3;
  prevRot: Quat;
  /** Current fixed-tick pose (last committed body pose). */
  currPos: Vec3;
  currRot: Quat;
};

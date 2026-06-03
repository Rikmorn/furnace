import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import * as mesh from "../mesh/index.ts";
import type { Mesh } from "../mesh/types.ts";
import {
  createBody,
  destroyBody,
  getBodyRotation,
  getBodyTranslation,
} from "../physics/index.ts";
import type { Body, World } from "../physics/types.ts";
import { INVALID_HANDLE } from "../resources/handle.ts";
import {
  _allocRigidMesh,
  _destroyRigidMesh,
  _lookupRigidMesh,
} from "../resources/internal.ts";
import { quat, vec3 } from "../transform/index.ts";
import type { RigidMesh, RigidMeshDescriptor, RigidMeshSlot } from "./types.ts";

/**
 * Create a {@link RigidMesh} composite: builds (and owns) a physics {@link Body}
 * from `descriptor.body` and a render {@link Mesh} from `descriptor.mesh`, then
 * seeds the interpolation buffers and the mesh pose to the body's initial pose.
 *
 * The Body is the gameplay truth; the Mesh transform is a derived display
 * output. Drive it with {@link commit} (per fixed tick) + {@link interpolate}
 * (per render frame).
 *
 * @throws FurnaceError - if `descriptor`, `descriptor.body`, or
 *   `descriptor.mesh` is null/undefined.
 * @throws FurnaceError - propagated from `physics.createBody` (bad body
 *   descriptor / dead world) or `mesh.create` (dead geometry/material). If the
 *   body was created but the mesh fails, the body is torn down before
 *   re-throwing (no stranded body).
 */
export function create(
  ctx: Context,
  world: World,
  descriptor: RigidMeshDescriptor,
): RigidMesh {
  if (
    descriptor == null ||
    descriptor.body == null ||
    descriptor.mesh == null
  ) {
    throw new FurnaceError(
      "rigidMesh.create: descriptor with { body, mesh } is required",
    );
  }
  const body = createBody(ctx, world, descriptor.body);
  let m: Mesh;
  try {
    m = mesh.create(ctx, descriptor.mesh);
  } catch (e) {
    destroyBody(ctx, body);
    throw e;
  }
  const slot: RigidMeshSlot = {
    body,
    mesh: m,
    prevPos: vec3.create(),
    prevRot: quat.create(),
    currPos: vec3.create(),
    currRot: quat.create(),
    _teardown: () => {
      destroyBody(ctx, body);
      mesh.destroy(ctx, m);
    },
  };
  // Seed prev = curr = the body's initial pose, and push it to the mesh, so the
  // mesh renders correctly before the first commit/interpolate.
  getBodyTranslation(ctx, body, slot.currPos);
  vec3.copy(slot.prevPos, slot.currPos);
  getBodyRotation(ctx, body, slot.currRot);
  quat.copy(slot.prevRot, slot.currRot);
  mesh.setPosition(ctx, m, slot.currPos);
  mesh.setRotation(ctx, m, slot.currRot);
  return _allocRigidMesh(ctx, slot);
}

/**
 * Destroy a {@link RigidMesh}: tears down the owned body + mesh. Idempotent
 * silent no-op on a stale/destroyed handle.
 */
export function destroy(ctx: Context, rm: RigidMesh): void {
  _destroyRigidMesh<RigidMeshSlot>(ctx, rm, (s) => s._teardown());
}

/**
 * The composite's underlying physics {@link Body} — for applying forces,
 * reading state, or other `physics.*` ops. Hot-path read; returns an invalid
 * sentinel handle on a stale `rm` (downstream `physics.*` ops on it no-op).
 */
export function getBody(ctx: Context, rm: RigidMesh): Body {
  const slot = _lookupRigidMesh<RigidMeshSlot>(ctx, rm);
  // Boundary cast: a stale rm has no body to return, so we re-brand the
  // unbranded invalid-handle sentinel (0) as a Body. Downstream physics.* ops
  // on it resolve to null and no-op.
  if (slot === null) return INVALID_HANDLE as Body;
  return slot.body;
}

/**
 * The composite's underlying render {@link Mesh} — for `mesh.setScale`,
 * `mesh.setMaterial`, or adding to a `frame.render` draw list. Hot-path read;
 * returns an invalid sentinel handle on a stale `rm`.
 */
export function getMesh(ctx: Context, rm: RigidMesh): Mesh {
  const slot = _lookupRigidMesh<RigidMeshSlot>(ctx, rm);
  // Boundary cast: see getBody — re-brand the invalid-handle sentinel as a Mesh.
  if (slot === null) return INVALID_HANDLE as Mesh;
  return slot.mesh;
}

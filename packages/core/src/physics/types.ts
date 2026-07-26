import type * as RAPIER from "@dimforge/rapier3d-compat";
import type { Context } from "../gpu/context-types.ts";
import type { CascadeTeardownSlot } from "../resources/dispose.ts";
import type {
  PhysicsBodyHandle,
  PhysicsWorldHandle,
} from "../resources/handle.ts";

/**
 * The structural slice of {@link Context} that `@furnace/core/physics` actually
 * uses — its engine-internal state, and nothing GPU-owned. Every physics
 * function takes this as its first argument.
 *
 * A full {@link Context} is assignable, so the ordinary
 * `requestContext` → `physics.*` path is unchanged and needs no thought. The
 * type exists so a caller with no GPU at all (a test, a worker) can obtain one
 * from {@link createHeadlessPhysicsContext} instead.
 *
 * **This type is valid for `@furnace/core/physics` only.** It has no `device`,
 * `queue`, `canvas`, `format`, or `pixelRatio`, so passing a value typed as
 * `PhysicsContext` to a `gpu`/`mesh`/`material`/`frame` function is a compile
 * error rather than a runtime surprise.
 */
export type PhysicsContext = Pick<Context, "_internal">;

/** Opaque handle to a physics world (owns the backend world + its bodies). */
export type World = PhysicsWorldHandle;

/** Opaque handle to a rigid body inside a {@link World}. */
export type Body = PhysicsBodyHandle;

/** A 3-component vector as a plain tuple (descriptor input ergonomics). */
export type Vec3Tuple = readonly [number, number, number];
/** A quaternion as a plain `[x,y,z,w]` tuple. */
export type QuatTuple = readonly [number, number, number, number];

/** Input bundle for {@link createWorld}. `lengthUnit` is the approximate size,
 *  in world units, of a 1-meter object — it scales the backend solver's
 *  length-based tolerances so non-meter-scale scenes (sub-meter objects jitter
 *  at the default) stay stable. Optional; furnace supplies a meter-scale
 *  default when omitted. */
export type WorldDescriptor = { gravity: Vec3Tuple; lengthUnit?: number };

/** Collision shape: a sphere (`ball`), box (`cuboid`), cylinder/capsule
 *  (Y-aligned, half-height + radius), a `trimesh` (triangle soup), or `voxels`
 *  (a set of solid grid cells). **`trimesh` and `voxels` are for static (or
 *  kinematic) level geometry only** — no interior volume, never on a `dynamic`
 *  body. `voxels.coords` are signed integer grid coordinates, 3 ints per solid
 *  voxel; each voxel is sized by `size`; the collider is free of the internal-edge
 *  artifact across shared voxel faces. */
export type ShapeDescriptor =
  | { ball: number }
  | { cuboid: Vec3Tuple }
  | { cylinder: { halfHeight: number; radius: number } }
  | { capsule: { halfHeight: number; radius: number } }
  | { trimesh: { vertices: Float32Array; indices: Uint32Array } }
  | { voxels: { coords: Int32Array; size: Vec3Tuple } };

/** Input bundle for {@link createBody}. */
export type BodyDescriptor = {
  type: "dynamic" | "static" | "kinematicPosition";
  shape: ShapeDescriptor;
  position: Vec3Tuple;
  rotation?: QuatTuple;
  linearVelocity?: Vec3Tuple;
  angularVelocity?: Vec3Tuple;
  density?: number;
  /** Coulomb friction coefficient (applies to static + dynamic contact). Pass-through. */
  friction?: number;
  /** Bounciness in [0,1]; 0 = no bounce. Pass-through. */
  restitution?: number;
  /** Per-second linear velocity decay; helps a body come to rest. Pass-through. */
  linearDamping?: number;
  /** Per-second angular velocity decay; helps a spinning body settle. Pass-through. */
  angularDamping?: number;
};

/** A contact begin/end between two bodies, drained after a step. */
export type CollisionEvent = { a: Body; b: Body; started: boolean };

/** Wireframe line data for a world's colliders, from a debug-render pass.
 *  `vertices` is a flat line-list — two consecutive points per line, three
 *  floats (xyz) per point. `colors` is RGBA per vertex (four floats), so
 *  `colors.length === (vertices.length / 3) * 4`. Transient: the arrays are
 *  produced by the backend and valid only until the next `getDebugLines` or
 *  `step`; copy them if you need to retain. */
export type DebugLines = { vertices: Float32Array; colors: Float32Array };

/** Engine-private slot backing a {@link World}. */
export type WorldSlot = CascadeTeardownSlot & {
  rapier: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  bodies: Set<Body>;
  colliderToBody: Map<number, Body>;
  controllers: Set<CharacterController>;
};

/** Engine-private slot backing a {@link Body}. */
export type BodySlot = CascadeTeardownSlot & {
  world: World;
  rapierBody: RAPIER.RigidBody;
  colliderHandle: number;
};

/** Opaque handle to a kinematic character controller, owned by its {@link World}.
 *  Freed by `destroyCharacterController` or when its world is destroyed.
 *  Engine-internal fields are underscore-prefixed; treat it as opaque. */
export type CharacterController = {
  readonly _world: World;
  _rapier: RAPIER.KinematicCharacterController;
  /** Set by destroyCharacterController/destroyWorld. NOT set on a gpu.dispose
   *  cascade (which frees the backend via the world slot's _teardown) — so a
   *  null world lookup, not this flag, is the authoritative post-teardown guard. */
  _destroyed: boolean;
};

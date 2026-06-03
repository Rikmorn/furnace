import type * as RAPIER from "@dimforge/rapier3d-compat";
import type { CascadeTeardownSlot } from "../resources/dispose.ts";
import type {
  PhysicsBodyHandle,
  PhysicsWorldHandle,
} from "../resources/handle.ts";

/** Opaque handle to a physics world (owns the backend world + its bodies). */
export type World = PhysicsWorldHandle;

/** Opaque handle to a rigid body inside a {@link World}. */
export type Body = PhysicsBodyHandle;

/** A 3-component vector as a plain tuple (descriptor input ergonomics). */
export type Vec3Tuple = readonly [number, number, number];
/** A quaternion as a plain `[x,y,z,w]` tuple. */
export type QuatTuple = readonly [number, number, number, number];

/** Input bundle for {@link createWorld}. */
export type WorldDescriptor = { gravity: Vec3Tuple };

/** Collision shape: a sphere (`ball` radius) or box (`cuboid` half-extents). */
export type ShapeDescriptor = { ball: number } | { cuboid: Vec3Tuple };

/** Input bundle for {@link createBody}. */
export type BodyDescriptor = {
  type: "dynamic" | "static";
  shape: ShapeDescriptor;
  position: Vec3Tuple;
  rotation?: QuatTuple;
  linearVelocity?: Vec3Tuple;
  angularVelocity?: Vec3Tuple;
  density?: number;
};

/** A contact begin/end between two bodies, drained after a step. */
export type CollisionEvent = { a: Body; b: Body; started: boolean };

/** Engine-private slot backing a {@link World}. */
export type WorldSlot = CascadeTeardownSlot & {
  rapier: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  bodies: Set<Body>;
  colliderToBody: Map<number, Body>;
};

/** Engine-private slot backing a {@link Body}. */
export type BodySlot = CascadeTeardownSlot & {
  world: World;
  rapierBody: RAPIER.RigidBody;
  colliderHandle: number;
};

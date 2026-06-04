import RAPIER from "@dimforge/rapier3d-compat";
import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _allocPhysicsWorld,
  _destroyPhysicsBody,
  _destroyPhysicsWorld,
  _lookupPhysicsWorld,
} from "../resources/internal.ts";
import { ensureRapierInit } from "./internal.ts";
import type {
  BodySlot,
  CollisionEvent,
  DebugLines,
  World,
  WorldDescriptor,
  WorldSlot,
} from "./types.ts";

const GRAVITY_COMPONENTS = 3;

// furnace-owned default: meter scale (1 world unit per meter). The wrapper
// ALWAYS passes an explicit value so the backend's own default is never relied
// upon — a future backend (Jolt) maps furnace's meter scale to its equivalent.
const DEFAULT_LENGTH_UNIT = 1;

/**
 * Create a physics {@link World}. Lazily runs Rapier's one-time wasm init
 * (memoized), then constructs the backend world with the given gravity and
 * length scale. The descriptor's `lengthUnit` is always forwarded explicitly to
 * the backend — omitting it applies furnace's meter-scale default.
 *
 * @throws FurnaceError - if `gravity` is not a finite 3-component vector.
 */
export async function createWorld(
  ctx: Context,
  descriptor: WorldDescriptor,
): Promise<World> {
  const g = descriptor?.gravity;
  if (
    g == null ||
    g.length !== GRAVITY_COMPONENTS ||
    !g.every((c) => Number.isFinite(c))
  ) {
    throw new FurnaceError(
      "physics.createWorld: gravity must be a finite [x,y,z]",
    );
  }
  await ensureRapierInit();
  const [gx, gy, gz] = g;
  const rapier = new RAPIER.World({ x: gx, y: gy, z: gz });
  rapier.lengthUnit = descriptor.lengthUnit ?? DEFAULT_LENGTH_UNIT;
  const eventQueue = new RAPIER.EventQueue(true);
  const slot: WorldSlot = {
    rapier,
    eventQueue,
    bodies: new Set(),
    colliderToBody: new Map(),
    _teardown: () => {
      eventQueue.free();
      rapier.free();
    },
  };
  return _allocPhysicsWorld(ctx, slot);
}

/**
 * Advance the world by `dtSeconds`. Hot-path Command — silent no-op on a
 * stale/destroyed world handle. Populates the world's collision-event buffer,
 * drained by {@link drainCollisions}.
 */
export function step(ctx: Context, world: World, dtSeconds: number): void {
  const slot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
  if (slot === null) return;
  slot.rapier.timestep = dtSeconds;
  slot.rapier.step(slot.eventQueue);
}

/**
 * Drain collision begin/end events recorded by the most recent {@link step}.
 * Hot-path read — returns `[]` on a stale world or when nothing collided.
 * Events whose bodies were destroyed mid-step are dropped.
 */
export function drainCollisions(ctx: Context, world: World): CollisionEvent[] {
  const slot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
  if (slot === null) return [];
  const events: CollisionEvent[] = [];
  slot.eventQueue.drainCollisionEvents((h1, h2, started) => {
    const a = slot.colliderToBody.get(h1);
    const b = slot.colliderToBody.get(h2);
    if (a === undefined || b === undefined) return;
    events.push({ a, b, started });
  });
  return events;
}

/**
 * Read the world's colliders as a wireframe line-list — a pure pass-through to
 * Rapier's debug renderer. Hot-path read: returns empty buffers on a
 * stale/destroyed world. The returned arrays are transient (see
 * {@link DebugLines}). Pair with `frame.drawLines` to overlay the colliders on
 * the rendered scene.
 */
export function getDebugLines(ctx: Context, world: World): DebugLines {
  const slot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
  if (slot === null) {
    return { vertices: new Float32Array(0), colors: new Float32Array(0) };
  }
  const buffers = slot.rapier.debugRender();
  return { vertices: buffers.vertices, colors: buffers.colors };
}

/**
 * Destroy a {@link World}: tear down every body it owns (removing each from
 * the still-live backend world), then free the backend world + its event
 * queue. Idempotent silent no-op on a stale/destroyed handle.
 */
export function destroyWorld(ctx: Context, world: World): void {
  const slot = _lookupPhysicsWorld<WorldSlot>(ctx, world);
  if (slot === null) return;
  // Snapshot — each body teardown mutates slot.bodies.
  for (const body of [...slot.bodies]) {
    _destroyPhysicsBody<BodySlot>(ctx, body, (s) => s._teardown());
  }
  _destroyPhysicsWorld<WorldSlot>(ctx, world, (s) => s._teardown());
}

export type {
  Body,
  BodyDescriptor,
  CollisionEvent,
  ShapeDescriptor,
  World,
  WorldDescriptor,
} from "./types.ts";
export { createWorld, destroyWorld, drainCollisions, step } from "./world.ts";

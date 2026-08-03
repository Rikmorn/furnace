import { expect, test } from "bun:test";
import { createResourceManager } from "./manager.ts";

test("createResourceManager returns all initialised pools", () => {
  const mgr = createResourceManager();
  expect(mgr.meshes).toBeDefined();
  expect(mgr.materials).toBeDefined();
  expect(mgr.geometries).toBeDefined();
  expect(mgr.effects).toBeDefined();
  expect(mgr.shaders).toBeDefined();
  expect(mgr.bindings).toBeDefined();
});

test("each pool starts at the initial capacity with slot 0 reserved", () => {
  const mgr = createResourceManager();
  expect(mgr.meshes.size).toBe(64);
  expect(mgr.materials.size).toBe(64);
  expect(mgr.geometries.size).toBe(64);
  expect(mgr.effects.size).toBe(64);
  expect(mgr.meshes.free.length).toBe(63);
  expect(mgr.materials.free.length).toBe(63);
  expect(mgr.geometries.free.length).toBe(63);
  expect(mgr.effects.free.length).toBe(63);
});

test("each pool starts empty (no live slots)", () => {
  const mgr = createResourceManager();
  expect(mgr.meshes.slots[1]).toBeNull();
  expect(mgr.materials.slots[1]).toBeNull();
  expect(mgr.geometries.slots[1]).toBeNull();
  expect(mgr.effects.slots[1]).toBeNull();
});

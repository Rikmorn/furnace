import { expect, test } from "bun:test";
import {
  createResourceRegistry,
  recordAlloc,
  recordDestroy,
} from "../../src/stats/resources.ts";

test("createResourceRegistry: starts with zero counts and zero memory", () => {
  const r = createResourceRegistry();
  expect(r.counts.meshes).toBe(0);
  expect(r.counts.materials).toBe(0);
  expect(r.counts.geometries).toBe(0);
  expect(r.counts.effects).toBe(0);
  expect(r.memory.bufferBytes).toBe(0);
  expect(r.memory.textureBytes).toBe(0);
});

test("recordAlloc/recordDestroy: mesh kind round-trips counts.meshes to 0", () => {
  const r = createResourceRegistry();
  recordAlloc(r, "mesh", 0);
  recordAlloc(r, "mesh", 0);
  expect(r.counts.meshes).toBe(2);
  recordDestroy(r, "mesh", 0);
  recordDestroy(r, "mesh", 0);
  expect(r.counts.meshes).toBe(0);
});

test("recordAlloc/recordDestroy: buffer kind round-trips memory.bufferBytes to 0", () => {
  const r = createResourceRegistry();
  recordAlloc(r, "buffer", 256);
  recordAlloc(r, "buffer", 64);
  expect(r.memory.bufferBytes).toBe(320);
  recordDestroy(r, "buffer", 256);
  recordDestroy(r, "buffer", 64);
  expect(r.memory.bufferBytes).toBe(0);
});

test("recordAlloc: texture kind increments memory.textureBytes separately from bufferBytes", () => {
  const r = createResourceRegistry();
  recordAlloc(r, "texture", 1024);
  recordAlloc(r, "buffer", 128);
  expect(r.memory.textureBytes).toBe(1024);
  expect(r.memory.bufferBytes).toBe(128);
});

test("recordAlloc: kinds are independent (mesh alloc doesn't affect material count)", () => {
  const r = createResourceRegistry();
  recordAlloc(r, "mesh", 0);
  expect(r.counts.meshes).toBe(1);
  expect(r.counts.materials).toBe(0);
  expect(r.counts.geometries).toBe(0);
  expect(r.counts.effects).toBe(0);
});

test("recordAlloc: effect kind increments counts.effects", () => {
  const r = createResourceRegistry();
  recordAlloc(r, "effect", 0);
  expect(r.counts.effects).toBe(1);
  recordDestroy(r, "effect", 0);
  expect(r.counts.effects).toBe(0);
});

test("recordAlloc: geometry kind increments counts.geometries", () => {
  const r = createResourceRegistry();
  recordAlloc(r, "geometry", 0);
  expect(r.counts.geometries).toBe(1);
  recordDestroy(r, "geometry", 0);
  expect(r.counts.geometries).toBe(0);
});

test("recordAlloc: binding kind increments counts.bindings", () => {
  const r = createResourceRegistry();
  recordAlloc(r, "binding", 0);
  expect(r.counts.bindings).toBe(1);
  recordDestroy(r, "binding", 0);
  expect(r.counts.bindings).toBe(0);
});

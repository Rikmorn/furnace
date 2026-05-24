import { expect, test } from "bun:test";
import {
  createResourceRegistry,
  registerResource,
  unregisterResource,
} from "../../src/stats/resources.ts";

test("createResourceRegistry: starts with empty set and zero counters", () => {
  const r = createResourceRegistry();
  expect(r.entries.size).toBe(0);
  expect(r.counts.meshes).toBe(0);
  expect(r.counts.materials).toBe(0);
  expect(r.counts.geometries).toBe(0);
  expect(r.memory.bufferBytes).toBe(0);
  expect(r.memory.textureBytes).toBe(0);
});

test("registerResource: 'mesh' kind increments meshes count", () => {
  const r = createResourceRegistry();
  registerResource(r, { kind: "mesh" });
  expect(r.counts.meshes).toBe(1);
  expect(r.entries.size).toBe(1);
});

test("registerResource: 'buffer' kind adds bytes to bufferBytes", () => {
  const r = createResourceRegistry();
  registerResource(r, { kind: "buffer", bytes: 64 });
  expect(r.memory.bufferBytes).toBe(64);
  expect(r.counts.meshes).toBe(0);
});

test("registerResource: 'texture' kind adds bytes to textureBytes", () => {
  const r = createResourceRegistry();
  registerResource(r, { kind: "texture", bytes: 1024 });
  expect(r.memory.textureBytes).toBe(1024);
});

test("registerResource: returns a handle the unregister call accepts", () => {
  const r = createResourceRegistry();
  const handle = registerResource(r, { kind: "mesh" });
  expect(handle.kind).toBe("mesh");
  expect(handle.bytes).toBe(0);
  unregisterResource(r, handle);
  expect(r.counts.meshes).toBe(0);
  expect(r.entries.size).toBe(0);
});

test("unregisterResource: subtracts bytes from the matching memory bucket", () => {
  const r = createResourceRegistry();
  const h = registerResource(r, { kind: "buffer", bytes: 256 });
  unregisterResource(r, h);
  expect(r.memory.bufferBytes).toBe(0);
  expect(r.entries.size).toBe(0);
});

test("registerResource: multiple registrations accumulate correctly", () => {
  const r = createResourceRegistry();
  registerResource(r, { kind: "mesh" });
  registerResource(r, { kind: "mesh" });
  registerResource(r, { kind: "geometry" });
  registerResource(r, { kind: "buffer", bytes: 100 });
  registerResource(r, { kind: "buffer", bytes: 200 });
  registerResource(r, { kind: "texture", bytes: 4096 });
  expect(r.counts.meshes).toBe(2);
  expect(r.counts.geometries).toBe(1);
  expect(r.memory.bufferBytes).toBe(300);
  expect(r.memory.textureBytes).toBe(4096);
  expect(r.entries.size).toBe(6);
});

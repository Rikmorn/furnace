import { expect, test } from "bun:test";
import { decodeMeshBlob, encodeMeshBlob } from "./mesh-blob.ts";

test("encode→decode round-trips render buffers exactly", () => {
  const render = {
    positions: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const buf = encodeMeshBlob({ render });
  const out = decodeMeshBlob(buf);
  expect(Array.from(out.render.positions)).toEqual(
    Array.from(render.positions),
  );
  expect(Array.from(out.render.indices)).toEqual([0, 1, 2]);
  expect(out.collision).toBeUndefined();
});

test("optional collision block round-trips", () => {
  const render = {
    positions: new Float32Array([0, 1, 2]),
    normals: new Float32Array([0, 0, 1]),
    uvs: new Float32Array([0, 0]),
    indices: new Uint32Array([0]),
  };
  const collision = {
    vertices: new Float32Array([9, 8, 7]),
    indices: new Uint32Array([0]),
  };
  const out = decodeMeshBlob(encodeMeshBlob({ render, collision }));
  expect(out.collision).toBeDefined();
  expect(Array.from(out.collision?.vertices ?? [])).toEqual([9, 8, 7]);
});

import { describe, expect, test } from "bun:test";
import {
  applyOp,
  chunkKey,
  createFieldStore,
  extractApron,
} from "@furnace/core/field";
import type { FieldWorkerResponse } from "../src/frontend/lib/field-protocol.ts";
import { createFieldWorkerHandler } from "../src/frontend/lib/field-protocol.ts";

describe("field worker protocol", () => {
  test("mesh request posts transferable buffers for a carved apron", () => {
    const s = createFieldStore();
    applyOp(s, {
      id: 1,
      kind: "dig",
      shape: { kind: "sphere", center: [2, 2, 2], radius: 1.2 },
    });
    const posts: { msg: FieldWorkerResponse; transfer: Transferable[] }[] = [];
    const handler = createFieldWorkerHandler((msg, transfer) =>
      posts.push({ msg, transfer }),
    );
    const apron = extractApron(s, chunkKey(0, 0, 0));
    handler({
      kind: "mesh",
      jobId: 7,
      key: "0,0,0",
      apron: apron.buffer as ArrayBuffer,
      cellSize: 0.25,
    });
    expect(posts.length).toBe(1);
    const first = posts[0] as (typeof posts)[0];
    expect(first.msg.kind).toBe("meshed");
    expect(first.transfer.length).toBe(4);
    if (first.msg.kind === "meshed") {
      expect(new Uint32Array(first.msg.indices).length).toBeGreaterThan(0);
    }
  });

  test("bad apron posts mesh-error, never throws", () => {
    const posts: FieldWorkerResponse[] = [];
    const handler = createFieldWorkerHandler((msg) => posts.push(msg));
    handler({
      kind: "mesh",
      jobId: 1,
      key: "0,0,0",
      apron: new ArrayBuffer(3),
      cellSize: 0.25,
    });
    expect(posts[0]?.kind).toBe("mesh-error");
  });
});

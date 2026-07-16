// FieldHost.loadWorld's oplog path, headless (no init(): the remesh worker
// spawns lazily and exportArtifact bakes in-process). Real on-disk worlds
// (packages/dungeon/worlds/*/oplog.json) carry legacy F1 `kind:"dig"` ops, so
// loadWorld takes the RAW oplog text and parses it via field.parseOps inside
// the host — otherwise legacy objects land in log.ops matching NEITHER FieldOp
// union member and isBrushOp silently skips them.
import { expect, test } from "bun:test";
import type { FieldManifest } from "@furnace/core/field";
import { DEFAULT_CELL_SIZE } from "@furnace/core/field";
import { createFieldHost } from "../src/viewport-host/field-host.ts";

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [0, 0, 0],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

/** The baked oplog.json contents as RAW parsed JSON — deliberately NOT via
 *  parseOps, which would re-map legacy ops and mask a loadWorld that skipped
 *  the mapping. */
const bakedOplog = (host: ReturnType<typeof createFieldHost>): unknown => {
  const file = host
    .exportArtifact("t")
    .find((f) => f.path === "worlds/t/oplog.json");
  expect(typeof file?.contents).toBe("string");
  return JSON.parse(file?.contents as string);
};

test('loadWorld parses raw oplog text: legacy kind:"dig" maps to brush/dig', () => {
  const host = createFieldHost();
  host.loadWorld({
    manifest: MANIFEST,
    chunks: [],
    oplog:
      '[{"id":1,"kind":"dig","shape":{"kind":"sphere","center":[1,2,3],"radius":0.75}}]',
  });
  expect(bakedOplog(host)).toEqual([
    {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [1, 2, 3], radius: 0.75 },
    },
  ]);
});

test("loadWorld with a null oplog loads an empty op list", () => {
  const host = createFieldHost();
  host.loadWorld({ manifest: MANIFEST, chunks: [], oplog: null });
  expect(bakedOplog(host)).toEqual([]);
});

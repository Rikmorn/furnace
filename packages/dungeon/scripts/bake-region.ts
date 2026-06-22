import { encodeMeshBlob } from "@furnace/core/scene";
import { generateRegion } from "../src/generator.ts";

const SEED = "cavern-1";
const ORIGIN: [number, number, number] = [0, 0, -24];
const region = generateRegion({ seed: SEED, kind: "cavern", origin: ORIGIN });

// Render-only since 2.2.1: collision is a field-derived voxel proxy regenerated
// at runtime from the same seed/kind/origin (deterministic → matches the bake), so
// the scene carries NO rigidBody and the .fmesh holds only render buffers.
const fmesh = encodeMeshBlob({ render: region.mesh });
await Bun.write("packages/dungeon/regions/region-cavern.fmesh", fmesh);

const scene = {
  version: 1,
  settings: {
    region: {
      provenance: {
        generatorId: region.provenance.generatorId,
        generatorVersion: region.provenance.generatorVersion,
        seed: SEED,
        kind: region.provenance.kind,
      },
      theme: region.theme,
      origin: ORIGIN,
    },
  },
  resources: {
    geometries: {
      regionMesh: { kind: "mesh", src: "/regions/region-cavern.fmesh" },
    },
    shaders: { s_lit: { kind: "lit" } },
    materials: {
      m_stone: { shader: "s_lit", params: { color: [0.5, 0.5, 0.52, 1] } },
    },
  },
  entities: [
    {
      id: "region-cavern",
      components: {
        transform: { position: ORIGIN },
        meshRenderer: { geometry: "regionMesh", material: "m_stone" },
      },
    },
  ],
};
await Bun.write(
  "packages/dungeon/regions/region-cavern.scene.json",
  JSON.stringify(scene, null, 2),
);
// JSON.stringify expands arrays; biome wants them inline. Run after re-baking:
//   bunx biome format --write packages/dungeon/regions/region-cavern.scene.json
console.log("baked region-cavern (run biome format on the .scene.json)");

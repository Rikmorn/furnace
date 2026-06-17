import { encodeMeshBlob } from "@furnace/core/scene";
import { generateRegion } from "../src/generator.ts";

const SEED = "cavern-1";
const ORIGIN: [number, number, number] = [0, 0, -24];
const region = generateRegion({ seed: SEED, kind: "cavern", origin: ORIGIN });

// render == collision in 2.1: omit the collision block (the 'mesh' resource retains
// the render buffers for the trimesh collider).
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
        rigidBody: { type: "static", shape: { trimesh: true } },
      },
    },
  ],
};
await Bun.write(
  "packages/dungeon/regions/region-cavern.scene.json",
  JSON.stringify(scene, null, 2),
);
console.log("baked region-cavern");

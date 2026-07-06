// packages/dungeon/scripts/bake-generated-wing.ts
// 3.0 gate artifact: prove generate → bake → load end to end, headless, with the
// SAME persistence machinery the game already uses (2.1 .fmesh + region scene doc).
// Deterministic: fixed seed + small single-sector config → committed test fixtures.
// Run: bun packages/dungeon/scripts/bake-generated-wing.ts
import { encodeMeshBlob } from "@furnace/core/scene";
import { buildWorld } from "../src/world.ts";

const SEED = "bake-roundtrip-0";
const { graph, layout } = buildWorld(SEED, {
  sectors: [1, 1],
  targetRooms: 4,
  loopChance: 0,
  attempts: 5,
});

const caveIdx = graph.nodes.findIndex((n) => n.theme === "cave");
if (caveIdx < 0) {
  throw new Error(
    "bake: no cave node in the generated world — pick another SEED",
  );
}
const region = layout.regions[caveIdx];
if (!region) throw new Error("bake: cave region missing");
const mesh = region.meshes.find((m) => "custom" in m.geometry);
if (!mesh || !("custom" in mesh.geometry)) {
  throw new Error("bake: cave has no custom mesh");
}

// placePiece transforms mesh.position/mesh.rotation to WORLD but leaves
// mesh.geometry.custom (the vertex data) in LOCAL frame — encode the LOCAL
// vertices; the scene doc's transform positions them in world (avoids a
// double-offset).
const fmesh = encodeMeshBlob({ render: mesh.geometry.custom });
await Bun.write("packages/dungeon/tests/fixtures/generated-wing.fmesh", fmesh);

const transform: {
  position: typeof mesh.position;
  rotation?: typeof mesh.rotation;
} = {
  position: mesh.position,
};
if (mesh.rotation) transform.rotation = mesh.rotation;

const scene = {
  version: 1,
  settings: {
    region: {
      provenance: {
        generatorId: "dungeon",
        generatorVersion: 1,
        seed: SEED,
        kind: "cave",
      },
      theme: "cave",
      origin: mesh.position,
    },
  },
  resources: {
    geometries: {
      regionMesh: { kind: "mesh", src: "/fixtures/generated-wing.fmesh" },
    },
    shaders: { s_lit: { kind: "lit" } },
    materials: {
      m_stone: { shader: "s_lit", params: { color: [0.5, 0.5, 0.52, 1] } },
    },
  },
  entities: [
    {
      id: "generated-wing",
      components: {
        transform,
        meshRenderer: { geometry: "regionMesh", material: "m_stone" },
      },
    },
  ],
};
await Bun.write(
  "packages/dungeon/tests/fixtures/generated-wing.scene.json",
  JSON.stringify(scene, null, 2),
);
// JSON.stringify expands arrays; biome wants them inline. Run after re-baking:
//   bunx biome format --write packages/dungeon/tests/fixtures/generated-wing.scene.json
console.log(
  `baked generated-wing from seed "${SEED}" (cave node index ${caveIdx}; run biome format on the .scene.json)`,
);

// packages/dungeon/scripts/measure/subjects.ts
// The POPULATIONS `measure-analyze.ts` measures: generated caves (bare and propped), the
// P-F3-1 walked-config matrix, and every committed v2 field world. Construction only — this
// module runs no analysis and prints nothing.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import * as field from "@furnace/core/field";
import { AGENT } from "../../src/walkability.ts";

const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
const WORLDS_DIR = join(PACKAGE_ROOT, "worlds");
const CATALOG_PATH = join(PACKAGE_ROOT, "catalog", "entities.json");

/** One measured world: the store, the extra solidity its props contribute, and where the agent
 *  starts. `extraSolid` is passed to EVERY analyzer entry point — the column pass, the
 *  reachability flood and the pit detector must read one solidity or the floods would walk
 *  through props the column pass treats as walls. */
export type Subject = {
  label: string;
  note: string;
  store: field.FieldStore;
  extraSolid: Map<field.ChunkKey, Uint8Array> | undefined;
  seeds: [number, number, number][];
  props: number;
};

// ─── generated caves ───

/** The F3b default cave region — the same fixture the P-F4-1 budget test carves, and the
 *  extent the P-F3-1 walk harness uses for its whole matrix. */
export const CAVE_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [20, 10, 20] as [number, number, number],
};
/** Seed for the default-cave rows (the P-F4-1 fixture's). The P-F3-1 matrix seeds itself. */
export const CAVE_SEED = 1;

function caveGenerator(): field.GeneratorDef {
  const cave = field.generatorById("cave");
  if (cave === undefined) throw new Error("measure: no cave generator");
  return cave;
}

/** The cave generator's own schema defaults — theme `mixed`, verticality 0.5, which is NOT any
 *  cell of the P-F3-1 matrix (that one sweeps verticality 0.25 / 0.75). */
export const caveDefaults = (): Record<string, unknown> =>
  caveGenerator().defaults;

export function carveCave(
  params: Record<string, unknown>,
  seed: number,
): field.FieldStore {
  const store = field.createFieldStore();
  field.commitGenerator(store, field.createOpLog(), caveGenerator(), {
    params,
    seed,
    region: CAVE_REGION,
    policy: "replace",
    table: field.BUILTIN_TABLE,
  });
  return store;
}

const chamberFloorY = (c: field.CaveChamber): number =>
  c.center[1] - c.radii[1];

const extentOf = (): [number, number, number] => [
  CAVE_REGION.max[0] - CAVE_REGION.min[0],
  CAVE_REGION.max[1] - CAVE_REGION.min[1],
  CAVE_REGION.max[2] - CAVE_REGION.min[2],
];

/** EVERY chamber centre, in world space — the seed set the P-F4-3 measurement used for a
 *  generated cave, which carries no authored `playerStart`. Kept so the default-cave rows stay
 *  comparable against that run. More seeds reach more flags, so the walkable-ground count it
 *  produces is an upper bound; note that is NOT true of the pit count, which is not monotone in
 *  the seed set either way (a seed inside a hollow un-pits it; a seed that opens new ground can
 *  add one). */
export function chamberSeeds(
  params: Record<string, unknown>,
  seed: number,
): [number, number, number][] {
  const skeleton = field.buildCaveSkeleton(params, seed, extentOf());
  return skeleton.chambers.map((c) => [
    c.center[0] + CAVE_REGION.min[0],
    c.center[1] + CAVE_REGION.min[1],
    c.center[2] + CAVE_REGION.min[2],
  ]);
}

/** The `playerStart` the P-F3-1 walk harness bakes for a config: chamber 0's floor, one
 *  grounded capsule-rest above it. Derived from {@link AGENT} rather than restated, so it
 *  cannot drift from the profile the analyzer reads. THE world's own spawn for a walked
 *  config — what Task 8's in-harness tooth will use. */
export function spawnSeed(
  params: Record<string, unknown>,
  seed: number,
): [number, number, number] {
  const skeleton = field.buildCaveSkeleton(params, seed, extentOf());
  const c0 = skeleton.chambers[0];
  if (c0 === undefined)
    throw new Error("measure: cave skeleton has no chambers");
  const rest = AGENT.capsule.halfHeight + AGENT.capsule.radius;
  return [
    c0.center[0] + CAVE_REGION.min[0],
    chamberFloorY(c0) + CAVE_REGION.min[1] + rest,
    c0.center[2] + CAVE_REGION.min[2],
  ];
}

/** The P-F3-1 walked matrix, RESTATED from `tests/field-cave-walk.gpu.test.ts` (3 themes × 2
 *  verticality × 2 seeds). It cannot be imported: that file awaits a WebGPU context at module
 *  scope. The duplication is the reason Task 8 moves this measurement INTO the harness — until
 *  it does, a matrix edited there and not here silently measures the wrong population. */
const THEMES = ["mined", "organic", "mixed"] as const;
const VERTICALITIES = [0.25, 0.75] as const;
const WALK_SEEDS = [1, 7] as const;

export type WalkConfig = {
  name: string;
  params: Record<string, unknown>;
  seed: number;
};

export const walkConfigs = (): WalkConfig[] =>
  THEMES.flatMap((theme) =>
    VERTICALITIES.flatMap((verticality) =>
      WALK_SEEDS.map((seed) => ({
        name: `${theme}/v${verticality}/s${seed}`,
        params: { ...caveDefaults(), theme, verticality },
        seed,
      })),
    ),
  );

// ─── the catalog (placement collision primitives) ───

type CatalogArchetype = {
  id: string;
  collision: field.PlacementCollision;
  scatter?: Record<string, unknown>;
};

export type Catalog = ReadonlyMap<string, CatalogArchetype>;

export async function readCatalog(): Promise<Catalog> {
  // Boundary parse: entities.json is authored data; only the fields this script reads are typed.
  const parsed = JSON.parse(await Bun.file(CATALOG_PATH).text()) as {
    archetypes: CatalogArchetype[];
  };
  return new Map(parsed.archetypes.map((a) => [a.id, a]));
}

/** Group placement records by the archetype collision they share — `voxelizePlacements`' input,
 *  and the same grouping `analyzerVerify` takes. */
function collisionGroups(
  catalog: Catalog,
  byArchetype: readonly { id: string; records: field.PlacementRecord[] }[],
): field.PlacementCollisionGroup[] {
  return byArchetype.map(({ id, records }) => {
    const archetype = catalog.get(id);
    if (archetype === undefined)
      throw new Error(
        `measure: placement archetype "${id}" is absent from catalog/entities.json`,
      );
    return { collision: archetype.collision, records };
  });
}

/** The densest prop set the scatter schema allows, used for the P-F4-4 stress row: the authored
 *  catalog densities put only a dozen props in this cave, which is far too few to show whether
 *  prop solidity FLOODS the candidate filters. Schema maxima, not a proposal. */
export const STRESS_SCATTER = { density: 2, minSpacing: 0.25 } as const;
/** Seed for the prop pass. Any fixed value; the point is a reproducible prop set. */
const SCATTER_SEED = 7;

/** Scatter every catalog archetype over an already-carved cave and voxelize the result.
 *  `overrides` empty = each archetype's own authored density (the F3b authoring flow, so the
 *  prop set is the one a real bake would carry); {@link STRESS_SCATTER} = the flooding case. */
export function scatterProps(
  store: field.FieldStore,
  catalog: Catalog,
  overrides: Record<string, unknown> = {},
): { extraSolid: Map<field.ChunkKey, Uint8Array>; props: number } {
  const scatter = field.generatorById("scatter");
  if (scatter === undefined) throw new Error("measure: no scatter generator");
  const out: { id: string; records: field.PlacementRecord[] }[] = [];
  for (const [id, archetype] of catalog) {
    const hints = archetype.scatter ?? {};
    const range = hints["scaleRange"];
    const scaleRange = Array.isArray(range) ? range : undefined;
    const params: Record<string, unknown> = {
      ...scatter.defaults,
      ...hints,
      archetypeId: id,
      scaleMin: scaleRange?.[0] ?? scatter.defaults["scaleMin"],
      scaleMax: scaleRange?.[1] ?? scatter.defaults["scaleMax"],
      ...overrides,
    };
    delete params["scaleRange"];
    // One log per archetype so its placement ops are the only ones in it — `commitGenerator`
    // returns the entity, not the emitted records, so the log is where they are read back from.
    const log = field.createOpLog();
    field.commitGenerator(store, log, scatter, {
      params,
      seed: SCATTER_SEED,
      region: CAVE_REGION,
      policy: "replace",
      table: field.BUILTIN_TABLE,
    });
    const records = log.ops.flatMap((op) =>
      op.kind === "placement" ? op.records : [],
    );
    if (records.length > 0) out.push({ id, records });
  }
  return {
    extraSolid: field.voxelizePlacements(
      collisionGroups(catalog, out),
      store.cellSize,
    ),
    props: out.reduce((n, g) => n + g.records.length, 0),
  };
}

// ─── committed field worlds ───

/** Every v2 field manifest under `worlds/`, largest first. */
async function committedManifests(): Promise<
  { name: string; manifest: field.FieldManifest }[]
> {
  const entries = await readdir(WORLDS_DIR, { withFileTypes: true });
  const found: { name: string; manifest: field.FieldManifest }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(WORLDS_DIR, entry.name, "manifest.json");
    const text = await Bun.file(path)
      .text()
      .catch(() => undefined);
    if (text === undefined) continue;
    // Boundary parse: a world manifest is on-disk data; v1 region worlds are filtered out here.
    const manifest = JSON.parse(text) as field.FieldManifest;
    if (manifest.version === 2 && manifest.kind === "field")
      found.push({ name: entry.name, manifest });
  }
  return found.sort(
    (a, b) => b.manifest.chunks.length - a.manifest.chunks.length,
  );
}

/** Rebuild a store from a committed world's per-chunk density files — `field-world.ts`'s
 *  `rebuildStore` with `readFile` where the game has `fetch`. READ ONLY: `worlds/` is user data
 *  and this script never writes to it. */
async function loadCommittedWorld(
  name: string,
  manifest: field.FieldManifest,
  catalog: Catalog,
): Promise<Subject> {
  const dir = join(WORLDS_DIR, name);
  const store = field.createFieldStore(manifest.cellSize);
  for (const c of manifest.chunks)
    store.chunks.set(
      c.key,
      field.decodeChunkFile(await Bun.file(join(dir, c.file)).bytes()),
    );

  let extraSolid: Map<field.ChunkKey, Uint8Array> | undefined;
  let props = 0;
  if (manifest.placements !== undefined) {
    const groups = field.parsePlacements(
      await Bun.file(join(dir, manifest.placements)).text(),
    );
    props = groups.reduce((n, g) => n + g.records.length, 0);
    extraSolid = field.voxelizePlacements(
      collisionGroups(catalog, groups),
      store.cellSize,
    );
  }
  return {
    label: `committed world "${name}"`,
    note: `${store.chunks.size} chunks, ${manifest.cellSize} m cells, spawn from the manifest`,
    store,
    extraSolid,
    seeds: [manifest.playerStart],
    props,
  };
}

/** EVERY committed v2 field world, largest first — not just the largest. The buried-spawn
 *  caveat is only visible if each world's own seed is resolved and reported. */
export async function committedWorlds(catalog: Catalog): Promise<Subject[]> {
  const manifests = await committedManifests();
  if (manifests.length === 0)
    throw new Error("measure: no committed v2 field world under worlds/");
  return Promise.all(
    manifests.map((m) => loadCommittedWorld(m.name, m.manifest, catalog)),
  );
}

// packages/dungeon/scripts/measure/subjects.ts
// The POPULATIONS `measure-analyze.ts` measures: generated caves (bare and propped), the
// P-F3-1 walked-config matrix, and every committed v2 field world. Construction only — this
// module runs no analysis and prints nothing.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import * as field from "@furnace/core/field";
import { AGENT } from "../../src/walkability.ts";
import { CAVE_REGION, caveConfigs } from "../../tests/_helpers/cave-matrix.ts";

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

/** The F3b default cave region — the same fixture the P-F4-1 budget test carves, and the region
 *  the P-F3-1 walk harness carves its whole matrix into. Re-exported from the matrix module so
 *  this file's callers keep one import. */
export { CAVE_REGION };
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
 *  grounded capsule-rest above it. THE world's own spawn for a walked config — what Task 8's
 *  in-harness tooth will use.
 *
 *  The rest offset is derived from {@link AGENT} here, so it cannot drift from the profile the
 *  analyzer reads. Note that is only true of THIS side: the harness computes the same offset
 *  from a LOCAL literal (`walk-fixture.ts`'s `CAPSULE = { halfHeight: 0.6, radius: 0.3 }`), not
 *  from `catalog/agent.json`. The two agree at 0.9 m today by coincidence of two independent
 *  sources, not by construction. Nothing here depends on the exact value — `seedAnchor` snaps
 *  DOWN to the floor, so any Y inside the chamber's air lands on the same anchor — but do not
 *  read this as the two files being single-sourced. */
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

export type WalkConfig = {
  name: string;
  params: Record<string, unknown>;
  seed: number;
};

/** The P-F3-1 walked matrix, from the SHARED definition the walk harness also reads
 *  (`tests/_helpers/cave-matrix.ts`) — the duplication that used to sit here is gone, so a
 *  matrix edited on either side can no longer leave this measurement quietly measuring the old
 *  twelve. Only the row LABEL is local: the harness names a baked world, this names a table row. */
export const walkConfigs = (): WalkConfig[] =>
  caveConfigs().map(({ theme, verticality, seed, params }) => ({
    name: `${theme}/v${verticality}/s${seed}`,
    params,
    seed,
  }));

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
 *  prop solidity FLOODS the candidate filters. These are the schema's EXTREMES in the crowding
 *  direction — `density` at its maximum (2) and `minSpacing` at its minimum (0.25) — not a
 *  proposal, and not "maxima" on both fields. */
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

/** Every v2 field manifest under `worlds/`, largest first — usually NONE. `.gitignore` keeps
 *  `worlds/*` out of the repo apart from `worlds/index.json` and the v1 region world
 *  `worlds/default`, which this filter drops, so anything found here is a LOCAL user bake. */
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
    label: `local field world "${name}"`,
    note: `${store.chunks.size} chunks, ${manifest.cellSize} m cells, spawn from the manifest`,
    store,
    extraSolid,
    seeds: [manifest.playerStart],
    props,
  };
}

/** Every v2 field world present on THIS machine, largest first — not just the largest, because
 *  the buried-spawn caveat is only visible if each world's own seed is resolved and reported.
 *
 *  EMPTY IS THE NORMAL CASE, not an error: these are local bakes (see {@link committedManifests}),
 *  so a clean checkout has none. Returning `[]` lets the generated-cave tables — which ARE
 *  reproducible from seeds, and which are the population the P-F4-3b bar is read against — still
 *  print. Throwing here made the whole script unrunnable on a fresh worktree. */
export async function localFieldWorlds(catalog: Catalog): Promise<Subject[]> {
  const manifests = await committedManifests();
  return Promise.all(
    manifests.map((m) => loadCommittedWorld(m.name, m.manifest, catalog)),
  );
}

// packages/dungeon/scripts/measure-analyze.ts
// P-F4-3 / P-F4-4: what does the stage-1 walkability advisor ACTUALLY flag, on real worlds, at
// the honest thresholds? Counts by kind x severity x reachable x walkable-ground, over a
// generated default cave (with and without scattered props) and the largest committed field
// world. The numbers are the deliverable — this script tunes nothing and writes nothing.
//
// Run (from packages/dungeon): bun scripts/measure-analyze.ts
//
// WALKABLE GROUND — the operational definition the P-F4-3 stop condition is read against. A flag
// counts as being on walkable ground when BOTH hold of its anchor cell:
//   (i)  REACHABLE — `unreachable !== true` after `markUnreachable` from the world's own spawn
//        seeds. Filtered on the POSITIVE, per the tri-state contract: `undefined` means the pass
//        never visited it, and testing `=== false` would silently hide those.
//   (ii) STANDABLE — a floor anchor with a full `clearance` air run above it: the SAME test
//        `analyzeChunk` applies when picking its anchors, re-derived here over the same solidity
//        (field density widened by voxelized placement colliders).
// (ii) is not redundant with (i). Three of the four kinds anchor on a cell that passed the
// walkable test by construction, but `low-clearance` anchors on the OFFENDING NEIGHBOUR — a cell
// that failed it — so it is exactly the kind (ii) excludes. Both columns are printed so the
// difference is visible rather than asserted.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import * as field from "@furnace/core/field";
import { AGENT } from "../src/walkability.ts";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const WORLDS_DIR = join(PACKAGE_ROOT, "worlds");
const CATALOG_PATH = join(PACKAGE_ROOT, "catalog", "entities.json");

/** The F3b default cave region + seed — the same fixture the P-F4-1 budget test carves. */
const CAVE_REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [20, 10, 20] as [number, number, number],
};
const CAVE_SEED = 1;
/** Seed for the prop pass. Any fixed value; the point is a reproducible prop set. */
const SCATTER_SEED = 7;

const KINDS: field.FlagKind[] = [
  "ledge",
  "lip-near-wall",
  "low-clearance",
  "narrow",
];
const SEVERITIES: field.FlagSeverity[] = ["candidate", "info"];

/** One measured world: the store, the extra solidity its props contribute, and where the agent
 *  starts. `extraSolid` is passed to BOTH `analyzeWorld` and `markUnreachable` — the two must read
 *  one solidity or the flood would walk through props the column pass treats as walls. */
type Subject = {
  label: string;
  note: string;
  store: field.FieldStore;
  extraSolid: Map<field.ChunkKey, Uint8Array> | undefined;
  seeds: [number, number, number][];
  props: number;
};

// ─── the catalog (for placement collision primitives) ───

type CatalogArchetype = {
  id: string;
  collision: field.PlacementCollision;
  scatter?: Record<string, unknown>;
};

async function readCatalog(): Promise<Map<string, CatalogArchetype>> {
  // Boundary parse: entities.json is authored data; only the fields this script reads are typed.
  const parsed = JSON.parse(await Bun.file(CATALOG_PATH).text()) as {
    archetypes: CatalogArchetype[];
  };
  return new Map(parsed.archetypes.map((a) => [a.id, a]));
}

/** Group placement records by the archetype collision they share — `voxelizePlacements`' input,
 *  and the same grouping `analyzerVerify` takes. */
function collisionGroups(
  catalog: ReadonlyMap<string, CatalogArchetype>,
  byArchetype: readonly { id: string; records: field.PlacementRecord[] }[],
): field.PlacementCollisionGroup[] {
  return byArchetype.map(({ id, records }) => {
    const archetype = catalog.get(id);
    if (archetype === undefined)
      throw new Error(
        `measure-analyze: placement archetype "${id}" is absent from catalog/entities.json`,
      );
    return { collision: archetype.collision, records };
  });
}

// ─── subject A/B: the generated default cave ───

function carveDefaultCave(): field.FieldStore {
  const store = field.createFieldStore();
  const cave = field.generatorById("cave");
  if (cave === undefined) throw new Error("measure-analyze: no cave generator");
  field.commitGenerator(store, field.createOpLog(), cave, {
    params: cave.defaults,
    seed: CAVE_SEED,
    region: CAVE_REGION,
    policy: "replace",
    table: field.BUILTIN_TABLE,
  });
  return store;
}

/** The cave's own chamber centres, in world space — the honest spawn set for a generated cave,
 *  which carries no authored `playerStart`. Using EVERY chamber rather than one is the
 *  conservative direction for this measurement: more seeds reach more flags, so the
 *  walkable-ground count it produces is an upper bound, never a flattering one. */
function caveSeeds(): [number, number, number][] {
  const cave = field.generatorById("cave");
  if (cave === undefined) throw new Error("measure-analyze: no cave generator");
  const extent: [number, number, number] = [
    CAVE_REGION.max[0] - CAVE_REGION.min[0],
    CAVE_REGION.max[1] - CAVE_REGION.min[1],
    CAVE_REGION.max[2] - CAVE_REGION.min[2],
  ];
  const skeleton = field.buildCaveSkeleton(cave.defaults, CAVE_SEED, extent);
  return skeleton.chambers.map((c) => [
    c.center[0] + CAVE_REGION.min[0],
    c.center[1] + CAVE_REGION.min[1],
    c.center[2] + CAVE_REGION.min[2],
  ]);
}

/** The densest prop set the scatter schema allows, used for the P-F4-4 stress row: the authored
 *  catalog densities put only a dozen props in this cave, which is far too few to show whether
 *  prop solidity FLOODS the `narrow` filter. These are schema maxima, not a proposal. */
const STRESS_SCATTER = { density: 2, minSpacing: 0.25 } as const;

/** Scatter every catalog archetype over the carved cave. `overrides` empty = each archetype's own
 *  authored density (the F3b authoring flow, so the prop set is the one a real bake would carry);
 *  {@link STRESS_SCATTER} = the flooding-risk case. Returns the records grouped by archetype. */
function scatterCatalogProps(
  store: field.FieldStore,
  catalog: ReadonlyMap<string, CatalogArchetype>,
  overrides: Record<string, unknown> = {},
): { id: string; records: field.PlacementRecord[] }[] {
  const scatter = field.generatorById("scatter");
  if (scatter === undefined)
    throw new Error("measure-analyze: no scatter generator");
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
  return out;
}

// ─── subject C: the largest committed field world ───

/** Every v2 field manifest under `worlds/`, with its chunk count. */
async function committedFieldWorlds(): Promise<
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
  return found;
}

/** Rebuild a store from a committed world's per-chunk density files — `field-world.ts`'s
 *  `rebuildStore` with `readFile` where the game has `fetch`. READ ONLY: `worlds/` is user data
 *  and this script never writes to it. */
async function loadCommittedWorld(
  name: string,
  manifest: field.FieldManifest,
  catalog: ReadonlyMap<string, CatalogArchetype>,
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

// ─── the walkable-ground predicate ───

/** Rock at (x,y,z): the field's own `density < 0`, widened by the voxelized placement colliders
 *  the analyzer was given. The same union `analyze.ts` reads, re-derived here because the
 *  predicate is not exported — if the two ever disagree, this table is measuring the wrong
 *  thing. */
function solidAt(
  store: field.FieldStore,
  extras: ReadonlyMap<field.ChunkKey, Uint8Array> | undefined,
  x: number,
  y: number,
  z: number,
): boolean {
  if (field.getDensity(store, x, y, z) < 0) return true;
  if (extras === undefined) return false;
  const cx = field.voxelChunk(x);
  const cy = field.voxelChunk(y);
  const cz = field.voxelChunk(z);
  const bits = extras.get(field.chunkKey(cx, cy, cz));
  if (bits === undefined) return false;
  const lx = x - cx * field.CHUNK_DIM;
  const ly = y - cy * field.CHUNK_DIM;
  const lz = z - cz * field.CHUNK_DIM;
  const bit = bits[lx + field.CHUNK_DIM * (ly + field.CHUNK_DIM * lz)];
  return bit !== undefined && bit !== 0;
}

/** Is this a cell the agent can actually stand on — a floor surface with standing headroom? The
 *  column pass's own walkable test, applied to a flag's anchor. */
function isStandable(
  subject: Subject,
  cell: readonly [number, number, number],
): boolean {
  const [x, y, z] = cell;
  const { store, extraSolid: extras } = subject;
  if (solidAt(store, extras, x, y, z)) return false;
  if (!solidAt(store, extras, x, y - 1, z)) return false;
  const clearCells = Math.ceil(AGENT.clearance / store.cellSize);
  for (let n = 0; n < clearCells; n++)
    if (solidAt(store, extras, x, y + n, z)) return false;
  return true;
}

// ─── measurement + reporting ───

type Row = { total: number; reachable: number; walkable: number };

const emptyRow = (): Row => ({ total: 0, reachable: 0, walkable: 0 });

function measure(subject: Subject): {
  rows: Map<string, Row>;
  totals: Row;
  candidates: Row;
  ms: number;
} {
  const opts =
    subject.extraSolid === undefined ? {} : { extraSolid: subject.extraSolid };
  const t0 = performance.now();
  const flags = field.analyzeWorld(subject.store, AGENT, opts);
  field.markUnreachable(subject.store, AGENT, flags, subject.seeds, opts);
  const ms = performance.now() - t0;

  const bump = (row: Row, reachable: boolean, walkable: boolean): void => {
    row.total++;
    if (reachable) row.reachable++;
    if (walkable) row.walkable++;
  };

  const rows = new Map<string, Row>();
  const totals = emptyRow();
  const candidates = emptyRow();
  for (const list of flags.values())
    for (const flag of list) {
      // The tri-state contract: hide `unreachable === true`, show everything else.
      const reachable = flag.unreachable !== true;
      const walkable = reachable && isStandable(subject, flag.cell);
      const key = `${flag.kind}|${flag.severity}`;
      let row = rows.get(key);
      if (row === undefined) {
        row = emptyRow();
        rows.set(key, row);
      }
      bump(row, reachable, walkable);
      bump(totals, reachable, walkable);
      if (flag.severity === "candidate") bump(candidates, reachable, walkable);
    }
  return { rows, totals, candidates, ms };
}

const pad = (s: string | number, w: number): string => String(s).padEnd(w);
const padStart = (s: string | number, w: number): string =>
  String(s).padStart(w);

function report(subject: Subject): Row {
  const { rows, totals, candidates, ms } = measure(subject);
  console.log(`\n── ${subject.label} ──`);
  console.log(
    `   ${subject.note}; ${subject.seeds.length} spawn seed(s); ${subject.props} placed prop(s)`,
  );
  console.log(
    `   analyzeWorld + markUnreachable: ${ms.toFixed(0)} ms\n` +
      `   ${pad("kind", 17)}${pad("severity", 11)}${padStart("total", 7)}${padStart("reachable", 11)}${padStart("walkable-ground", 17)}`,
  );
  for (const kind of KINDS)
    for (const severity of SEVERITIES) {
      const row = rows.get(`${kind}|${severity}`);
      if (row === undefined) continue;
      console.log(
        `   ${pad(kind, 17)}${pad(severity, 11)}${padStart(row.total, 7)}${padStart(row.reachable, 11)}${padStart(row.walkable, 17)}`,
      );
    }
  console.log(
    `   ${pad("ALL", 17)}${pad("", 11)}${padStart(totals.total, 7)}${padStart(totals.reachable, 11)}${padStart(totals.walkable, 17)}`,
  );
  console.log(
    `   ${pad("DEFAULT-VISIBLE", 17)}${pad("candidate", 11)}${padStart(candidates.total, 7)}${padStart(candidates.reachable, 11)}${padStart(candidates.walkable, 17)}`,
  );
  return candidates;
}

const catalog = await readCatalog();

const bareCave = carveDefaultCave();
const subjects: Subject[] = [
  {
    label: "generated default cave (F3b region, seed 1) — no props",
    note: `${bareCave.chunks.size} chunks, ${bareCave.cellSize} m cells`,
    store: bareCave,
    extraSolid: undefined,
    seeds: caveSeeds(),
    props: 0,
  },
];

// P-F4-4: the same cave, propped two ways, so the prop contribution to the counts is a DIFFERENCE
// against the bare row rather than an isolated number. The authored row is what a real bake
// carries; the stress row is what would show a flood if prop solidity could cause one — the
// authored densities put barely a dozen props in this cave, which on its own proves nothing.
for (const [suffix, overrides] of [
  ["WITH catalog scatter (authored densities)", {}],
  ["WITH scatter at SCHEMA-MAX density (P-F4-4 stress)", STRESS_SCATTER],
] as const) {
  const store = carveDefaultCave();
  const scattered = scatterCatalogProps(store, catalog, overrides);
  subjects.push({
    label: `generated default cave (F3b region, seed 1) — ${suffix}`,
    note: `${store.chunks.size} chunks, ${store.cellSize} m cells`,
    store,
    extraSolid: field.voxelizePlacements(
      collisionGroups(catalog, scattered),
      store.cellSize,
    ),
    seeds: caveSeeds(),
    props: scattered.reduce((n, g) => n + g.records.length, 0),
  });
}

const worlds = await committedFieldWorlds();
const largest = worlds.sort(
  (a, b) => b.manifest.chunks.length - a.manifest.chunks.length,
)[0];
if (largest === undefined)
  throw new Error("measure-analyze: no committed v2 field world under worlds/");
subjects.push(
  await loadCommittedWorld(largest.name, largest.manifest, catalog),
);

console.log(
  `agent profile (catalog/agent.json): capsule r=${AGENT.capsule.radius} hh=${AGENT.capsule.halfHeight}, ` +
    `stepHeight=${AGENT.stepHeight}, climbCeiling=${AGENT.climbCeiling}, clearance=${AGENT.clearance}`,
);
console.log(
  "walkable ground = reachable (unreachable !== true) AND standable (floor anchor with full clearance)",
);

const results = subjects.map((s) => ({
  label: s.label,
  candidates: report(s),
}));

console.log("\n── P-F4-3 stop condition ──");
console.log(
  "   the bar: default-visible (candidate-severity) flags on walkable ground, in the HUNDREDS = halt",
);
for (const { label, candidates } of results)
  console.log(
    `   ${padStart(candidates.walkable, 6)} on walkable ground (${candidates.total} raw) — ${label}`,
  );

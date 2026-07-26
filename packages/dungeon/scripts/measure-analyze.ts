// packages/dungeon/scripts/measure-analyze.ts
// P-F4-3b: what does the walkability advisor ACTUALLY flag, on real worlds, under PIT
// SEMANTICS? Counts by kind x severity x reachable x walkable-ground, plus the pit regions
// `detectPits` finds, over: the generated default cave (bare and propped two ways), the twelve
// P-F3-1 walked cave configs, and every committed v2 field world. The numbers are the
// deliverable — this script tunes nothing and writes nothing.
//
// Run (from packages/dungeon): bun scripts/measure-analyze.ts
//
// WALKABLE GROUND — the operational definition the stop condition is read against. A flag
// counts as being on walkable ground when BOTH hold of its anchor cell:
//   (i)  REACHABLE — `unreachable !== true` after `markUnreachable` from the world's own spawn
//        seeds. Filtered on the POSITIVE, per the tri-state contract: `undefined` means the
//        pass never visited it, and testing `=== false` would silently hide those. `pit` flags
//        are always in this state BY DESIGN (`markUnreachable` skips them — that flood cannot
//        enter a pit, so the question is meaningless), so every pit counts as reachable here.
//   (ii) STANDABLE — a floor anchor with a full `clearance` air run above it: the SAME test
//        `analyzeChunk` applies when picking its anchors, re-derived in `measure/solidity.ts`
//        over the same solidity (field density widened by voxelized placement colliders).
// (ii) is not redundant with (i). Three of the five kinds anchor on a cell that passed the
// walkable test by construction, but `low-clearance` anchors on the OFFENDING NEIGHBOUR and
// `pit` on a node from the headroom-free connectivity node set — exactly the cells (ii)
// excludes. Both columns are printed so the difference is visible rather than asserted.
import * as field from "@furnace/core/field";
import { AGENT } from "../src/walkability.ts";
import { explain } from "./measure/explain.ts";
import { CONTROL_EXPECTATION, runPitControl } from "./measure/pit-control.ts";
import { isStandable, seedAnchor } from "./measure/solidity.ts";
import {
  CAVE_SEED,
  type Catalog,
  carveCave,
  caveDefaults,
  chamberSeeds,
  committedWorlds,
  readCatalog,
  STRESS_SCATTER,
  type Subject,
  scatterProps,
  spawnSeed,
  walkConfigs,
} from "./measure/subjects.ts";

const KINDS: field.FlagKind[] = [
  "ledge",
  "lip-near-wall",
  "low-clearance",
  "narrow",
  "pit",
];
const SEVERITIES: field.FlagSeverity[] = ["candidate", "info"];

/** The plan's eyeball bar: candidates per world small enough to inspect one by one. */
const EYEBALL_BAR = 15;
/** Cap on the per-flag geometry dump, so a bad world cannot bury the tables. */
const EXPLAIN_LIMIT = 40;

// ─── measurement ───

type Row = { total: number; reachable: number; walkable: number };
const emptyRow = (): Row => ({ total: 0, reachable: 0, walkable: 0 });

type Measured = {
  rows: Map<string, Row>;
  totals: Row;
  candidates: Row;
  /** Every candidate-severity flag on walkable ground, for the per-flag geometry dump. */
  visible: field.FieldFlag[];
  pits: field.FieldFlag[];
  seedsUsable: number;
  ms: number;
};

function measure(subject: Subject): Measured {
  const opts =
    subject.extraSolid === undefined ? {} : { extraSolid: subject.extraSolid };
  const t0 = performance.now();
  const byChunk = field.analyzeWorld(subject.store, AGENT, opts);
  field.markUnreachable(subject.store, AGENT, byChunk, subject.seeds, opts);
  const pits = field.detectPits(subject.store, AGENT, subject.seeds, opts);
  const ms = performance.now() - t0;

  const rows = new Map<string, Row>();
  const totals = emptyRow();
  const candidates = emptyRow();
  const visible: field.FieldFlag[] = [];
  const bump = (row: Row, reachable: boolean, walkable: boolean): void => {
    row.total++;
    if (reachable) row.reachable++;
    if (walkable) row.walkable++;
  };

  for (const flag of [...byChunk.values(), pits].flat()) {
    // The tri-state contract: hide `unreachable === true`, show everything else.
    const reachable = flag.unreachable !== true;
    const walkable =
      reachable && isStandable(subject, AGENT.clearance, flag.cell);
    const key = `${flag.kind}|${flag.severity}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = emptyRow();
      rows.set(key, row);
    }
    bump(row, reachable, walkable);
    bump(totals, reachable, walkable);
    if (flag.severity === "candidate") {
      bump(candidates, reachable, walkable);
      if (walkable) visible.push(flag);
    }
  }

  const seedsUsable = subject.seeds.filter(
    (s) => seedAnchor(subject, s) !== undefined,
  ).length;
  return { rows, totals, candidates, visible, pits, seedsUsable, ms };
}

// ─── reporting ───

const pad = (s: string | number, w: number): string => String(s).padEnd(w);
const padStart = (s: string | number, w: number): string =>
  String(s).padStart(w);

function printSeedLine(subject: Subject): void {
  const resolved = subject.seeds.map((s) => seedAnchor(subject, s));
  const usable = resolved.filter((a) => a !== undefined).length;
  const verdict =
    usable === 0
      ? "NO USABLE SEED — markUnreachable and detectPits both SKIP this world; its 0s are by construction"
      : usable < subject.seeds.length
        ? `${usable}/${subject.seeds.length} usable (the rest are buried in rock and ignored)`
        : `${usable}/${subject.seeds.length} usable`;
  console.log(`   seeds: ${verdict}`);
}

function printPitRegions(
  subject: Subject,
  pits: readonly field.FieldFlag[],
): void {
  if (pits.length === 0) {
    console.log("   pit regions: none");
    return;
  }
  console.log(`   pit regions: ${pits.length}`);
  for (const p of pits) {
    const w = p.world.map((n) => n.toFixed(2)).join(", ");
    console.log(
      `     ${padStart(p.cells ?? 0, 5)} columns @ world (${w}) cell [${p.cell.join(",")}] — ${explain(subject, AGENT, p)}`,
    );
  }
}

function printVisibleCandidates(
  subject: Subject,
  visible: readonly field.FieldFlag[],
): void {
  if (visible.length === 0) return;
  console.log(
    `   candidates on walkable ground, one by one${visible.length > EXPLAIN_LIMIT ? ` (first ${EXPLAIN_LIMIT} of ${visible.length})` : ""}:`,
  );
  for (const f of visible.slice(0, EXPLAIN_LIMIT)) {
    const w = f.world.map((n) => n.toFixed(2)).join(", ");
    console.log(
      `     ${pad(f.kind, 15)} cell [${pad(f.cell.join(","), 14)}] world (${w}) — ${explain(subject, AGENT, f)}`,
    );
  }
}

function report(subject: Subject): Measured {
  const m = measure(subject);
  console.log(`\n── ${subject.label} ──`);
  console.log(`   ${subject.note}; ${subject.props} placed prop(s)`);
  printSeedLine(subject);
  console.log(
    `   analyzeWorld + markUnreachable + detectPits: ${m.ms.toFixed(0)} ms\n` +
      `   ${pad("kind", 17)}${pad("severity", 11)}${padStart("total", 7)}${padStart("reachable", 11)}${padStart("walkable-ground", 17)}`,
  );
  for (const kind of KINDS)
    for (const severity of SEVERITIES) {
      const row = m.rows.get(`${kind}|${severity}`);
      if (row === undefined) continue;
      console.log(
        `   ${pad(kind, 17)}${pad(severity, 11)}${padStart(row.total, 7)}${padStart(row.reachable, 11)}${padStart(row.walkable, 17)}`,
      );
    }
  console.log(
    `   ${pad("ALL", 17)}${pad("", 11)}${padStart(m.totals.total, 7)}${padStart(m.totals.reachable, 11)}${padStart(m.totals.walkable, 17)}`,
  );
  console.log(
    `   ${pad("DEFAULT-VISIBLE", 17)}${pad("candidate", 11)}${padStart(m.candidates.total, 7)}${padStart(m.candidates.reachable, 11)}${padStart(m.candidates.walkable, 17)}`,
  );
  printPitRegions(subject, m.pits);
  printVisibleCandidates(subject, m.visible);
  return m;
}

/** One line per subject — the shape the 12-config matrix needs, where per-kind detail would
 *  bury the comparison the matrix exists to make.
 *
 *  `reach` is the honesty column. These configs are seeded from ONE `playerStart`, so a low
 *  candidate count would also be what a flood that never left the spawn chamber produces. The
 *  share of flags the flood reached says which of the two happened. */
function compactRow(label: string, subject: Subject, m: Measured): void {
  const kind = (k: field.FlagKind): number =>
    m.rows.get(`${k}|candidate`)?.walkable ?? 0;
  const pitColumns = m.pits.reduce((n, p) => n + (p.cells ?? 0), 0);
  const seeds = `${m.seedsUsable}/${subject.seeds.length}`;
  const reach =
    m.totals.total === 0
      ? "n/a"
      : `${Math.round((100 * m.totals.reachable) / m.totals.total)}%`;
  console.log(
    `   ${pad(label, 22)}${padStart(subject.store.chunks.size, 7)}${padStart(seeds, 7)}${padStart(reach, 7)}` +
      `${padStart(m.pits.length, 6)}${padStart(pitColumns, 9)}${padStart(kind("narrow"), 8)}` +
      `${padStart(kind("low-clearance"), 12)}${padStart(m.candidates.walkable, 12)}${padStart(m.candidates.total, 10)}`,
  );
}

const compactHeader = (title: string): void => {
  console.log(`\n── ${title} ──`);
  console.log(
    `   ${pad("config", 22)}${padStart("chunks", 7)}${padStart("seeds", 7)}${padStart("reach", 7)}${padStart("pits", 6)}` +
      `${padStart("pit cols", 9)}${padStart("narrow", 8)}${padStart("low-clear", 12)}${padStart("CANDIDATES", 12)}${padStart("(raw)", 10)}`,
  );
  console.log(
    "   (walkable-ground counts; seeds = usable/given; reach = share of flags the flood reached;" +
      " (raw) = candidates before the walkable-ground filter, so a low `reach` cannot flatter the count)",
  );
};

// ─── subjects ───

/** The default cave three ways: bare, with the props a real bake carries, and with the densest
 *  prop set the scatter schema allows. Prop contribution then reads as a DIFFERENCE against the
 *  bare row rather than an isolated number. */
function defaultCaveSubjects(catalog: Catalog): Subject[] {
  const params = caveDefaults();
  const seeds = chamberSeeds(params, CAVE_SEED);
  const bare = carveCave(params, CAVE_SEED);
  const subjects: Subject[] = [
    {
      label: "default cave (F3b region, seed 1) — no props",
      note: `${bare.chunks.size} chunks, ${bare.cellSize} m cells, ${seeds.length} chamber seeds`,
      store: bare,
      extraSolid: undefined,
      seeds,
      props: 0,
    },
  ];
  for (const [suffix, overrides] of [
    ["WITH catalog scatter (authored densities)", {}],
    ["WITH scatter at SCHEMA-MAX density (P-F4-4 stress)", STRESS_SCATTER],
  ] as const) {
    const store = carveCave(params, CAVE_SEED);
    const { extraSolid, props } = scatterProps(store, catalog, overrides);
    subjects.push({
      label: `default cave (F3b region, seed 1) — ${suffix}`,
      note: `${store.chunks.size} chunks, ${store.cellSize} m cells, ${seeds.length} chamber seeds`,
      store,
      extraSolid,
      seeds,
      props,
    });
  }
  return subjects;
}

/** One P-F3-1 walked config, seeded from the `playerStart` that harness bakes. */
function walkConfigSubject(
  name: string,
  params: Record<string, unknown>,
  seed: number,
  catalog: Catalog | undefined,
): Subject {
  const store = carveCave(params, seed);
  const scattered =
    catalog === undefined ? undefined : scatterProps(store, catalog);
  return {
    label: name,
    note: `${store.chunks.size} chunks`,
    store,
    extraSolid: scattered?.extraSolid,
    seeds: [spawnSeed(params, seed)],
    props: scattered?.props ?? 0,
  };
}

// ─── run ───

const catalog = await readCatalog();

console.log(
  `agent profile (catalog/agent.json): capsule r=${AGENT.capsule.radius} hh=${AGENT.capsule.halfHeight}, ` +
    `stepHeight=${AGENT.stepHeight}, climbCeiling=${AGENT.climbCeiling}, clearance=${AGENT.clearance}, ` +
    `skin=${AGENT.skin} (narrow pinch bar = ${2 * AGENT.capsule.radius + AGENT.skin} m of free width)`,
);
console.log(
  "walkable ground = reachable (unreachable !== true) AND standable (floor anchor with full clearance)",
);
console.log(
  "any [furnace/field] warning below belongs to the NEXT table printed — every subject also states its own seed count",
);

const detailed: { label: string; subject: Subject; m: Measured }[] = [];
for (const subject of defaultCaveSubjects(catalog))
  detailed.push({ label: subject.label, subject, m: report(subject) });
for (const subject of await committedWorlds(catalog))
  detailed.push({ label: subject.label, subject, m: report(subject) });

const configs = walkConfigs();

function walkMatrix(
  title: string,
  propCatalog: Catalog | undefined,
): { label: string; subject: Subject; m: Measured }[] {
  compactHeader(title);
  const out: { label: string; subject: Subject; m: Measured }[] = [];
  for (const cfg of configs) {
    const subject = walkConfigSubject(
      cfg.name,
      cfg.params,
      cfg.seed,
      propCatalog,
    );
    const m = measure(subject);
    out.push({ label: cfg.name, subject, m });
    compactRow(cfg.name, subject, m);
  }
  return out;
}

const walked = walkMatrix(
  "the 12 P-F3-1 WALKED cave configs — no props (the population the bar names)",
  undefined,
);
// Cell by cell, because at these counts a bare number is not the deliverable: this is the
// population the bar is read against, so every candidate in it gets its geometry printed.
console.log("\n   every candidate above, one by one:");
for (const { label, subject, m } of walked)
  for (const f of m.visible)
    console.log(
      `     ${pad(label, 18)}${pad(f.kind, 15)} cell [${pad(f.cell.join(","), 12)}] world (${f.world.map((n) => n.toFixed(2)).join(", ")}) — ${explain(subject, AGENT, f)}`,
    );

const walkedProps = walkMatrix(
  "the same 12 configs — WITH catalog scatter (authored densities)",
  catalog,
);

// ─── the liveness control ───

console.log("\n── pit-detector liveness control (same detector, same cave) ──");
const control = runPitControl();
if (control.site === undefined)
  console.log(
    "   NO CARVE SITE FOUND — the control did not run, so the 0s above are UNSUPPORTED",
  );
else {
  const flatOk =
    control.flat.added.length === 1 &&
    control.flat.added[0]?.cells === CONTROL_EXPECTATION.columns;
  console.log(`   carve site: cell [${control.site.join(",")}]`);
  console.log(`   untouched cave: ${control.baseline} pit region(s)`);
  console.log(
    `   FLAT shaft:    ${control.flat.regions} region(s), ${control.flat.added.length} NEW ` +
      `(${control.flat.added.map((f) => `${f.cells} columns`).join(", ") || "—"}) ` +
      `— expected ${CONTROL_EXPECTATION.flat} → ${flatOk ? "FIRES" : "!! CONTROL FAILED"}`,
  );
  console.log(
    `   STAIRS shaft:  ${control.stairs.regions} region(s), ${control.stairs.added.length} NEW ` +
      `— expected ${CONTROL_EXPECTATION.stairs} → ${control.stairs.added.length === 0 ? "STAYS SILENT" : "!! CONTROL FAILED"}`,
  );
}

// ─── the bar ───

console.log("\n── P-F4-3b bar ──");
console.log(
  `   pit candidates ~0 AND total candidates on walkable ground <= ~${EYEBALL_BAR} per world,` +
    " over the walked known-good cave configs. Hundreds = the stop condition fires again.",
);
const summarize = (
  title: string,
  set: readonly { label: string; m: Measured }[],
): void => {
  const worst = set.reduce((a, b) =>
    b.m.candidates.walkable > a.m.candidates.walkable ? b : a,
  );
  const pitTotal = set.reduce((n, s) => n + s.m.pits.length, 0);
  console.log(
    `   ${pad(title, 46)} worst world ${padStart(worst.m.candidates.walkable, 5)} candidates (${worst.label}), ${pitTotal} pit region(s) across ${set.length}`,
  );
};
summarize("12 walked configs, no props", walked);
summarize("12 walked configs, authored props", walkedProps);
summarize("default cave + committed worlds", detailed);
for (const { label, m } of detailed)
  console.log(
    `   ${padStart(m.candidates.walkable, 6)} on walkable ground (${m.candidates.total} raw), ${m.pits.length} pit region(s) — ${label}`,
  );

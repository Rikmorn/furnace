// THE SPATIAL READ — what is in this world, where, and what is wrong with it.
//
// Foundations T4c, and the third of the agent seam's three modules: `field-capture.ts` gave
// the agent eyes, `field-mutation.ts` gave it hands, and this one exists because the eyes
// are for SEEING and not for MEASURING.
//
// **THE POSTURE, WHICH IS THE WHOLE REASON THIS IS FIRST-CLASS SURFACE RATHER THAN A
// CONVENIENCE.** *Ask this; do not squint.* An agent must never read a rendered image to
// answer "is this prop resting on the floor" or "do these two things interpenetrate" when
// the engine can state it geometrically. The evidence is in the tranche's own tracked
// research (`docs/research/2026-08-09-viewport-capture-technique.md`, point 4): VULCAN
// (arxiv 2512.22351) answers exactly those two questions with ray probes and annotated
// renders rather than with shading perception, and its floating metric collapses from 0.711
// to 0 without them. A capture is how an agent sees that a room looks wrong; this is how it
// finds out what is wrong, in numbers it can act on.
//
// **READS STAY AHEAD OF WRITES.** Task 3 shipped `applyOps` and `generate`; this is what
// makes them checkable. A mutation verb whose result can only be inspected by eye is a verb
// an agent cannot verify, and the loop the tranche's gate walks — generate, dig, VERIFY,
// bake, capture — has no verify step without it.
//
// WHY IT LIVES UNDER `field-host/` AND COULD NOT LIVE IN THE CHROME. The plan left the
// placement open ("a `frontend/lib/spatial-query.ts` or a field-host module — argued at
// code"), and the argument is machine-enforced rather than stylistic: every answer below is
// derived from the LIVE store and the LIVE op log, and reaching them means value-importing
// `@furnace/core` — `raycastField` directly, and `collisionCenter` behind `proxyCorners`.
// `tests/frontend-no-engine-leakage.test.ts` fails a value import of `@furnace/core`, of
// anything under `field-host/`, or of a core-carrying protocol module, from any
// NON-WORKER-ENTRY file under `src/frontend/` — the exemption covers exactly
// `field-worker.ts` and `analyzer-worker.ts`, which ARE separate bundles, and a
// `frontend/lib/spatial-query.ts` would be neither. So the chrome version of this module
// does not compile past the suite. What the chrome holds is a serialized PROJECTION of the
// host, one latch per seam, which cannot answer a question about geometry it does not have.
// `field-mutation.ts` faced the same question one task earlier and landed the same way.
//
// The api-posture rules that bear on the shape, cited because the plan asked for them.
// **R1 (classify first):** every export here is a QUERY over host state — no resource is
// created, nothing is tracked, nothing is torn down — so there is no lifecycle verb to pick
// and `answer` is the one member. **R3 (call shape):** the pure helpers take their inputs and
// no context, because none of them touches the GPU; the seam takes its state through
// {@link QueryDeps} exactly as this directory's other two seams do. **R8 (abstraction
// tier / surface membership):** this is editor surface built ON core rather than core
// surface — it composes `raycastField` and the placement proxy math and adds no engine
// vocabulary — and it is reached through `field-host/index.ts`'s declared surface, never by
// a chrome file deep-importing it. **R9 (failure policy):** a read that cannot be answered
// THROWS rather than returning an empty answer, which is `field-capture.ts`'s stance and for
// its reason — an empty entity list and "there is no session to ask" are different facts and
// a reader cannot tell them apart from `[]`. In practice no arm reaches a throw, and the
// reason is per-arm rather than the single one an earlier draft gave (*"every input is host
// state"* — false for the ray arm, whose `origin`/`dir`/`maxDist` are CALLER input relayed
// through a cast). The host-state arms cannot fail because their inputs exist whenever the
// host does; the ray arm cannot fail because every value it can be handed is total for
// `raycastField` — the daemon's schema rejects `NaN`/`Infinity` and a zero direction, and
// `maxDist` is clamped here rather than trusted. The conclusion held; the premise did not.
//
// **IT WRITES NOTHING AN ANSWER DEPENDS ON, AND THAT IS A PROPERTY THE CODE HAS TO EARN
// rather than a label.** The hedge in that sentence is exact and is worth four words: one dep
// does write. `deps.footprints()` fills `field-entities.ts`'s `footprintCache`/`footprintSig`
// — a signature-keyed memo of a pure derivation off the log, which {@link QueryDeps.footprints}
// is taken as a CALL precisely to keep honest. Nothing observable changes: the same log
// yields the same boxes, and the memo is the entity list's own regardless of who asked. What
// is claimed without hedge is that no path here touches the STORE, the LOG or the undo
// stacks, which is what the door's `readOnlyHint: true` actually rests on.
// `raycastField` reads `store.cellSize` and calls `getDensity`, and writes nothing —
// verified by READING its body, not by quoting it. (An earlier draft of this line credited
// it with the docblock sentence *"Pure query — the store is never mutated"*, which belongs
// to `materializeSelection` two files over; `raycast.ts` makes no purity claim of its own,
// so the guarantee here is a reading rather than a contract, and a core change could break
// it silently. `tests/field-host/query.test.ts` pins it from the outside for that reason.)
// The placement helpers build fresh arrays, and the entity list and footprints are the
// seams' own reads. The one thing handed out by reference is core's `SelectionSpec`, and the
// selection seam already clones it before it leaves (`field-selection.ts`'s
// `cloneSelectionSpec`, on the `SelectionInfo` this module is given). `session_query` carries
// `readOnlyHint: true` on the agent door since T4c Task 6; this is the code that makes the
// hint true.
import * as field from "@furnace/core/field";
import type { EntityArchetype } from "../shared/catalog.ts";
import { DEFAULT_PROBE_M, MAX_PROBE_M } from "../shared/field-limits.ts";
import type { SessionQueryRequest } from "../shared/wire.ts";
import type { FieldEntityInfo, SelectionInfo } from "./field-host.ts";
import {
  FALLBACK_COLLISION,
  type PlacedArchetype,
  placementOwners,
  proxyCorners,
} from "./field-placements.ts";
import type { HostSubstrate } from "./substrate.ts";

type Vec3T = [number, number, number];
type Box = { min: Vec3T; max: Vec3T };

/**
 * How many placed props one answer will examine.
 *
 * **MEASURED, and the ceiling it is measured against is the HUMAN's frame budget rather than
 * the agent's patience.** Everything here runs synchronously on the tab's main thread — the
 * same thread driving the human's 60 Hz viewport — so the cost of an agent's question is
 * paid in the editor's smoothness while somebody else is working in it. That is the
 * collaboration constraint this whole tranche is built around, and it is a much tighter bound
 * than the backchannel's ten-second ask budget would suggest.
 *
 * The two costs, both measured on this machine (bun, 2026-08-10):
 *
 * | props | pair scan | full-reach contact probes | total |
 * |---|---|---|---|
 * | 2048 | ~14 ms | ~20 ms | ~34 ms |
 * | 4096 | ~55 ms | ~41 ms | ~96 ms |
 * | 8192 | ~237 ms | ~82 ms | ~319 ms |
 *
 * The pair scan is O(N²) and dominates; the probes are linear. 2048 leaves ~3× headroom
 * under the 100 ms interaction ceiling this editor already holds itself to (core's
 * `materializeSelection` cites the same one). 4096 sits ON the ceiling with nothing spare,
 * and 8192 is ~19 dropped frames.
 *
 * THE PROBE FIGURES ARE THE WORST CASE, deliberately: they were taken on a fully-carved 40 m
 * column where every probe walks its whole reach. A prop actually resting on a floor hits at
 * the first sample, and an UNCARVED world hits immediately too (unallocated chunks read as
 * SOLID), so a real world is far cheaper than the table.
 *
 * A world past this cap is not refused — it is reported. See {@link PropReport.truncated}.
 */
const MAX_QUERY_PROPS = 2048;

/**
 * How many rows either lint list may carry.
 *
 * ONE NUMBER FOR BOTH, because they are one kind of thing: a list a caller READS, not a
 * dataset it processes. Past a couple of dozen floating props or interpenetrating pairs the
 * finding is "this placement is systematically wrong" rather than "fix these", and the remedy
 * is to change the generator's params rather than to walk rows. Thirty-two rows is ~3 KB of
 * the answer, which is as much as a lint list can be and still be read.
 *
 * Separate from {@link MAX_QUERY_PROPS} because the two bound different things — that one is
 * a COST ceiling on work done, this is a SIZE ceiling on what is said about it — and a single
 * constant would tie two numbers that must be free to move apart.
 */
const MAX_REPORTED = 32;

/** One placed prop, in the least a caller needs to find it again.
 *
 *  NO INDEX AND NO ID, and the absence is deliberate rather than an omission: a placement
 *  record has no identity of its own anywhere in this editor (`field-placements.ts`'s
 *  `OwnedPlacement` is a record paired with its owning entity, and nothing numbers them), and
 *  a position in this answer's own scan order would be a locator that names nothing an agent
 *  can then act on — there is no verb that takes one. What IS actionable is the entity that
 *  placed it (re-run or delete that stamp) and where it is (look at it, or probe it). */
export type PropRef = {
  /** The committed entity whose span placed this record. */
  entityId: number;
  archetypeId: string;
  /** The centre of the prop's collision proxy, world metres. */
  at: Vec3T;
};

/** A prop that is not resting on anything — {@link Query.answer}'s contact rule, failed.
 *
 *  `base` IS THE PROBE'S OWN ORIGIN, carried so the finding can be re-derived rather than
 *  merely believed: `{about:"ray", origin: base, dir:[0,-1,0]}` runs exactly the cast that
 *  produced `gap`. That is the VULCAN posture applied to its own output — the tool hands over
 *  the fact AND the probe behind it. */
export type FloatingProp = PropRef & {
  base: Vec3T;
  /** Metres from `base` down to the first solid surface, or `null` when there is none within
   *  `DEFAULT_PROBE_M`. `null` is "nothing under this at all", not "the probe gave up" —
   *  `shared/field-limits.ts` argues why that distinction holds. */
  gap: number | null;
};

/** Two props whose proxy boxes interpenetrate, and by how much on each axis. */
export type PropOverlap = {
  a: PropRef;
  b: PropRef;
  /** The intersection box's extents in metres — the shortest of the three is how far one of
   *  them has to move along that axis to separate them. */
  overlap: Vec3T;
};

/**
 * The placed-prop lint: how many there are, and the ones with something wrong with them.
 *
 * **EXCEPTIONS RATHER THAN A ROSTER, and that is the load-bearing shape decision.** A scatter
 * emits hundreds of records; a row per prop would be tens of kilobytes of "this one is fine"
 * for a reader whose whole question is which ones are not. Both lists are the VULCAN metrics
 * exactly — floating, and collision — and both are empty on a world with nothing wrong, which
 * is the answer an agent most often wants and the cheapest one to read.
 *
 * `total` and `scanned` are what keep the empty lists honest: together with
 * {@link truncated} they say whether "nothing found" means "nothing is wrong" or "I did not
 * look at all of it".
 */
export type PropReport = {
  /** Every placement record in the log, whatever this answer examined. */
  total: number;
  /** How many were actually examined — less than `total` when the work cap bit. */
  scanned: number;
  floating: FloatingProp[];
  overlapping: PropOverlap[];
  /**
   * **True when either list is a FLOOR rather than a total** — because props went unexamined
   * (`scanned < total`) or because a list hit its report cap.
   *
   * IT IS ONE BOOLEAN OVER TWO CAUSES ON PURPOSE, and `scanned`/`total` beside it say which
   * bit. What a caller must never do is read an empty `overlapping` as "nothing overlaps"
   * when this is `true`; that is the exact misreading a silently-capped list produces, and it
   * is why the truncation is a field of the answer rather than a note in a docblock.
   */
  truncated: boolean;
};

/** One committed generator entity as the spatial read reports it.
 *
 *  A PROJECTION of `FieldEntityInfo`, not a pass-through, for `SessionState`'s reason: the
 *  host's record carries `params` — a generator-shaped bag whose schema only that generator
 *  knows — and `opSpan`, which names log positions an agent has no verb for. `seed` stays
 *  because it is one number and it is what makes a committed world reproducible. */
export type EntityFact = {
  entityId: number;
  generator: string;
  seed: number;
  /** The region the generator was committed over, world metres. */
  region: Box;
  /** BOOLEANS here where core's record spells absence as absent — `SessionState`'s
   *  `selectedEntity` makes the same conversion for the same reason. */
  frozen: boolean;
  baked: boolean;
  /** One entry per archetype this entity's span placed. Empty for every carver. */
  placed: PlacedArchetype[];
  /** The union of the span's op bounds — the box the editor draws when this entity is
   *  selected — or `null` when the entity wrote nothing bounded. */
  footprint: Box | null;
};

/** What one ray found. `prev` is the last sample before the hit — the air cell a fill would
 *  land in — and is core's own `FieldHit` member, passed through. */
export type RayHit = {
  /** Where the ray entered the first solid sample's cell, world metres. */
  point: Vec3T;
  /** Metres from the origin to `point`. */
  distance: number;
  voxel: Vec3T;
  prev: Vec3T;
};

/**
 * The human's cell selection, as an agent reads it.
 *
 * **NO CELLS, EVER, and this is the plan's third open judgement settled.** A flood may hold
 * up to core's `MAX_SELECTION_BUDGET` — 262 144 cells — which as coordinate triples is
 * megabytes of JSON that no agent can act on and that would blow the tool result's budget on
 * its own. What replaces them is strictly MORE useful and O(1): `spec` is the REPLAYABLE
 * selection — the same shape a selection-masked op embeds, so an agent holding it can write
 * an op that acts on exactly these cells without ever naming one — and `count`/`aabb` are the
 * size and the shape. The cells were never the answer to "what is selected"; the spec is.
 */
export type SelectionFact = {
  /** Core's own replayable spec, cloned by the selection seam before it reaches here. */
  spec: field.SelectionSpec;
  /** Selected cells for a flood; sample-lattice points inside the box for a region. */
  count: number;
  /** The flood hit the editor's UI budget, so `count` is a floor. Always false for a
   *  region. */
  truncated: boolean;
  /** Metre bounds enclosing the selection, or `null` when it matched nothing. */
  aabb: Box | null;
};

/** What {@link Query.answer} hands back — one arm per `about`, discriminated by it, so a
 *  caller branches on the same word it asked with. */
export type QueryAnswer =
  | { about: "entities"; entities: EntityFact[]; props: PropReport }
  | {
      about: "ray";
      origin: Vec3T;
      dir: Vec3T;
      /** The reach actually used — the request's, or `DEFAULT_PROBE_M`. Echoed so a `null`
       *  hit says what was searched. */
      maxDist: number;
      hit: RayHit | null;
    }
  | { about: "selection"; selection: SelectionFact | null };

/** What the spatial read needs from the rest of the host. FOUR members, every one a read. */
export type QueryDeps = {
  /** `store` for the probes and the cell size, `log` for the placements, `archetypeById` for
   *  each record's collision primitive. */
  substrate: HostSubstrate;
  /** The committed entities (`field-entities.ts`'s `list`) — clones, with their `placed`
   *  attribution already done in one pass. */
  entities(): FieldEntityInfo[];
  /** Every entity's pick box, memoized on the log signature (`field-entities.ts`'s
   *  `footprints`). Taken as a call rather than a map, because the memo re-derives whenever
   *  the log moves and a held map would be a photograph of an older world. */
  footprints(): Map<number, Box>;
  /** The current cell selection, or `null` — `field-selection.ts`'s `info`. The SAME record
   *  the chrome's panel renders, so an agent and a human cannot be told different things
   *  about one selection. */
  selection(): SelectionInfo | null;
};

/** The spatial read: one verb. */
export type Query = {
  /**
   * Answer one spatial question. Nothing below writes to the store, the log or the undo
   * stacks (this module's header carries the one benign exception and why it is not one).
   *
   * THE CONTACT RULE, stated here because it is the one definition a caller has to be able to
   * act on and must not have to infer. A prop is IN CONTACT when a ray cast straight down
   * from the centre of its proxy box's base finds a solid sample within one CELL SIZE
   * (`store.cellSize`, 0.25 m in this editor). Everything about that is chosen so the answer
   * is deterministic and reproducible:
   *
   *  - **Straight down from the base centre**, so the probe is a function of the prop's own
   *    box and nothing else — no camera, no viewport, no ordering.
   *  - **One cell of tolerance, which is the answer's RESOLUTION rather than a fudge
   *    factor.** `raycastField` reports where the ray entered the first solid sample's cell,
   *    and the surface the mesher extracts from that lattice lies within one cell of it. A
   *    gap smaller than a cell is therefore not a gap this field can distinguish from
   *    resting, and any tighter tolerance would report noise as a defect.
   *  - **A prop BURIED in the floor reports contact**, at `gap: 0`. Core's raycast hits its
   *    own start voxel at t=0 when it begins inside rock, and "sunk into the floor" is not
   *    the defect this probe is looking for.
   *
   * ENTITIES ARE NOT CONTACT-PROBED, and the asymmetry is not an oversight. A carver's
   * footprint is a volume of AIR it removed, so a downward probe from its base hits the rock
   * immediately underneath the floor it just made — "in contact", always, for every hall and
   * every cave. The question has no meaning for a subtractive volume; it has meaning for a
   * thing PUT somewhere, which is a prop.
   *
   * **THE DEFINITION LIVES IN THREE PLACES AND THE THIRD IS THE ONE THAT MATTERS**, said
   * because an agent that cannot read it gets nothing from "ask this, don't squint". It is
   * HERE, in `editor-architecture.md` §27.2, and — since T4c Task 6 — in `session_query`'s own
   * MCP tool description, restated in full: the downward ray, the base centre, one cell of
   * tolerance, buried-reports-contact, and why entities are not probed. A tool that said "ask
   * me about contact" without saying what contact MEANS would hand an agent a boolean it
   * cannot calibrate. The tool prose is a RESTATEMENT rather than a link, deliberately: an
   * agent cannot follow a citation, and this is the one place the rule is worth spelling
   * twice.
   *
   * @throws Error - only on a request naming an `about` this module has no arm for, which the
   *   daemon's schema makes unreachable through the door; see {@link Query.answer}'s
   *   implementation for why that guard is a `never` binding rather than a silent fallback.
   *   No arm throws on well-formed input — the module header's R9 note carries the per-arm
   *   reason.
   */
  answer(req: SessionQueryRequest): QueryAnswer;
};

/** The axis-aligned bounds of one oriented proxy box, from `proxyCorners`' 24 floats.
 *
 *  AN OVER-APPROXIMATION FOR A ROTATED PROP, stated because it decides which way the overlap
 *  lint errs: the AABB of a tilted box is larger than the box, so two rotated props can be
 *  reported as overlapping without actually interpenetrating. That is the same direction
 *  `FieldDriftReport.entityIds` chose and for the same reason — over-inclusion keeps the
 *  finding TRUE ("look here"), while under-inclusion silently drops the pointer and leaves an
 *  agent believing a world is clean. */
export function cornersAabb(corners: Float32Array): Box {
  const min: Vec3T = [Infinity, Infinity, Infinity];
  const max: Vec3T = [-Infinity, -Infinity, -Infinity];
  // UNROLLED PER AXIS rather than an inner `for (axis…)` loop, which is a readability choice
  // that happens to also be the typed one: under `noUncheckedIndexedAccess` a VARIABLE index
  // into the tuple widens to `number | undefined`, and `typescript.md`'s hot-path exemption
  // covers author-known LITERAL indices only — so the loop form would need three casts this
  // form does not need at all. `?? 0` on the source reads is the same narrowing on a
  // Float32Array and is unreachable: `proxyCorners` returns exactly 24 floats and `i` walks
  // its own length in threes.
  for (let i = 0; i < corners.length; i += 3) {
    const x = corners[i] ?? 0;
    const y = corners[i + 1] ?? 0;
    const z = corners[i + 2] ?? 0;
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return { min, max };
}

/**
 * The intersection extents of two boxes, or `null` when they do not interpenetrate.
 *
 * **TOUCHING IS NOT OVERLAPPING**, and the strict `> 0` is what says so. Props placed flush
 * — a run of crates against a wall, a floor tiled edge to edge — share a face exactly, and a
 * `>=` test would report every one of them. That would drown the real findings in the case
 * the lint exists to surface, which is the failure mode a noisy lint has: an agent that
 * learns to ignore this list gets nothing from it.
 */
export function boxOverlap(a: Box, b: Box): Vec3T | null {
  const dx = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const dy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
  const dz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  if (dx <= 0 || dy <= 0 || dz <= 0) return null;
  return [dx, dy, dz];
}

/** The point a prop's contact probe is cast from: the centre of its box's base face. */
export function probeBase(aabb: Box): Vec3T {
  return [
    (aabb.min[0] + aabb.max[0]) / 2,
    aabb.min[1],
    (aabb.min[2] + aabb.max[2]) / 2,
  ];
}

/** Metres from `base` straight down to the first solid surface, or `null` when there is none
 *  within {@link DEFAULT_PROBE_M}. Never negative — the ray travels −Y, so its hit point can
 *  only be at or below its origin. */
export function contactGap(
  store: field.FieldStore,
  base: Vec3T,
): number | null {
  const hit = field.raycastField(store, base, [0, -1, 0], DEFAULT_PROBE_M);
  return hit === null ? null : base[1] - hit.point[1];
}

/** One examined prop: where it is, its axis-aligned box, and the gap under it. */
type ScannedProp = { ref: PropRef; aabb: Box; base: Vec3T; gap: number | null };

/** A box, copied. Every box this module hands out is its own — the log's arrays, the
 *  footprint memo's boxes and the selection's AABB are all live host state. */
const copyBox = (box: {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}): Box => ({
  min: [box.min[0], box.min[1], box.min[2]],
  max: [box.max[0], box.max[1], box.max[2]],
});

/** {@link copyBox} through a nullable — the two optional box members share it. */
const copyBoxOrNull = (box: Box | null | undefined): Box | null =>
  box === undefined || box === null ? null : copyBox(box);

/** The centre of a box, world metres. */
const boxCentre = (box: Box): Vec3T => [
  (box.min[0] + box.max[0]) / 2,
  (box.min[1] + box.max[1]) / 2,
  (box.min[2] + box.max[2]) / 2,
];

/**
 * Examine up to {@link MAX_QUERY_PROPS} placed records: box, base, contact gap.
 *
 * The catalog SEEDS and never gates (`field-placements.ts`' rule), so a record naming an
 * archetype this project has no entry for is measured at {@link FALLBACK_COLLISION} rather
 * than skipped — a prop the viewport DRAWS must be a prop this answer can see. The
 * consequence of getting that backwards is the reason it is tested with a POPULATED catalog:
 * a lookup that silently fell through would measure a 4 m pillar as a 0.5 m cube, and both
 * lint lists would then be wrong in the direction nobody notices.
 *
 * **MODULE-LEVEL AND EXPORTED, like the four pure helpers above and for their reason** — the
 * precedent is `field-capture.ts`'s `capturePixels`, whose docblock puts it plainly: its
 * second caller is a test, and that is the point rather than an apology. These three were
 * closures over `createQuery` until the T4c review observed they capture only the store, so
 * the cap-and-truncation arithmetic — the logic most worth asserting exactly — was reachable
 * only through a 2100-prop fixture. They take what they read instead. Nothing here is on the
 * package barrel; `field-host/index.ts` re-exports the answer TYPES and no function.
 */
export function scanProps(
  store: field.FieldStore,
  owned: readonly { entityId: number; record: field.PlacementRecord }[],
  catalog: ReadonlyMap<string, EntityArchetype>,
): ScannedProp[] {
  return owned.slice(0, MAX_QUERY_PROPS).map(({ entityId, record }) => {
    const collision =
      catalog.get(record.archetypeId)?.collision ?? FALLBACK_COLLISION;
    const aabb = cornersAabb(proxyCorners(record, collision));
    const base = probeBase(aabb);
    return {
      ref: { entityId, archetypeId: record.archetypeId, at: boxCentre(aabb) },
      aabb,
      base,
      gap: contactGap(store, base),
    };
  });
}

/** Every interpenetrating pair, to the report cap.
 *
 *  A PLAIN O(N²) SWEEP, and the alternative was weighed rather than skipped: a sort-and-
 *  sweep on X would make the realistic case near-linear, and it would not change the
 *  DEGENERATE case (props stacked at one X stay quadratic) — which is precisely the case a
 *  bound has to survive. So the bound is doing the work either way, and the simple loop is
 *  what the bound is measured against ({@link MAX_QUERY_PROPS}). */
export function findOverlaps(props: readonly ScannedProp[]): PropOverlap[] {
  const out: PropOverlap[] = [];
  for (let i = 0; i < props.length && out.length < MAX_REPORTED; i++) {
    for (let j = i + 1; j < props.length && out.length < MAX_REPORTED; j++) {
      const a = props[i];
      const b = props[j];
      if (a === undefined || b === undefined) break; // unreachable: both indices in range
      const overlap = boxOverlap(a.aabb, b.aabb);
      if (overlap !== null) out.push({ a: a.ref, b: b.ref, overlap });
    }
  }
  return out;
}

/**
 * The placed-prop lint over one scan. Both lists are cut to {@link MAX_REPORTED}.
 *
 * `tolerance` is the field's CELL SIZE — the contact rule's whole definition — taken as an
 * argument rather than read off a captured store, so the rule is assertable at every value
 * that matters rather than only at the editor's 0.25 m.
 *
 * THE TWO TRUNCATION TESTS ARE NOT THE SAME SHAPE, and the asymmetry is real rather than
 * sloppy. `floating` is filtered whole and then sliced, so `> MAX_REPORTED` is EXACT — equal
 * to the cap means nothing was cut. {@link findOverlaps} stops the moment it fills, so it
 * cannot know whether a further pair existed; `>= MAX_REPORTED` therefore over-reports
 * truncation in the one case where the world has exactly 32 overlaps. That is the safe
 * direction for a flag whose job is to stop an empty-looking list reading as a clean world,
 * and buying exactness would mean running the whole quadratic scan to count pairs nobody is
 * going to be shown.
 */
export function lint(
  props: readonly ScannedProp[],
  total: number,
  tolerance: number,
): PropReport {
  const floating = props.filter((p) => p.gap === null || p.gap > tolerance);
  const overlapping = findOverlaps(props);
  const propsWentUnexamined = props.length < total;
  const floatingWasCut = floating.length > MAX_REPORTED;
  const overlapsMayHaveBeenCut = overlapping.length >= MAX_REPORTED;
  return {
    total,
    scanned: props.length,
    floating: floating.slice(0, MAX_REPORTED).map((p) => ({
      ...p.ref,
      base: p.base,
      gap: p.gap,
    })),
    overlapping,
    truncated: propsWentUnexamined || floatingWasCut || overlapsMayHaveBeenCut,
  };
}

/** Build the spatial read over one host's dependencies. Holds no state of its own — the
 *  three functions above were closures here until the T4c review; what is left is the wiring
 *  between the deps record and them. */
export function createQuery(deps: QueryDeps): Query {
  const { substrate } = deps;

  const entitiesAnswer = (): QueryAnswer => {
    const footprints = deps.footprints();
    const owned = placementOwners(substrate.log.ops);
    return {
      about: "entities",
      entities: deps.entities().map((e) => ({
        entityId: e.entityId,
        generator: e.generator,
        seed: e.seed,
        region: copyBox(e.region),
        frozen: e.frozen === true,
        baked: e.baked === true,
        placed: e.placed,
        footprint: copyBoxOrNull(footprints.get(e.entityId)),
      })),
      props: lint(
        scanProps(substrate.store, owned, substrate.archetypeById()),
        owned.length,
        substrate.store.cellSize,
      ),
    };
  };

  const rayAnswer = (
    req: Extract<SessionQueryRequest, { about: "ray" }>,
  ): QueryAnswer => {
    // CLAMPED HERE AS WELL AS REFUSED AT THE DOOR, which is the two-postures-on-one-bound
    // split `shared/capture.ts` states for `size` and this module was leaning on a sibling to
    // keep. The daemon refuses out of range because a schema is an advertisement; the host
    // clamps because it is also reachable from a test and from any future in-process caller,
    // and past `MAX_PROBE_M` the answer's `null` stops meaning "nothing there" — the one
    // property this module promises about it. `maxDist` is ECHOED, so a clamp is visible to
    // the caller rather than silent.
    const maxDist = Math.min(req.maxDist ?? DEFAULT_PROBE_M, MAX_PROBE_M);
    // The tuples are COPIED out of the request before they travel into core and back into the
    // answer. The request is the daemon's parsed object rather than host state, so aliasing it
    // is harmless today; six numbers is what it costs to keep "every array this module hands
    // out is its own" true without an exception nobody would remember.
    const origin: Vec3T = [req.origin[0], req.origin[1], req.origin[2]];
    const dir: Vec3T = [req.dir[0], req.dir[1], req.dir[2]];
    const hit = field.raycastField(substrate.store, origin, dir, maxDist);
    if (hit === null) return { about: "ray", origin, dir, maxDist, hit: null };
    return {
      about: "ray",
      origin,
      dir,
      maxDist,
      hit: {
        point: [hit.point[0], hit.point[1], hit.point[2]],
        // Derived rather than carried: core's `FieldHit` reports the entry POINT and not a
        // `t`, and the point is on the ray, so the distance is the one arithmetic step
        // between them. A caller asking "how far ahead is the wall" should not have to do it.
        distance: Math.hypot(
          hit.point[0] - origin[0],
          hit.point[1] - origin[1],
          hit.point[2] - origin[2],
        ),
        voxel: [hit.voxel[0], hit.voxel[1], hit.voxel[2]],
        prev: [hit.prev[0], hit.prev[1], hit.prev[2]],
      },
    };
  };

  const selectionAnswer = (): QueryAnswer => {
    const info = deps.selection();
    // `displayed` is deliberately dropped from the projection: it says how much of a flood
    // the VIEWPORT is drawing as cubes, which is a fact about the human's screen rather than
    // about the selection, and an agent reading it would conclude the selection was smaller
    // than it is.
    return {
      about: "selection",
      selection:
        info === null
          ? null
          : {
              spec: info.spec,
              count: info.count,
              truncated: info.truncated,
              aabb: copyBoxOrNull(info.aabb),
            },
    };
  };

  return {
    /**
     * A `switch` WITH AN EXHAUSTIVENESS GUARD, not an if-chain ending in a catch-all — and
     * the difference is a defect this shipped with for one review.
     *
     * The first cut closed on a bare `return entitiesAnswer()`, so a FOURTH arm added to
     * {@link SessionQueryRequest} would have compiled, passed every test, passed the schema
     * drift pin, and answered about ENTITIES — a confident answer to a question nobody asked.
     * Measured at review: adding `| { about: "lights" }` to the wire type left
     * `tsc --noEmit` clean over the whole package. `QUERY_SCHEMA_MATCHES_WIRE` does not cover
     * it either, and that is structural rather than an oversight in the pin: a NARROWER schema
     * union stays assignable to a WIDER wire union, so growing the wire is exactly the
     * direction assignability cannot see.
     *
     * `const _never: never = req` is what turns the gap into a build error: once every arm is
     * handled, `req` narrows to `never` here, and it stops doing so the moment an arm is added
     * without a branch. It is also `clean-code.md` §Branching's rule — dispatch on a
     * discriminator through a `switch`, not an `if`-chain — which the first cut broke as well.
     *
     * `session-answerers.ts`'s row makes the neighbouring guarantee and only that one: it
     * refuses a request with NO `about`. Missing and unhandled are different failures, and
     * unhandled is the one a future task actually creates.
     */
    answer(req) {
      switch (req.about) {
        case "entities":
          return entitiesAnswer();
        case "ray":
          return rayAnswer(req);
        case "selection":
          return selectionAnswer();
        default: {
          const _never: never = req;
          // Unreachable while the switch is exhaustive; the binding above is the compile-time
          // half and this is the runtime half, so a request forged past the daemon's schema
          // fails loudly instead of being answered about something else.
          throw new Error(
            `field-query: no arm for about=${String((req as { about: unknown }).about)}`,
          );
        }
      }
    },
  };
}

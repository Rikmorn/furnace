// The walkability advisor's PRESENTATION state, pure and GPU-free (the
// field-ghost.ts / field-placements.ts sibling): what the analyzer worker found,
// what the filters admit, what stage 2 has since proved, and which colour each
// finding wears. The host owns the worker, the markers and the subscribers; this
// module owns everything that can be decided without either.
//
// ADVISOR POSTURE (D-F4-1) all the way down: nothing here mutates a field, and
// nothing DELETES a finding. A filter hides; a demotion tag hides; neither
// removes. The one place a finding disappears is a re-analysis that no longer
// reports it, which is the analyzer changing its mind, not this module.
import type {
  ChunkKey,
  FieldFlag,
  FlagKind,
  FlagSeverity,
} from "@furnace/core/field";
import type { VerifyVerdictWire } from "./analyzer-protocol.ts";

/** Which triage bands the viewport and the palette show. `candidates`/`info` are
 *  the severity bands; `unreachable` admits the flags the reachability pass
 *  DEMOTED and `pits` admits the whole-world trap findings — both of those are
 *  one-sided VETOES rather than bands of their own (see {@link passesFilters}). */
export type FlagFilters = {
  candidates: boolean;
  info: boolean;
  unreachable: boolean;
  pits: boolean;
};

/** Candidates only, pits included: what is worth a stage-2 verify. `info` is
 *  context (terrain the mover simply handles) and `unreachable` is what the flood
 *  could not get to — both real findings, both noise until asked for.
 *
 *  `pits` starts ON, unlike the other two off-by-default chips, because it is not
 *  a band the user is opting INTO: a pit carries `severity: "candidate"`, so the
 *  candidates chip beside it already claims to be showing it. Defaulting the veto
 *  on would make that claim false for the most serious finding the advisor has. */
export const DEFAULT_FLAG_FILTERS: FlagFilters = {
  candidates: true,
  info: false,
  unreachable: false,
  pits: true,
};

/** RGBA, the shape `mesh.setInstanceTint` takes. */
export type FlagTint = [number, number, number, number];

/** Unverified `candidate` — a red that reads as "look here". */
export const CANDIDATE_TINT: FlagTint = [0.9, 0.28, 0.3, 1];
/** Unverified `info` — the selection amber (SELECTION_COLOR), deliberately: both
 *  say "context", neither says "act". */
export const INFO_TINT: FlagTint = [1, 0.75, 0.3, 1];
/** Stage 2 drove the real mover and it got STUCK: the candidate red darkened, so
 *  a proven trap reads as the same finding with the doubt taken out. */
export const VERIFIED_TRAPPED_TINT: FlagTint = [0.4, 0.12, 0.14, 1];
/** Stage 2 walked it: a muted green. Not deleted — the finding stands, with the
 *  mover's answer attached (the advisor never overrules itself away). */
export const VERIFIED_CLEAR_TINT: FlagTint = [0.4, 0.8, 0.5, 1];

/**
 * One finding's identity: its kind and its anchor cell.
 *
 * The key for BOTH the presentation dedupe and the verdict map, which is not a
 * coincidence — a verdict is about a finding the user can see, so the two have
 * to agree on what "one finding" is. Cell alone would be wrong: a single cell
 * can carry a `narrow` AND a `low-clearance`, and collapsing them would drop a
 * finding rather than a duplicate.
 *
 * PRIVATE, and the format with it. It reaches a consumer only as
 * {@link FlagRow.key} — a value to hand back, never a string to build. The
 * chrome cannot value-import anything under `field-host/`:
 * `frontend-no-engine-leakage.test.ts` bans the whole DIRECTORY by path, because
 * the barrel beside this file re-exports the hosts and so carries core. THIS
 * file carries none (both its imports are `import type`), but the rule is a path
 * rule and does not look. So an exported key builder would be unreachable from
 * the one place that would need it, and the format would get re-spelled there.
 */
const flagKey = (f: FieldFlag): string =>
  `${f.kind}@${f.cell[0]},${f.cell[1]},${f.cell[2]}`;

/**
 * Where one finding's marker STANDS: its anchor cell's world corner, raised half
 * a cell in Y.
 *
 * The lift is the whole content of this function and the reason it exists at all
 * — `flag.world` is the FLOOR surface, so a marker drawn at it is sunk into the
 * floor rather than standing in the air cell the finding is about. Two things
 * need that fact and must not spell it twice: the host's instanced-marker matrix
 * (what is drawn) and the pointer pick's cell box (what is clickable). Written
 * twice they drift by half a cell, and the pick misses every marker on screen
 * while looking correct in review.
 *
 * Cell-relative because the lift is: a coarser lattice raises the marker
 * further. (The marker's drawn SIZE is a fixed metre constant in the host,
 * which is safe only because that host is single-lattice — see its comment.)
 */
export const flagMarkerCenter = (
  world: readonly [number, number, number],
  cellSize: number,
): [number, number, number] => [world[0], world[1] + cellSize / 2, world[2]];

/**
 * The metre box of one finding's ANCHOR CELL — the marker's own cell, spanning
 * `world.y … world.y + cellSize` in Y and one cell each way in X and Z.
 *
 * THREE things need this exact box and none of them may spell it again: the
 * pointer pick's click volume (a 0.18 m pin is a hard target; the cell is what
 * the finding is about), the camera frame `selectFlag` runs, and the outline the
 * host draws round the selected marker. The frame is why this exists at all —
 * clicking a flag row used to frame its whole CHUNK, four metres of world around
 * a finding the size of a fist (the F4 gate's first item).
 */
export const flagCellBox = (
  world: readonly [number, number, number],
  cellSize: number,
): { min: [number, number, number]; max: [number, number, number] } => {
  const [cx, cy, cz] = flagMarkerCenter(world, cellSize);
  const half = cellSize / 2;
  return {
    min: [cx - half, cy - half, cz - half],
    max: [cx + half, cy + half, cz + half],
  };
};

/** How much bigger the SELECTED finding's marker is drawn. A multiplier on
 *  `field-analyzer.ts`'s `FLAG_MARKER_SIZE_M` rather than a second metre constant
 *  beside it, so a change to the marker size cannot leave the emphasis behind. */
export const FLAG_SELECTED_SCALE = 1.6;

/** What one marker instance is drawn as: its colour, and its size relative to the
 *  advisor's base marker constant. */
export type FlagMarkerStyle = { tint: FlagTint; scale: number };

/**
 * One marker's per-instance appearance, given whether it is the selected finding.
 *
 * The colour is NOT touched by selection, and that is D-15's instruction rather
 * than an omission: "emphasis tiers on an outline treatment **independent of
 * surface color**" (the Blender active/selected model). The concrete cost of
 * doing otherwise is that a re-tinted marker deletes the trapped/clear/candidate
 * signal from the one row the user is looking at — the row they most need it on.
 * The `--primary` half of D-15 rides the cell OUTLINE the host draws beside the
 * marker; this function owns the size pop.
 */
export const flagMarkerStyle = (
  row: FlagRow,
  selected: boolean,
): FlagMarkerStyle => ({
  tint: flagTint(row),
  scale: selected ? FLAG_SELECTED_SCALE : 1,
});

/**
 * What one finding is DRAWN as: the stage-2 verdict if there is one, else the
 * triage band it was found in.
 *
 * An `inconclusive` verdict falls through to the band on purpose — a verify that
 * ran out of budget or found no lane proved nothing about the finding, and
 * painting it as a third state would read as an answer.
 */
export const flagTint = (row: FlagRow): FlagTint => {
  if (row.verdict !== undefined) {
    if (row.verdict.outcome === "trapped") return VERIFIED_TRAPPED_TINT;
    if (row.verdict.outcome === "clear") return VERIFIED_CLEAR_TINT;
  }
  return row.flag.severity === "candidate" ? CANDIDATE_TINT : INFO_TINT;
};

/**
 * One finding as everything that SHOWS it consumes it: the analyzer's flag, the
 * stage-2 verdict taken on it (absent until one is), and a stable identity for a
 * list key or a callback argument.
 *
 * A ROW for the reason {@link FlagCount} is one — anything the chrome would have
 * to LOOK UP by a key it cannot spell has to arrive already joined. Shipping a
 * verdict MAP instead would push `${kind}@${x},${y},${z}` into the panel, which
 * is the duplicated-format-string divergence this module exists on the right
 * side of.
 */
export type FlagRow = {
  /** Opaque and stable across responses for the same finding. Hand it back;
   *  never build one. */
  key: string;
  /** The analyzer's finding. READ-ONLY to a consumer — the store hands out the
   *  worker's own objects. */
  flag: FieldFlag;
  /** What stage 2 proved, once it has run on this finding. */
  verdict?: VerifyVerdictWire;
};

/** How many findings of one (kind, severity) pair stand. A ROW rather than a
 *  keyed map entry so a reader never has to spell the pair — which matters
 *  because the chrome cannot value-import anything under `field-host/` (see
 *  {@link flagKey}), so a key function would be unreachable from the one consumer
 *  that needs it. */
export type FlagCount = {
  kind: FlagKind;
  severity: FlagSeverity;
  count: number;
};

/** What a {@link FlagStore} subscriber is handed after every analyzer response.
 *  `total` and `byKindSeverity` describe everything FOUND (deduped, unfiltered);
 *  `visible` is what the filters admit, and the only one of the three a viewport
 *  or a list should render. */
export type FlagsSummary = {
  total: number;
  /** One row per (kind, severity) pair that has any findings, in kind then
   *  severity order. Pairs with none are ABSENT rather than zero, so a reader
   *  iterates what exists. */
  byKindSeverity: FlagCount[];
  /** The findings the filters admit, each already carrying its verdict. */
  visible: FlagRow[];
  /** Which finding is SELECTED — always a key present in {@link visible}, or
   *  null.
   *
   *  Resolved at publish time rather than mirrored, and that is the whole design:
   *  the store retains whatever key it was handed, but only publishes it while a
   *  visible row answers to it. So a filter that HIDES the selected row publishes
   *  null and ticking the band back on brings the selection back, while a
   *  re-analysis that RETIRES the finding publishes null forever. Those two want
   *  opposite treatment and are indistinguishable from the key alone, which is why
   *  nothing here validates passively. The invariant a consumer may rely on: if
   *  `selected` is non-null, exactly one `visible` row carries it. */
  selected: string | null;
};

/** One recorded verdict, with the two facts needed to know when it goes stale:
 *  which chunk's re-analysis invalidates it, and whether it belongs to the
 *  whole-world pit set instead. The FLAG is deliberately not retained — a
 *  verdict outlives the flag object it was taken on. */
type VerdictEntry = {
  chunk: ChunkKey;
  kind: FlagKind;
  verdict: VerifyVerdictWire;
};

/**
 * Whether the filters admit one finding.
 *
 * The reachability test is ONE-SIDED — it hides `unreachable === true` and
 * nothing else. `undefined` means no flood has visited this flag, which is the
 * normal mixed-vintage steady state of a per-chunk analyzer beside a
 * whole-world pass (and the permanent state of every `pit`, which that pass
 * deliberately skips). Testing `=== false` for "reachable" would silently hide
 * every never-analysed finding — a false negative wearing a filter's clothes.
 */
const passesFilters = (f: FieldFlag, filters: FlagFilters): boolean => {
  if (f.unreachable === true && !filters.unreachable) return false;
  // The pit veto, one-sided for the reachability rule's reason and one more of
  // its own: a pit IS a candidate, so this is a subtraction from that band rather
  // than a band beside it. Un-ticking `pits` while `candidates` stands leaves
  // every per-cell candidate showing; ticking `pits` while `candidates` is off
  // shows nothing, because there is no severity left to admit it.
  if (f.kind === "pit" && !filters.pits) return false;
  return f.severity === "candidate" ? filters.candidates : filters.info;
};

/** Plain lexicographic string order, as a named function so the sort below is
 *  one expression rather than a nested ternary. */
const compareKeys = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/**
 * The findings to present, one per {@link flagKey}.
 *
 * Cross-border duplicates are real and deliberate: `low-clearance` anchors on
 * the offending NEIGHBOUR cell, so a cell on a chunk border is emitted by both
 * owners' passes (F4 tranche A measured 48 duplicated cells of 208 on a
 * border-aligned fixture). Suppressing that in core would LOSE flags at the
 * border, so the duplication is core's miss-safe choice and this is where it is
 * paid for.
 *
 * Which copy survives matters: the two can carry different `unreachable` tags,
 * because their owner chunks were analysed by different passes. The LEAST
 * demoted copy wins, so a stale demotion on one owner can never hide a finding
 * the other owner has nothing against.
 *
 * Ordered by key string — determinism, not spatial order (`"narrow@10,0,0"`
 * precedes `"narrow@2,0,0"`), so a list does not reshuffle between responses
 * that found the same things.
 */
const dedupeByKey = (lists: Iterable<readonly FieldFlag[]>): FieldFlag[] => {
  const byKey = new Map<string, FieldFlag>();
  for (const list of lists)
    for (const f of list) {
      const key = flagKey(f);
      const held = byKey.get(key);
      if (held === undefined) byKey.set(key, f);
      else if (held.unreachable === true && f.unreachable !== true)
        byKey.set(key, f);
    }
  return [...byKey.entries()]
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([, f]) => f);
};

/** The advisor's findings as the editor holds them, between analyzer responses.
 *  Every method is a command or a query, never both; {@link FlagStore.summary}
 *  derives the whole view and holds no cache, so no state can go stale behind
 *  it. */
export type FlagStore = {
  /**
   * Land one `flags` response.
   *
   * `chunks` REPLACES the findings of every chunk it names, empty lists
   * included — a chunk that analysed to nothing is how a fixed problem stops
   * being reported. Replacement is also what clears a stale `unreachable` tag:
   * `markUnreachable` leaves prior demotions standing on its skip paths (no
   * usable seed), so a store that merged tags would hide those findings for the
   * rest of the session.
   *
   * `pits` is the whole-world pass's output and REPLACES the pit set entirely
   * when present. `undefined` means this response was incremental and has
   * nothing to say about traps — a per-chunk response must never be able to
   * clear a world-cadence finding.
   */
  applyFlags(
    chunks: readonly { key: ChunkKey; flags: readonly FieldFlag[] }[],
    pits?: readonly FieldFlag[],
  ): void;
  /**
   * The VISIBLE row a {@link FlagRow.key} names, or `undefined` when nothing
   * currently shown answers to it (a re-analysis moved on, or a world reset).
   *
   * Here rather than in the host because this is the inverse of {@link flagKey},
   * which is private to this module and must stay that way — a caller that
   * resolved keys itself would be re-spelling the format. Scoped to the visible
   * rows on purpose: a key only ever reaches a consumer through
   * {@link FlagsSummary.visible}, so a hidden finding is one nothing can be
   * holding a key for.
   */
  rowByKey(key: string): FlagRow | undefined;
  /** Record what stage 2 proved about one finding. */
  setVerdict(flag: FieldFlag, verdict: VerifyVerdictWire): void;
  setFilters(filters: FlagFilters): void;
  filters(): FlagFilters;
  /** Remember which finding is selected, or `null` for none. Stored VERBATIM and
   *  never validated here — {@link FlagsSummary.selected} does the resolving, and
   *  `field-analyzer.ts`'s `selectFlagImpl` does the refusing (through
   *  {@link rowByKey}, so an unknown key is reported rather than silently
   *  stored). Named for the IMPLEMENTATION rather than for `FieldHost.selectFlag`
   *  it backs, because the viewport's marker click reaches `setSelected` by
   *  another route — `field-picking.ts` → `setSelectedFlag` — which goes past the
   *  refusal deliberately, and a sentence naming only the facade member would
   *  read as though every write here had been validated. */
  setSelected(key: string | null): void;
  /** Drop every finding, pit, verdict and the selection (a world reset). Filters
   *  survive — they are a view preference, like the layer flags. The selection
   *  does NOT: it names a finding in a world that is gone, and keeping it would
   *  let the next world's analyzer resurrect it by coincidence. */
  clear(): void;
  summary(): FlagsSummary;
};

export function createFlagStore(): FlagStore {
  // Stage-1 findings by OWNER chunk — the replacement unit the worker's `flags`
  // response is built in.
  const byChunk = new Map<ChunkKey, readonly FieldFlag[]>();
  // Pits, beside rather than inside: a pit region can span chunks, so its
  // `chunk` (the anchor's) is not a complete owner and the per-owner
  // replacement model cannot express it.
  let pits: readonly FieldFlag[] = [];
  const verdicts = new Map<string, VerdictEntry>();
  let filters: FlagFilters = { ...DEFAULT_FLAG_FILTERS };
  let selectedKey: string | null = null;

  /** The findings to present, deduped and ordered — the one input both
   *  {@link FlagStore.summary} and {@link FlagStore.rowByKey} read, so the two
   *  can never disagree about what exists. */
  const findings = (): FieldFlag[] => dedupeByKey([...byChunk.values(), pits]);

  /** One finding as a row, with its verdict joined if it has one. */
  const rowOf = (flag: FieldFlag): FlagRow => {
    const key = flagKey(flag);
    const entry = verdicts.get(key);
    return entry === undefined
      ? { key, flag }
      : { key, flag, verdict: entry.verdict };
  };

  return {
    applyFlags(chunks, nextPits) {
      for (const { key, flags } of chunks) {
        byChunk.set(key, flags);
        // A verdict describes a mover walked against a field that has since
        // been re-analysed here — the finding may have moved, changed band or
        // gone. Cheaper and more honest to drop it than to guess it still holds.
        // `pit` is excluded because a pit's `chunk` is its ANCHOR's alone and its
        // region can span more, so this per-owner rule cannot decide staleness
        // for one — the wholesale pit replacement below does. Safe today only
        // because no pit verdict is ever created: v1 does not offer stage-2
        // verify on a pit (a region-level finding; the UI disables the button
        // with "walk it" as the reason). If pits ever become verifiable, one on a
        // since-dug pit would read current until the next whole-world pass, and
        // this exclusion is where that gets fixed.
        for (const [flagId, entry] of verdicts)
          if (entry.kind !== "pit" && entry.chunk === key)
            verdicts.delete(flagId);
      }
      if (nextPits === undefined) return;
      pits = nextPits;
      for (const [flagId, entry] of verdicts)
        if (entry.kind === "pit") verdicts.delete(flagId);
    },
    rowByKey(key) {
      // `find`, not a built map: one call per Verify click, and the early exit
      // beats materializing every row to read one.
      const flag = findings().find(
        (f) => flagKey(f) === key && passesFilters(f, filters),
      );
      return flag === undefined ? undefined : rowOf(flag);
    },
    setVerdict(flag, verdict) {
      verdicts.set(flagKey(flag), {
        chunk: flag.chunk,
        kind: flag.kind,
        verdict,
      });
    },
    setFilters(next) {
      filters = { ...next }; // copy — store state never aliases a caller's object
    },
    filters() {
      return { ...filters };
    },
    setSelected(key) {
      selectedKey = key;
    },
    clear() {
      byChunk.clear();
      pits = [];
      verdicts.clear();
      selectedKey = null;
    },
    summary() {
      const found = findings();
      // Keyed while counting, rows on the way out: the map is the natural tally
      // and the rows are the shape a consumer can read without knowing the key.
      const tally = new Map<string, FlagCount>();
      for (const f of found) {
        const pair = `${f.kind}/${f.severity}`;
        const row = tally.get(pair);
        if (row === undefined)
          tally.set(pair, { kind: f.kind, severity: f.severity, count: 1 });
        else row.count += 1;
      }
      // The join happens through `rowOf`, the same one `rowByKey` uses — so a
      // row resolved by key and a row read off the summary are built by one
      // piece of code and cannot carry different verdicts.
      const visible = found.filter((f) => passesFilters(f, filters)).map(rowOf);
      return {
        total: found.length,
        byKindSeverity: [...tally]
          .sort(([a], [b]) => compareKeys(a, b))
          .map(([, row]) => row),
        visible,
        // Resolved against the rows just built rather than against the retained
        // key — see the field's own docblock for why the retention and the
        // publication are deliberately different things.
        selected:
          selectedKey !== null && visible.some((r) => r.key === selectedKey)
            ? selectedKey
            : null,
      };
    },
  };
}

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
import type { VerifyVerdictWire } from "../frontend/lib/analyzer-protocol.ts";

/** Which triage bands the viewport and the panel show. `candidates`/`info` are
 *  the severity bands; `unreachable` admits the flags the reachability pass
 *  DEMOTED (see {@link passesFilters} for why the test is one-sided). */
export type FlagFilters = {
  candidates: boolean;
  info: boolean;
  unreachable: boolean;
};

/** Candidates only: what is worth a stage-2 verify. `info` is context (terrain
 *  the mover simply handles) and `unreachable` is what the flood could not get
 *  to — both real findings, both noise until asked for. */
export const DEFAULT_FLAG_FILTERS: FlagFilters = {
  candidates: true,
  info: false,
  unreachable: false,
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
 */
export const flagKey = (f: FieldFlag): string =>
  `${f.kind}@${f.cell[0]},${f.cell[1]},${f.cell[2]}`;

/**
 * What one finding is DRAWN as: the stage-2 verdict if there is one, else the
 * triage band it was found in.
 *
 * An `inconclusive` verdict falls through to the band on purpose — a verify that
 * ran out of budget or found no lane proved nothing about the finding, and
 * painting it as a third state would read as an answer.
 */
export const flagTint = (
  flag: FieldFlag,
  verdict: VerifyVerdictWire | undefined,
): FlagTint => {
  if (verdict !== undefined) {
    if (verdict.outcome === "trapped") return VERIFIED_TRAPPED_TINT;
    if (verdict.outcome === "clear") return VERIFIED_CLEAR_TINT;
  }
  return flag.severity === "candidate" ? CANDIDATE_TINT : INFO_TINT;
};

/** How many findings of one (kind, severity) pair stand. A ROW rather than a
 *  keyed map entry so a reader never has to spell the pair — which matters
 *  because the chrome cannot value-import this module (it carries engine code),
 *  so a key function would be unreachable from the one consumer that needs it. */
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
  visible: FieldFlag[];
  /** Stage-2 verdicts by {@link flagKey}, for every finding that has one —
   *  including ones the filters currently hide. */
  verdicts: Map<string, VerifyVerdictWire>;
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
  /** Record what stage 2 proved about one finding. */
  setVerdict(flag: FieldFlag, verdict: VerifyVerdictWire): void;
  setFilters(filters: FlagFilters): void;
  filters(): FlagFilters;
  /** Drop every finding, pit and verdict (a world reset). Filters survive — they
   *  are a view preference, like the layer flags. */
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

  return {
    applyFlags(chunks, nextPits) {
      for (const { key, flags } of chunks) {
        byChunk.set(key, flags);
        // A verdict describes a mover walked against a field that has since
        // been re-analysed here — the finding may have moved, changed band or
        // gone. Cheaper and more honest to drop it than to guess it still holds.
        for (const [flagId, entry] of verdicts)
          if (entry.kind !== "pit" && entry.chunk === key)
            verdicts.delete(flagId);
      }
      if (nextPits === undefined) return;
      pits = nextPits;
      for (const [flagId, entry] of verdicts)
        if (entry.kind === "pit") verdicts.delete(flagId);
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
    clear() {
      byChunk.clear();
      pits = [];
      verdicts.clear();
    },
    summary() {
      const found = dedupeByKey([...byChunk.values(), pits]);
      // Keyed while counting, rows on the way out: the map is the natural tally
      // and the rows are the shape a consumer can read without knowing the key.
      const tally = new Map<string, FlagCount>();
      for (const f of found) {
        const row = tally.get(`${f.kind}/${f.severity}`);
        if (row === undefined)
          tally.set(`${f.kind}/${f.severity}`, {
            kind: f.kind,
            severity: f.severity,
            count: 1,
          });
        else row.count += 1;
      }
      return {
        total: found.length,
        byKindSeverity: [...tally]
          .sort(([a], [b]) => compareKeys(a, b))
          .map(([, row]) => row),
        visible: found.filter((f) => passesFilters(f, filters)),
        verdicts: new Map(
          [...verdicts].map(([key, entry]) => [key, entry.verdict]),
        ),
      };
    },
  };
}

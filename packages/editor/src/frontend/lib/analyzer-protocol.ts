// The analyzer worker protocol (D-F4-9): a MIRROR of the editor's field store,
// the stage-1 walkability advisor run over it as the user edits, and the
// on-demand stage-2 verify.
//
// Like the field worker, this runs ENGINE code (@furnace/core/field) directly in
// its own realm. UNLIKE it, the `verify` verb ALSO loads the project's
// /engine.js bundle: stage 2 drives the CONSUMER's shipped mover
// (`extensions.analyzerVerify`), and there is no engine-generic form of that —
// "test the code, not the data" only means anything if the code under test is
// the project's own.
//
// ADVISOR POSTURE (D-F4-1): nothing here mutates the editor's real store, no
// finding blocks a verb, and nothing is auto-fixed. The mirror is a private copy
// this worker owns; the host's buffers are COPIED across (never transferred), so
// the host keeps its own.
//
// The handler is a PURE factory over an injected `post` + `loadEngine`, so the
// whole protocol unit-tests without a real Worker (the `createFieldWorkerHandler`
// / `createWorkerHandler` shape): the worker entry wires the real
// self.postMessage and the real dynamic import; tests wire fakes.

import type {
  AgentProfile,
  AnalyzeOptions,
  ChunkKey,
  FieldFlag,
  FieldStore,
  PlacementCollisionGroup,
} from "@furnace/core/field";
import {
  analyzeChunk,
  CHUNK_SAMPLES,
  chunkKey,
  createFieldStore,
  detectPits,
  markUnreachable,
  parseChunkKey,
  voxelizePlacements,
} from "@furnace/core/field";

/** One directed lane's outcome — the wire twin of the dungeon's
 *  `VerifyLaneOutcome` (see {@link VerifyVerdictWire}). */
export type VerifyLaneOutcomeWire =
  | "clear"
  | "trap"
  | "no-lane"
  | "blocked-upstream"
  | "levitating"
  | "fell"
  | "budget";

/**
 * One flag's stage-2 verdict, as it crosses the worker boundary.
 *
 * A DELIBERATE structural twin of the dungeon's `VerifyVerdict` (and its
 * `VerifyLane` / `VerifyReason` / `VerifyOutcome`), NOT an import of it. The
 * editor is project-first: it has no dependency on any project, and the verdict
 * arrives through the runtime-built /engine.js bundle, which crosses that
 * boundary untyped. Keep the fields identical to the dungeon's; do NOT "unify"
 * them by importing — the import is what the architecture forbids, and the twin
 * is what makes the boundary honest.
 */
export type VerifyVerdictWire = {
  outcome: "trapped" | "clear" | "inconclusive";
  reason?: "budget" | "no-lanes" | "levitating";
  lanes: {
    dir: [number, number];
    outcome: VerifyLaneOutcomeWire;
    progressed: number;
  }[];
  ms: number;
};

/** The stage-2 surface the worker consumes off the engine bundle's `extensions`
 *  namespace — structural, for the {@link VerifyVerdictWire} reason. Declared
 *  here and applied ONCE, in the worker entry's `loadEngine`
 *  (`analyzer-worker.ts`). */
export type AnalyzerEngine = {
  analyzerVerify: (opts: {
    store: FieldStore;
    placements?: readonly PlacementCollisionGroup[];
    flag: FieldFlag;
    profile: AgentProfile;
    budgetMs: number;
  }) => Promise<VerifyVerdictWire>;
};

export type AnalyzerRequest =
  /**
   * Bring the mirror level with the host's store. Density buffers are COPIED
   * (structured clone), never transferred — the host keeps editing its own.
   *
   * The mirror holds EVERY allocated chunk, not a window. That costs a second
   * copy of the world's density (one 4 KiB `Int8Array` per chunk), which is
   * accepted because a window cannot be made correct: the analyzer's ceiling
   * scan is uncapped, so any chunk missing ABOVE an anchor manufactures a false
   * ceiling and silently drops every rise beyond it.
   *
   * There is no reset verb on purpose. A host switching worlds either lists the
   * old keys in `removed` or disposes the client — the worker dies with its
   * mirror. A `cellSize` that differs from the live mirror's DOES reset it: the
   * lattice is the one thing every cached byte is measured against.
   */
  | {
      kind: "sync";
      jobId: number;
      cellSize: number;
      upserts: { key: ChunkKey; density: ArrayBuffer }[];
      removed: ChunkKey[];
    }
  /** Replace the placement collider set wholesale — the props stage 1 rasterizes
   *  into extra solidity and stage 2 builds rigid bodies from, so both stages see
   *  ONE prop set. */
  | {
      kind: "placements";
      jobId: number;
      groups: readonly PlacementCollisionGroup[];
    }
  /** Re-run stage 1 over the chunks a set of edits could have changed the answer
   *  for (see {@link reanalysisKeys}), optionally followed by the two
   *  whole-world CONNECTIVITY passes: the reachability demotion over exactly
   *  those flags, and the trap hunt over the world. */
  | {
      kind: "analyze";
      jobId: number;
      profile: AgentProfile;
      /** Chunks the host has edited since the last pass. The worker WIDENS this
       *  to the set whose answer could have changed — see {@link reanalysisKeys}
       *  — so a caller lists what it wrote, never what it thinks needs redoing. */
      dirty: ChunkKey[];
      /** Run the two connectivity passes: the reachability demotion over the
       *  flags this call produced (demotes, never deletes, and only ever tags
       *  what it is handed), and `detectPits` over the whole world, whose result
       *  rides back on {@link AnalyzerResponse}'s `pits`. Both are world-cadence
       *  — drive them on an idle tail, not per edit. */
      reachability: boolean;
      /** WORLD positions the agent starts from. Empty skips the demotion pass
       *  entirely rather than demoting everything, and yields no traps rather
       *  than guessing where the agent enters the world from. */
      seeds: [number, number, number][];
    }
  /** Stage 2 for ONE flag: drive the project's real mover at it. */
  | {
      kind: "verify";
      jobId: number;
      engineUrl: string;
      flag: FieldFlag;
      profile: AgentProfile;
      budgetMs: number;
    };

export type AnalyzerResponse =
  /** Stage-1 output: a REPLACEMENT flag list per analysed chunk, empty lists
   *  included — a chunk that analysed to nothing is how the host learns to drop
   *  the flags it used to hold there. A chunk that is no longer ALLOCATED is
   *  absent rather than empty (there is nothing to analyse in uniform rock), so
   *  a host that syncs a removal clears that chunk's flags itself. */
  | {
      kind: "flags";
      jobId: number;
      chunks: { key: ChunkKey; flags: FieldFlag[] }[];
      /**
       * The world's TRAPS, as a wholesale replacement — regions the agent can
       * get into and not back out of (`detectPits`).
       *
       * Present on a `reachability: true` request and ABSENT otherwise, which is
       * the field's whole contract. A pit is a property of the world graph: one
       * dug cell can open or seal one anywhere, and a region can span chunks, so
       * it fits neither the per-chunk replacement above nor the per-chunk
       * cadence that produces it. Emitting `[]` on an incremental response would
       * therefore be a lie a host acts on — it would clear every trap on the
       * next keystroke — whereas an absent field is a host with nothing to do.
       *
       * `[]` on a whole-world response IS meaningful: no seeds, or no traps.
       */
      pits?: FieldFlag[];
    }
  | { kind: "verified"; jobId: number; verdict: VerifyVerdictWire }
  /** The answer to a `sync` / `placements`. Carries no payload — it exists so
   *  every request has exactly one response, which is what puts a FAILED mirror
   *  update in front of a waiter instead of dropping it (the client's pending
   *  map discards a response nobody asked for). */
  | { kind: "acked"; jobId: number }
  | { kind: "analyzer-error"; jobId: number; message: string };

type Post = (msg: AnalyzerResponse) => void;

/** Everything the mirror is, between messages. */
type MirrorState = {
  /** Undefined until the first `sync` — analyse/verify before that is an error,
   *  not an empty answer (an empty answer reads as "your world is clean"). */
  store: FieldStore | undefined;
  groups: readonly PlacementCollisionGroup[];
  /** Memo of `voxelizePlacements(groups, cellSize)`, invalidated by a placement
   *  swap or a lattice change. */
  extraSolid: Map<ChunkKey, Uint8Array> | undefined;
};

const errText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** The store, or a loud failure naming what the caller skipped. */
function requireStore(state: MirrorState, verb: string): FieldStore {
  const store = state.store;
  if (store === undefined)
    throw new Error(
      `analyzer worker: ${verb} before any sync — the mirror holds no field yet`,
    );
  return store;
}

/** The extra-solidity view of the placements, computed at most once per
 *  (placement set, lattice) pair. */
function analyzeOptions(state: MirrorState, store: FieldStore): AnalyzeOptions {
  state.extraSolid ??= voxelizePlacements(state.groups, store.cellSize);
  return { extraSolid: state.extraSolid };
}

/** One allocated chunk within an XZ column, with its chunk-Y already parsed, so
 *  {@link reanalysisKeys} can compare depths without re-splitting key strings. */
type ColumnMember = { key: ChunkKey; cy: number };

/** Allocated chunk keys grouped by their XZ column (`"cx,cz"`), built once per
 *  analyse. The column membership {@link reanalysisKeys} needs is a scan of the
 *  mirror's keys; doing it per dirty chunk instead would be quadratic in the
 *  world at load, when EVERY chunk is dirty. */
function columnIndex(store: FieldStore): Map<string, ColumnMember[]> {
  const out = new Map<string, ColumnMember[]>();
  for (const key of store.chunks.keys()) {
    const [cx, cy, cz] = parseChunkKey(key);
    const column = `${cx},${cz}`;
    const member: ColumnMember = { key, cy };
    const list = out.get(column);
    if (list === undefined) out.set(column, [member]);
    else list.push(member);
  }
  return out;
}

/** The XZ columns an anchor's UNBOUNDED upward reads can travel: its own, plus
 *  the 4 CARDINAL neighbours. `ceilingAbove` scans the anchor's own column with
 *  no cap, and `scanRise` then scans each cardinal neighbour column bounded by
 *  that same ceiling (`analyze.ts` `scanAnchor` → `scanRise`, over core's
 *  `DIRS`) — so both are unbounded in Y.
 *
 *  Diagonals are excluded because those two ARE the only unbounded reads and
 *  neither is diagonal; that asymmetry is the algorithm's, not an oversight.
 *  Every other neighbour probe stays within a few cells of the anchor's own Y,
 *  where the 26-neighbour halo already covers it: `pinchedAtTorso` is cardinal
 *  too (`faceDistance` steps ONE of `AXES` at a time, never both) and reads a
 *  single Y, `y + torsoCells`; `wallBeyondLip` is the one genuinely diagonal
 *  probe, but `scanRise` reaches it only on its `ry <= stepCells` branch, which
 *  caps its highest read at `y + stepCells + wallProbeUp − 1` (y + 4 at the
 *  production lattice). */
const READ_COLUMNS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * The chunks whose stage-1 answer an edit to `dirty` could have changed: each
 * dirty chunk, its 26 neighbours, and every chunk BELOW it in the columns of
 * {@link READ_COLUMNS} — intersected with what the mirror actually holds.
 *
 * The column term is not belt-and-braces. `analyzeChunk`'s upward scans are
 * UNCAPPED (a cap was a false-negative cliff, D-F4-6), so an anchor's reach is
 * bounded only by the open air above it: dig a hole in one chunk and a floor
 * anchor several chunks below can see through it for the first time. A
 * neighbour-halo rule alone would leave those columns holding stale flags —
 * measured, not argued, on the fixture committed beside this (the
 * "cardinal-column term is load-bearing" test): analysing `"1,-4,0"` before and
 * after a floor appeared inside `"0,0,0"` — FOUR chunks up, one column across —
 * goes from 0 `ledge` to 1, at cell `16,-64,8`. Re-runnable; cite that and not a
 * remembered number.
 *
 * The cardinal spread past the halo is this executor's deviation from the LETTER
 * of the D-F4-9 amendment (which named the anchor's own column only) and a
 * reading of its own rationale: `scanRise` makes the neighbour columns just as
 * unbounded as `ceilingAbove` makes the anchor's. Miss-safe in the correct
 * direction — a wider set re-analyses more, which costs time and never
 * correctness.
 *
 * Above stays excluded: a chunk higher than the dirty one reads DOWN into it
 * only at its own bottom row, i.e. only when it is already a 26-neighbour.
 */
function reanalysisKeys(
  store: FieldStore,
  dirty: readonly ChunkKey[],
): ChunkKey[] {
  if (dirty.length === 0) return []; // no edits, no index to build
  const out = new Set<ChunkKey>();
  const columns = columnIndex(store);
  for (const key of dirty) {
    const [cx, cy, cz] = parseChunkKey(key);
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          out.add(chunkKey(cx + dx, cy + dy, cz + dz));
    for (const [ox, oz] of READ_COLUMNS)
      for (const member of columns.get(`${cx + ox},${cz + oz}`) ?? [])
        if (member.cy < cy) out.add(member.key);
  }
  // Unallocated space is uniform rock and holds no air, so it can hold no
  // anchor and no flag: analysing it would post empty lists for chunks the host
  // has never heard of.
  return [...out].filter((key) => store.chunks.has(key));
}

function handleSync(
  state: MirrorState,
  msg: Extract<AnalyzerRequest, { kind: "sync" }>,
): void {
  if (!Number.isFinite(msg.cellSize) || msg.cellSize <= 0)
    throw new Error(
      `analyzer worker: sync cellSize must be a positive finite number, got ${msg.cellSize}`,
    );
  // Validate the WHOLE batch before touching the mirror, so a bad chunk half way
  // down leaves it where it was instead of partly-updated. A mirror that
  // silently lost an upsert reads those cells as unallocated rock — air that is
  // no longer there, and therefore flags that quietly stop being emitted.
  // Nothing after this point can fail, so validate-then-apply IS atomic here.
  const installs = msg.upserts.map((upsert) => {
    // A view over the request's buffer, which structured clone already made
    // private to this realm — the host still owns the one it sent. In-realm
    // callers (tests wire the handler directly) must therefore pass buffers
    // they will not go on mutating.
    const density = new Int8Array(upsert.density);
    // Nothing downstream would catch a short chunk: the store reads past it as
    // unallocated rock, so the analysis would come back plausible and quietly
    // wrong (the void-cast handler's reasoning, same class of bug).
    if (density.length !== CHUNK_SAMPLES)
      throw new Error(
        `analyzer worker: sync chunk ${upsert.key} must be ${CHUNK_SAMPLES} samples (16³), got ${density.length}`,
      );
    return [upsert.key, density] as const;
  });
  if (state.store === undefined || state.store.cellSize !== msg.cellSize) {
    state.store = createFieldStore(msg.cellSize);
    state.extraSolid = undefined; // rasterized on the old lattice
  }
  const store = state.store;
  for (const [key, density] of installs) store.chunks.set(key, density);
  for (const key of msg.removed) store.chunks.delete(key);
}

function handleAnalyze(
  state: MirrorState,
  msg: Extract<AnalyzerRequest, { kind: "analyze" }>,
  post: Post,
): void {
  const store = requireStore(state, "analyze");
  const opts = analyzeOptions(state, store);
  const flags = new Map<ChunkKey, FieldFlag[]>();
  for (const key of reanalysisKeys(store, msg.dirty))
    flags.set(key, analyzeChunk(store, key, msg.profile, opts));
  const chunks = [...flags].map(([key, list]) => ({ key, flags: list }));
  // Whole-world pass over a per-chunk slice: exactly the mixed-vintage steady
  // state `markUnreachable` documents. It tags only the flags handed to it, and
  // leaves `undefined` where it skipped (no usable seed, or a `pit`) — which is
  // the "show it" state, so a host filtering on `=== true` never hides a flag it
  // has no answer for.
  if (!msg.reachability) {
    post({ kind: "flags", jobId: msg.jobId, chunks });
    return;
  }
  markUnreachable(store, msg.profile, flags, msg.seeds, opts);
  // The trap hunt rides the SAME request, because it needs exactly what this one
  // already declares: the whole world and the agent's start points. Running it
  // here rather than as a verb of its own is what keeps "the flags you are
  // looking at" one response and one replacement (see the `pits` contract).
  post({
    kind: "flags",
    jobId: msg.jobId,
    chunks,
    pits: detectPits(store, msg.profile, msg.seeds, opts),
  });
}

async function handleVerify(
  state: MirrorState,
  msg: Extract<AnalyzerRequest, { kind: "verify" }>,
  engine: AnalyzerEngine,
  post: Post,
): Promise<void> {
  const store = requireStore(state, "verify");
  const verdict = await engine.analyzerVerify({
    store,
    placements: state.groups,
    flag: msg.flag,
    profile: msg.profile,
    budgetMs: msg.budgetMs,
  });
  post({ kind: "verified", jobId: msg.jobId, verdict });
}

/** Exhaustiveness guard for the dispatch below: a new {@link AnalyzerRequest}
 *  kind with no `case` makes this call a COMPILE error, because its argument is
 *  `never`. Same exhaustive-by-construction discipline as `field-protocol.ts`'s
 *  `errorKey`, by a different mechanism — that one leans on its declared RETURN
 *  type, this one on a `never` parameter.
 *
 *  It is a real RUNTIME guard too, and that is the half that matters here. An
 *  `if/else` chain ending in an unguarded `else` sends anything unrecognised
 *  into the LAST verb's arm — for this protocol, `placements`, which would
 *  silently clobber the collider set, drop the solidity memo, and ack success.
 *  A message this protocol does not declare (a stale host, a hand-posted one)
 *  has to be refused. */
function unrecognisedRequest(msg: never): Error {
  // Boundary cast: the worker's message port. `self.onmessage` hands over
  // whatever was posted and the entry TYPES it `AnalyzerRequest` by convention
  // alone, so `msg` is statically `never` here (every declared kind has a case)
  // while at runtime this line is reached exactly when it was not one of them.
  const kind = (msg as { kind?: unknown }).kind;
  return new Error(
    `analyzer worker: unrecognised request kind ${String(kind)}`,
  );
}

/**
 * Pure handler factory (the worker entry wires `post = self.postMessage` and the
 * real dynamic import).
 *
 * Every failure it can REPORT posts a typed `analyzer-error` carrying the jobId,
 * rather than throwing — a worker-side throw surfaces as a generic ErrorEvent
 * with no job to blame and no waiter to reject. The one failure it cannot report
 * is `post` itself throwing, which rejects the returned promise; the worker entry
 * logs that, since by definition it cannot be sent.
 *
 * `loadEngine` is memoized on first use and NEVER re-run per verify. The ES
 * module registry would dedupe a same-URL re-import on its own; what the memo
 * adds is that a DIFFERENT url can never be loaded into this worker. That is the
 * part worth protecting: the project's verify path holds ONE headless
 * `PhysicsContext` as a module singleton, and context ids are 16-bit and wrap
 * without aliasing detection, so a second module instance means a second context.
 */
export function createAnalyzerWorkerHandler(deps: {
  loadEngine: (url: string) => Promise<AnalyzerEngine>;
  post: Post;
}): (msg: AnalyzerRequest) => Promise<void> {
  const state: MirrorState = {
    store: undefined,
    groups: [],
    extraSolid: undefined,
  };
  let engine: Promise<AnalyzerEngine> | undefined;

  /** The bundle module. Memoized by presence, not by URL: the host always names
   *  "/engine.js", and a rebuild replaces the whole worker (the generation
   *  worker's rule). Only a LOAD failure drops the memo, so a later verify can
   *  retry a bundle that has since built — a verify that failed for its own
   *  reasons keeps the module it already has. */
  const resolveEngine = (url: string): Promise<AnalyzerEngine> => {
    engine ??= deps.loadEngine(url);
    return engine.catch((err: unknown) => {
      engine = undefined;
      throw err;
    });
  };

  const dispatch = async (msg: AnalyzerRequest): Promise<void> => {
    try {
      switch (msg.kind) {
        case "verify": {
          const ext = await resolveEngine(msg.engineUrl);
          await handleVerify(state, msg, ext, deps.post);
          return;
        }
        case "analyze":
          handleAnalyze(state, msg, deps.post);
          return;
        case "sync":
          handleSync(state, msg);
          break;
        case "placements":
          state.groups = msg.groups;
          state.extraSolid = undefined;
          break;
        default:
          throw unrecognisedRequest(msg);
      }
      deps.post({ kind: "acked", jobId: msg.jobId });
    } catch (err) {
      // A bad profile or extra-solidity buffer (core's setup-loud gates), a
      // malformed sync chunk, a bundle that failed to load, or a verify that
      // rejected — all arrive here as a typed, jobId-carrying error.
      deps.post({
        kind: "analyzer-error",
        jobId: msg.jobId,
        message: errText(err),
      });
    }
  };

  // Messages are processed strictly in ARRIVAL order, one at a time.
  //
  // `self.onmessage` invokes its handler per message with no regard for whether
  // the previous one has settled, and `dispatch` is async: a `verify` suspends
  // at the bundle import and again inside `analyzerVerify`, which awaits
  // `createWorld` BEFORE it reads the store. A `sync` landing in either window
  // would run `chunks.set`/`delete` on the very `FieldStore` object the
  // in-flight verify captured, and the verdict would describe a half-updated
  // mirror — not corruption (single-threaded, advisory output, no iterator
  // invalidation), but a WRONG answer in exactly the edit-while-verifying case
  // the editor is for. The field worker has no such class because it is
  // synchronous throughout.
  //
  // Serializing rather than snapshotting the store per verify is deliberate:
  // ordering is the property a host can reason about ("I synced, then I
  // analysed, so the analysis saw the sync"), and the mirror is megabytes.
  // A long verify therefore DELAYS later messages; it does not drop them, and
  // the client's own coalescer collapses whatever piles up behind it.
  let tail: Promise<void> = Promise.resolve();
  return (msg) => {
    const settled = tail.then(() => dispatch(msg));
    // The queue must outlive a handler that threw where it should not have (a
    // `post` that itself fails, say): a rejected tail makes every later `.then`
    // skip its callback, wedging the worker permanently on one bad message.
    //
    // Attaching here also MARKS that rejection handled, which silences the
    // runtime's own reporting for any caller that does not await — and the
    // production entry does not. The returned promise still carries the failure
    // (tests await it), but the SIGNAL is now `analyzer-worker.ts`'s own
    // console.error. Keeping the queue alive and keeping the failure visible are
    // two problems; this line solves the first and creates the second, so do not
    // delete that handler thinking it is decoration.
    tail = settled.catch(() => undefined);
    return settled;
  };
}

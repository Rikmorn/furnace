// The void cast — the X-ray (D-F3-15): a snapshot of every allocated chunk, one
// worker job over it, and the air that comes back meshed as a translucent cyan
// overlay. Lifted out of `createFieldHost` on `field-segment.ts`'s shape, and
// the first module to be handed a {@link HostSubstrate}.
//
// IT WENT FIRST because it is the cheapest thing that could prove the substrate
// works. The closure map (`docs/reference/field-host-clusters.md` §7.4) measured
// it at three state bindings, five functions, ZERO mutation edges in either
// direction and ZERO `FieldHost` members — so the whole cluster is deps-in,
// meshes-out: nothing outside writes its state, no facade signature moves, and
// every test that covers it drives the host's own methods. A pin going red on
// this move could therefore only mean the extraction changed behaviour.
//
// AND ITS DATA SURFACE WAS ALREADY THE SUBSTRATE'S. `store`, `worker`, `ctx()`,
// `disposed()` and the `voidCastMeshes` map `compose` still builds the draw list from
// (`field-render.ts`'s since T3d, the host's before that) are five of the sixteen
// members `substrate.ts` had declared and left unconsumed. That is what shapes
// the deps record below: ONE substrate member carrying everything shared, and
// four function refs beside it carrying what is not.
//
// THE LAW THE SPLIT IS OBEYING — stated exactly, because the next extraction
// will copy this paragraph. Nothing reassignable rides as a VALUE; it rides
// behind a CALL. WHOSE call is a separate question, decided by how many
// extracted modules read it, and the two answers both appear here:
//
//   - `ctx` and `disposed` are host `let`s with several readers, so they ride as
//     SUBSTRATE THUNKS — `deps.substrate.ctx()`, `deps.substrate.disposed()`.
//   - the void material was a host `let` too, and while it was, this module's
//     being its only extracted reader is what kept it off the record — a
//     SINGLE-CONSUMER FUNCTION DEP, `deps.voidCastMaterial()`, over the host's
//     own getter. Since 2026-08-08 (foundations T3d) the handle belongs to
//     `field-materials.ts` and the dep is a plain ref onto that module's seam.
//     The CALL and its reason are unchanged; what is gone is the substrate-bar
//     framing, because there is no longer a host `let` to decline to widen for.
//
// So "reassignable" does NOT imply "substrate member": the substrate earns a
// member at two extracted readers, not one (see {@link VoidCastDeps}), and a
// module that widened it for a dependency only it has would be paying every
// future cluster's assembly cost for its own convenience. What is universal is
// the CALL — a value copy of any of the three would be a photograph, which is
// the failure `substrate.ts`'s doc header exists to describe.
//
// The map also recorded an inbound `tool` read this cluster does not have. It
// never did: the only `tool` inside `requestVoidCast` is the word in a refusal
// message. Corrected at the row.
import * as field from "@furnace/core/field";
import * as geometry from "@furnace/core/geometry";
import type * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import type { WireBucket } from "./field-protocol.ts";
import type { HostSubstrate } from "./substrate.ts";

// Enabling the cast snapshots + meshes EVERY allocated chunk in ONE worker job,
// so its cost is linear in the whole world, not in what the camera sees. The
// ceiling makes that honest: past it the enable REFUSES loudly rather than
// queueing a job that gets slower with no upper bound. 512 chunks is 2.1 MB of
// density on the wire and, packed, a 32 m cube of field at the default 0.25 m
// cell — a region-scale tool by design; world-scale X-ray belongs to F5's
// streaming work.
//
// Measured at the ceiling (bun/JSC, 512 dug chunks, one cast): ~1.3 s of worker
// time. That is a real wait, and it buys the tool no progress state in v0 — the
// overlay simply appears. The number is recorded here rather than tuned because
// the spec set the ceiling; a gate that finds the wait unacceptable should move
// THIS constant, and browser V8 is not JSC, so re-measure there before doing so.
//
// It travels WITH the cluster rather than staying beside the host's other
// void-cast constants (`VOID_CAST_COLOR`, `VOID_CAST_ALPHA`, which are the
// materials cluster's) because `requestVoidCast` is its only reader, and one
// declaration in the module that reads it beats two spellings of 512.
const VOID_CAST_CHUNK_BUDGET = 512;

/** What the void cast needs from the rest of the host.
 *
 *  Two groups, split by READER COUNT rather than by mutability — the header's
 *  law, applied. What several extracted modules will want rides in
 *  {@link HostSubstrate}; what only this one wants rides here as a function.
 *  `HostSubstrate` earns a member at two extracted readers, not one, so widening
 *  it for a single consumer would charge every future cluster's assembly for this
 *  one's convenience.
 *
 *  Three of the four are `const` arrows in the host and the fourth is a verb off
 *  `field-materials.ts`, so every BINDING passes safely by reference; what any of
 *  them reads behind that binding is the callee's business, evaluated per call,
 *  which is exactly what keeps a `let` honest. */
export type VoidCastDeps = {
  /** The host's shared state. Five members are read: `store` (the chunk count
   *  the budget is checked against, and the cell size the job is sized in),
   *  `worker` (the request pipe), `ctx()` and `disposed()` (the two liveness
   *  guards), and `voidCastMeshes` — the map this module fills and empties and
   *  `field-render.ts`'s `compose` builds the draw list from, shared BY IDENTITY, which is
   *  the only reason the two halves can never disagree about what is on screen. */
  substrate: HostSubstrate;
  /** Report something the user should see (console + the panel subscriber).
   *  FIVE call sites, one per message: the staleness drop (`invalidateVoidCast`),
   *  `requestVoidCast`'s three loud refusals (in flight / nothing dug / over
   *  budget), and the failure report in its `.catch`. The fourth refusal — no
   *  context — is deliberately NOT here; see its guard for why that one is
   *  silent. */
  reportToolError(msg: string): void;
  /** Every allocated chunk's density as a COPY, keyed as the store keys it. The
   *  host's, not this module's: the analyzer mirror copies chunks the same way
   *  and through the same helper, so the two share one declaration. */
  snapshotAllChunks(): { key: string; density: ArrayBuffer }[];
  /** The world-space origin of chunk (cx, cy, cz), in metres. */
  chunkOrigin(cx: number, cy: number, cz: number): Float32Array;
  /** The ONE translucent void material every cast mesh is drawn with. A call
   *  because it is `field-materials.ts`'s getter over a handle that `init` builds
   *  and `dispose` nulls — it throws before the first `init`, which is
   *  unreachable from here (every path is behind a context guard). */
  voidCastMaterial(): material.Material;
};

/** The X-ray layer's three verbs and the one fact the host still reads off it.
 *
 *  No state is exposed. The meshes live in the substrate because
 *  `field-render.ts`'s `compose` lists them, and the two generations are
 *  private because nothing outside ever
 *  had a use for either — the map's whole outbound surface was `voidCastJobGen`
 *  read by `tick`, which {@link VoidCast.jobGen} is.
 *
 *  It was FIVE verbs until foundations T3b2: `destroy` and `apply` were lifted
 *  onto the seam with the rest of the cluster and never acquired a caller
 *  outside this module, so they came back off it. Both internals are unchanged
 *  and still run — `destroy` under `discard`, `apply` under `request`'s
 *  resolution — which is the whole difference between trimming a seam and
 *  deleting behaviour. */
export type VoidCast = {
  /** Free the cast AND strand whatever job is in flight for it. Silent. */
  discard(): void;
  /** Age the cast out because the field changed, and SAY so. */
  invalidate(): void;
  /** Cast the void of the CURRENT field: one worker job over a snapshot of every
   *  allocated chunk. Four refusals; see the body for the order. */
  request(): void;
  /** The generation of the job the WORKER is still computing, or `null` when it
   *  is idle. The host's per-frame `FieldStats.voidCastPending` is this `!==
   *  null` — a BOOLEAN on the wire, but the generation is what the module needs
   *  internally, so the seam publishes the fact rather than a second derivation
   *  of it. */
  jobGen(): number | null;
};

/** Build the void cast over one host's dependencies. One per host; it holds the
 *  layer's meshes (in the substrate) and its two generations for that host's
 *  lifetime. */
export function createVoidCast(deps: VoidCastDeps): VoidCast {
  // Generation guard (the stampGen pattern): bumped by every discard, so a job
  // whose field moved under it — or whose layer was switched off — lands stale
  // and is dropped instead of showing an X-ray of a world that no longer is.
  let voidCastGen = 0;
  // The generation of the job the WORKER is still computing (null = none). One
  // piece of state answering both questions, so they can never disagree: the
  // worker is busy while it is non-null, and the user is still waiting for THIS
  // cast while it equals `voidCastGen` — a discard bumps the generation, which
  // is exactly what makes a stranded job stop counting as awaited without
  // pretending the worker stopped working on it.
  let voidCastJobGen: number | null = null;

  const destroyVoidCast = (): void => {
    const c = deps.substrate.ctx();
    if (c)
      for (const entries of deps.substrate.voidCastMeshes.values())
        for (const e of entries) {
          mesh.destroy(c, e.m);
          geometry.destroy(c, e.g);
        }
    deps.substrate.voidCastMeshes.clear();
  };

  // Free the cast and strand whatever job is in flight for it. SILENT: the
  // callers that owe the user an explanation give one themselves. The bumped
  // generation is the whole strand — `voidCastJobGen` is deliberately NOT
  // cleared, because nothing here reaches the worker, which goes on computing a
  // result that will now be dropped on arrival.
  const discardVoidCast = (): void => {
    voidCastGen++;
    destroyVoidCast();
  };

  // Any field mutation ages the cast out: it was meshed from a snapshot, and
  // re-casting per stroke would mean a whole-world worker job per stroke. So the
  // v0 drops it and SAYS so — a silently vanishing X-ray beside a still-ticked
  // checkbox would read as a bug. Self-limiting: the second mutation finds
  // nothing live and returns, so a drag cannot spam the report channel.
  const invalidateVoidCast = (): void => {
    const awaited = voidCastJobGen === voidCastGen;
    if (!awaited && deps.substrate.voidCastMeshes.size === 0) return;
    discardVoidCast();
    deps.reportToolError(
      "void cast cleared — the field changed; re-toggle the void layer to refresh it",
    );
  };

  // Build the cast's render state from a void-cast response: one mesh per
  // non-empty bucket, ALL under the one void material, at chunk origins. The
  // applyStampGhost twin, deliberately not folded into it — see the material's
  // comment for why the two differ in depth state, and the invisible-overlay
  // learning (2026-07-21) for why working render code is not refactored without
  // a visual gate.
  const applyVoidCast = (
    chunks: { key: string; buckets: WireBucket[] }[],
  ): void => {
    const c = deps.substrate.ctx();
    if (!c) return;
    destroyVoidCast();
    for (const { key, buckets } of chunks) {
      const [cx, cy, cz] = field.parseChunkKey(key);
      const origin = deps.chunkOrigin(cx, cy, cz);
      const entries: { m: mesh.Mesh; g: geometry.Geometry }[] = [];
      for (const bucket of buckets) {
        const indices = new Uint32Array(bucket.indices);
        if (indices.length === 0) continue;
        const g = geometry.create(c, {
          positions: new Float32Array(bucket.positions),
          normals: new Float32Array(bucket.normals),
          uvs: new Float32Array(bucket.uvs),
          indices,
        });
        const m = mesh.create(c, {
          geometry: g,
          material: deps.voidCastMaterial(),
        });
        mesh.setPosition(c, m, origin);
        entries.push({ m, g });
      }
      if (entries.length > 0) deps.substrate.voidCastMeshes.set(key, entries);
    }
  };

  // Cast the void of the CURRENT field: one worker job over a snapshot of every
  // allocated chunk. Four refusals, in the order a user experiences them.
  //
  // The in-flight one is a cost guard, and it is keyed on the WORKER being busy
  // rather than on the user still wanting the result: the client is a plain
  // request pipe over ONE worker whose handler is synchronous per message, so a
  // second cast posted now delays every chunk remesh and every stamp preview
  // behind a second full sweep of the world — and a discard cannot call it off,
  // only agree to ignore it. Toggling off and on again is therefore NOT free,
  // and it is the sequence that would otherwise stack them.
  //
  // The same synchronous handler is why this job gets D-F4.5-19's PROGRESS and not
  // its "cooperative cancel" — "the job polls; no cancel theater", and there is
  // nothing here that can poll. The per-chunk loop lives in the worker
  // (`field-protocol.ts`'s handleVoidCast), whose handler runs to completion per
  // message: a cancel `postMessage` sent mid-job is not delivered, it QUEUES behind
  // the very work it means to stop. The only real interrupt is `worker.terminate()`,
  // which would take every chunk remesh and every stamp preview down with it. What
  // exists instead is strand-not-cancel (`discardVoidCast`), and the honest chrome
  // for that is the readout `voidCastPending` feeds, with no ✕ on it.
  //
  // Re-check if the worker ever gains a mid-handler yield, or the client a second
  // worker the cast could own alone.
  //
  // Determinate progress IS available and is deliberately declined: the worker can
  // `post` mid-handler (posting does not block) and the total is `store.chunks.size`.
  // It would cost a new worker→host message and its plumbing to put a percentage on
  // a job whose CEILING is ~1.3 s (see VOID_CAST_CHUNK_BUDGET). Indeterminate is
  // honest at that length.
  const requestVoidCast = (): void => {
    if (voidCastJobGen !== null) {
      deps.reportToolError(
        "a void cast is still building — re-tick the void layer once it lands",
      );
      return;
    }
    discardVoidCast(); // an enable while a settled cast stands replaces it
    const count = deps.substrate.store.chunks.size;
    if (count === 0) {
      // Loud, by this feature's own rule (see invalidateVoidCast): a ticked box
      // with nothing behind it reads as a bug. There is no air to cast in a
      // world nothing has been dug out of yet.
      deps.reportToolError("nothing to cast yet — dig something first");
      return;
    }
    if (count > VOID_CAST_CHUNK_BUDGET) {
      deps.reportToolError(
        `void cast covers ${count} chunks, over the ${VOID_CAST_CHUNK_BUDGET}-chunk budget — the X-ray is a region-scale tool, not a world-scale one`,
      );
      return;
    }
    // Quiet: layer flags survive a dispose, so a call that lands while there is no
    // context must not fire a job it has nowhere to put. Nobody has to re-toggle to
    // get it back — `init` re-requests the cast the flag still asks for.
    if (!deps.substrate.ctx()) return;
    // Snapshot BEFORE the latch, not as an argument after it: a throw while
    // building it (a detached store buffer — not reachable today, since nothing
    // transfers the store's own chunks) would otherwise leave the latch set with
    // no job to clear it, and every later cast refused forever.
    const snapshot = deps.snapshotAllChunks();
    const gen = voidCastGen;
    voidCastJobGen = gen;
    deps.substrate.worker
      .voidCast(snapshot, deps.substrate.store.cellSize)
      .then((res) => {
        // Cleared BEFORE the staleness guard: the worker is free either way,
        // and a stranded job that left this set would refuse every later cast.
        voidCastJobGen = null;
        if (deps.substrate.disposed() || gen !== voidCastGen) return;
        applyVoidCast(res.chunks);
      })
      // .catch, not then's second argument: applyVoidCast above can throw (a
      // context torn down mid-flight, a lost device), and a two-argument then
      // would route that into an unhandled rejection instead of into this
      // handler — leaving the job latch stuck, which refuses every later cast.
      .catch((err: unknown) => {
        voidCastJobGen = null;
        if (deps.substrate.disposed() || gen !== voidCastGen) return;
        // The remeshOne posture, one level louder: a cast the user asked for
        // and will not get is a tool problem, not a background hiccup.
        const message = err instanceof Error ? err.message : String(err);
        deps.reportToolError(`void cast failed: ${message}`);
      });
  };

  return {
    discard: discardVoidCast,
    invalidate: invalidateVoidCast,
    request: requestVoidCast,
    jobGen: () => voidCastJobGen,
  };
}

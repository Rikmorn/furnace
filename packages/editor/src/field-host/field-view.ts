// The VIEW state — the eight layer flags and the slice plane — and the two
// facade verbs that move them. The SIXTH cluster lifted out of
// `createFieldHost`, after `field-segment.ts`, `field-voidcast.ts`,
// `field-props.ts`, `field-stats.ts` and `field-history-feed.ts`, and the last
// of T3b1's five.
//
// WHAT MAKES IT DIFFERENT from the five before it is that the cost runs the
// OTHER WAY. Each of those was sized by what it TAKES: `voidcast` needed five
// substrate members and four host functions, `props` four and three, `stats`
// seven reads across two clusters. This one takes almost nothing — two substrate
// members and two verbs — and it is still the most invasive move in the tranche,
// because of what it SUPPLIES. TWENTY-SIX reads at TWENTY-FIVE sites, spread
// over SIX other clusters — `render` 14, `targeting` 6, `picking` 3, and one
// each in `lifecycle`, `world` and `tool` — reach the two `let`s that live here
// (or the helper over one of them), and every one had to become a call. The two
// counts differ by exactly one: `cursorRay` reads the plane TWICE in a single
// expression, so 24 sites became a call one-for-one and the 25th collapsed its
// two reads into one forced local (see below). So the extraction
// is a THREADING pass through `renderScene`, not a deps record; the module below
// is 5 members over 2 bindings, and the diff it cost is spread over ~26 lines of
// somebody else's code.
//
// That asymmetry is worth naming because it inverts the usual extraction
// question. "What does this cluster depend on?" is the cheap question here and
// answers in one line. The expensive question is "what depends on it?", and a
// cluster map's inbound column is the one a reader is least likely to read as a
// cost.
//
// AND THE MAP NEVER SHOWED THE EDGE THAT ORDERS THIS FILE. §6's `view` row lists
// exactly one outbound mutation, `world.dirty` from `ret.setSlice`. But
// `ret.setLayers` has ALWAYS called `discardVoidCast()` / `requestVoidCast()` —
// the X-ray's on/off edge — and those are CALLS, so §2.1's second correction
// swallowed them: the map's edges are over data bindings, and a cross-cluster
// call is not one. Here that omission has teeth the earlier instances did not,
// because it is an ORDERING constraint: `createView` cannot be assembled before
// `createVoidCast`, and nothing in the map says so. Declaring the two verbs as
// constructor deps below is what turns a silent agreement into something the
// compiler checks — which is the reason `view` went LAST rather than first. Had
// it gone first, the edge would have had to be discovered by a failing build in
// the middle of a 26-site threading pass.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument):
//
//   - `store` and `dirty` are `const` in the host and were ALREADY declared in
//     `HostSubstrate`, so they ride BY VALUE inside the record. `setSlice` reads
//     the one as a container (`store.chunks.keys()`) and adds to the other; both
//     are mutated THROUGH the identity the host handed over and never replaced,
//     which is why a held reference cannot fork.
//   - `layers` and `sliceY` were the host `let`s, and they did NOT become
//     substrate members despite having five reader clusters between them — they
//     moved IN. The substrate carries state the HOST still owns and shares; state
//     with an owner rides on that owner's seam instead, which is why the reads
//     left behind spell `viewState.layers()` rather than `substrate.layers()`.
//     Same CALL either way, and the call is the part that matters: a value copy
//     of either would be the photograph `substrate.ts` exists to describe.
//   - So this module ADDS nothing to the substrate and REMOVES two `let`s from
//     the closure. It is the first extraction in the tranche of which the second
//     half is true: the four before it left their `let`s where they were or took
//     private thunks over them, because none of them owned host state that
//     someone else read.
//
// PER-READ CALL, NOT A HOISTED SNAPSHOT — the same choice `field-props.ts` and
// `field-stats.ts` made, restated because this is where it is most tempting.
// `renderScene` has FOURTEEN `layers` read SITES, and one
// `const l = viewState.layers()` at the top of it would be observationally
// identical (one synchronous body, no reassignment in between). It is still not
// what the threading did: the substrate's whole point is that a `let` is read
// where it is used, a hoist is a snapshot that merely happens to be small, and a
// tranche that spells the rule two ways teaches neither.
//
// The cost is **12 + 2 × chunkCount** arrow calls per frame, NOT fourteen: two
// of the sites (`field`, `kit`) sit inside `for (const cm of
// chunkMeshes.values())`. That is unchanged from before the move — the closure
// read the property per chunk in the same loop — so this is the price of the
// call, not of the extraction, and it is the one site where a hoist would buy
// something that scales. It is still declined, for the reason above; if a
// profile ever says otherwise, the honest fix is to hoist THAT loop's two reads
// with a comment saying why, not to hoist the frame.
//
// ONE PLACE THE COMPILER FORCED A LOCAL and it is worth knowing why, because
// nothing about it is a style choice. `cursorRay`'s `eyeInRock` reads `sliceY`
// TWICE in one expression — a null check, then a compare — and TypeScript's
// narrowing does not survive a call boundary: `viewState.sliceY() === null || … <
// viewState.sliceY()` leaves the second read `number | null` and does not
// compile. So that site alone binds `const sliceY = viewState.sliceY()` first and
// keeps the expression verbatim. Two reads of one `let` inside one synchronous
// expression cannot observe a write between them, so the local says exactly what
// the closure said.
//
// AND THE HOST BINDING IS `viewState`, NOT `view`. `renderScene`,
// `renderGhostLines` and `renderCursorAffordance` all take a parameter named
// `view` — a `camera.Camera` — so a closure-level `view` would be shadowed inside
// the very function that reads this module fourteen times, and `view.layers()`
// would be a type error there. The compiler proves the collision rather than the
// reader having to spot it; the binding is named for the state it holds.
import type { FieldLayers } from "./field-host.ts";
import type { HostSubstrate } from "./substrate.ts";

/** What the view state needs from the rest of the host.
 *
 *  THREE members, and the two beside the substrate are the edge no cluster map
 *  showed — see the module header. They are the void cast's own `discard` and
 *  `request`, named here rather than reached through a `VoidCast` value because
 *  what this module has is a right to two verbs, not a relationship with that
 *  cluster: {@link View.setLayers} is the whole of the coupling, and a record
 *  that named the module would invite the other four.
 *
 *  Both are `const` arrows (`field-voidcast.ts` returns them on its seam), so the
 *  BINDINGS pass safely by reference; what they read behind those bindings is
 *  evaluated per call. */
export type ViewDeps = {
  /** The host's shared state. TWO members are read, both on the value side and
   *  both by {@link View.setSlice} alone: `store` (for `chunks`, the keys a new
   *  clip plane re-marks) and `dirty` (the set it marks them into). The layer
   *  flags read nothing at all. */
  substrate: HostSubstrate;
  /** Free the X-ray and strand whatever job is in flight for it — silent.
   *  `field-voidcast.ts`'s `discard`. Called on every `setLayers` that leaves
   *  `voidCast` false, including the ones that found it false already: that is
   *  what makes the off state a plain free rather than an edge to track. */
  discardVoidCast(): void;
  /** Cast the void of the CURRENT field. `field-voidcast.ts`'s `request`, which
   *  owns all four refusals — so this module decides only WHEN to ask, on the
   *  false→true edge, and never whether the answer is affordable. */
  requestVoidCast(): void;
};

/** The three facts the rest of the host reads off the view state, and the two
 *  verbs the facade delegates to.
 *
 *  Every getter is a CALL because both bindings behind them are reassigned here
 *  ({@link View.setLayers} replaces the flags wholesale, {@link View.setSlice}
 *  the plane). Nothing is exposed as state: unlike the first three extractions
 *  this cluster left nothing in the substrate, and unlike the two after it, it
 *  took host state WITH it — which is why its seam is three getters rather than
 *  none. */
export type View = {
  /** Per-layer render visibility. READONLY, and that is the read half of the
   *  copy rule {@link View.setLayers} keeps at the write half: the setter takes a
   *  copy so host state never aliases a panel's object, and a getter handing the
   *  same object back mutable would give that copy away again. SEVENTEEN of the
   *  host's twenty-five read sites go through here: fourteen in `renderScene`,
   *  two in `pickCandidates`, one in `ret.init`. */
  layers(): Readonly<FieldLayers>;
  /** The slice-view clip plane in world metres, or `null` when it is off.
   *  DISPLAY + targeting only — never read by `logApply`, the oplog, or
   *  `bakeFieldWorld`. */
  sliceY(): number | null;
  /** The plane as a raycast option, or `undefined` when there is no plane: the
   *  spelling every cursor-driven field raycast passes (six sites). A fresh
   *  object per call, as the closure's arrow was — the callees hold it for the
   *  length of one raycast. */
  sliceOpts(): { maxY: number } | undefined;
  /** The seam behind `FieldHost.setLayers`. Copies, then acts on the `voidCast`
   *  edge; see the implementation for why only that one flag has an effect. */
  setLayers(next: FieldLayers): void;
  /** The seam behind `FieldHost.setSlice`. Value-guarded, then re-marks every
   *  allocated chunk for a remesh through the new clip. */
  setSlice(y: number | null): void;
};

/** Build the view state over one host's dependencies. One per host; it holds
 *  that host's layer flags and slice plane for the host's lifetime — both
 *  survive a world load and a dispose/re-init, which is the property `ret.init`'s
 *  cast re-request exists to reconcile. */
export function createView(deps: ViewDeps): View {
  let layers: FieldLayers = {
    field: true,
    kit: true,
    props: true,
    ghost: true,
    selection: true,
    grid: true,
    flags: true,
    voidCast: false, // an X-ray costs a whole-world remesh — opt in
  };
  // Slice-view clip plane (world metres; null = off). Display + targeting
  // only — never read by logApply, the oplog, or bakeFieldWorld.
  let sliceY: number | null = null;

  return {
    layers: () => layers,
    sliceY: () => sliceY,
    // Slice-coherence (F2b Task 15 disposition): EVERY cursor-driven field
    // raycast passes the slice clip, not just computeTarget — an eyedrop, a
    // box-select corner, or a flood seed under an active slice must land on the
    // sliced surface the user SEES, never on rock the display hides (what you
    // see is what you target). The host's six call sites share this helper:
    // `computeTarget`, `eyedropper`, `selectionPoint`, `materialSeedVoxel`,
    // `voidSeedVoxel` and `pointerPick`. (The comment it travelled from said
    // "the four gesture sites below" — a count that had gone stale in place.)
    sliceOpts: () => (sliceY === null ? undefined : { maxY: sliceY }),
    setLayers: (next) => {
      const wasVoidCast = layers.voidCast;
      layers = { ...next }; // copy — host state never aliases panel objects
      // The one layer with an edge effect: nothing to show unless a cast was
      // built for the field as it stands (see FieldLayers). Off is a plain
      // silent free; a call that leaves it true rebuilds nothing, which is what
      // makes "re-toggle to refresh" the documented way back after an edit.
      if (!layers.voidCast) deps.discardVoidCast();
      else if (!wasVoidCast) deps.requestVoidCast();
    },
    setSlice: (y) => {
      if (y === sliceY) return; // slider-drag repeats of the same value are free
      sliceY = y;
      // Re-mesh EVERYTHING through the new clip. Plain adds, not
      // markDirtyWithNeighbors: every allocated chunk is being re-marked
      // anyway, so each chunk's 26-neighbourhood is in the set by
      // construction. The throttled drain (REMESH_PER_FRAME) paces the burst.
      for (const key of deps.substrate.store.chunks.keys())
        deps.substrate.dirty.add(key);
    },
  };
}

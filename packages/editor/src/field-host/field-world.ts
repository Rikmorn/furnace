// THE WORLD: the field session's own half of `createFieldHost` — the dirty set
// and its paced remesh drain, the per-chunk GPU render state, the chunk-box and
// ceiling arithmetic every framing verb asks for, the density snapshots the void
// cast and the analyzer mirror copy, and the three verbs that REPLACE a world
// (reset, load, new) plus the one that saves it. The TWENTY-FIRST and LAST
// cluster lifted out of that closure (foundations T3d Task 6), and the one the
// plan scheduled last on purpose.
//
// WHY LAST, and it is not the usual fan-in reason. Every one of this cluster's
// twelve outbound mutation edges (`field-host-clusters.md` §5.3) targets state
// that had to leave FIRST: nine into the advisor, two into the selection, one
// into the drift report. Extracting `world` before them would have meant a
// module reaching back into the closure for nine `let`s; extracting it after
// means the whole fan-out is already CALLS — `advisor.retireWorld()`,
// `advisor.noteWorldLoaded()`, `selection.retireWorld()`, `drift.set/notify` —
// and this file inherits them as deps without a single new seam being invented
// for its benefit. The five tasks before it did the negotiating.
//
// WHAT COULD NOT COME, and it is the most important sentence in this header.
// The row is 8 state bindings and FIVE of them stay in `field-host.ts`:
// `store`, `log`, `dirty`, `worker` and `chunkMeshes` are `HostSubstrate` VALUE
// members, declared at T3a and handed to every extracted module since. They are
// not this cluster's private state in any sense a boundary could enforce — they
// are the host's SHARED state, this cluster is merely their busiest writer, and
// the closure is the only place their backing can live while the substrate hands
// out their identity. So this module reads all five back through
// {@link WorldDeps.substrate}, exactly as its eleven siblings do. What actually
// travelled is the three `let`s nothing else backs (`lastRemeshMs`,
// `remeshVersion`, `worldEpoch`) and all fourteen functions.
//
// THAT IS NOT A FAILED EXTRACTION AND THE DISTINCTION IS WORTH DRAWING ONCE,
// because it is the shape the closure's final accounting rests on: a substrate
// value member does not belong to the cluster that writes it most. `flagStore`
// (T3d Task 2) and `litByClass` (Task 3) made the same journey one binding at a
// time and each stayed for the same reason; this row makes it five at once, and
// with them the substrate's backing is now the ONLY data left in the closure
// besides the four bindings the three declared facade-resident rows own.
//
// `worldEpoch` CAME, AND ITS HOIST WAS UNDONE BY DELETION. The counter sat in
// `field-host.ts` directly above the `createAnalyzer` assembly with a
// migration marker on it saying the hoist was a readability
// preference that this task should expect to reverse. It did not need reversing:
// the binding LEFT, so there is nothing left to hoist. Both extracted readers
// (`field-analyzer.ts`'s verify guard, `field-entities.ts`' footprint signature)
// now take `() => world.epoch()`, and those two arrows are what open the cycle
// the marker warned about — `reset()` calls `advisor.retireWorld()` while the
// advisor reads this counter back, which is legal in exactly one direction:
// `createWorld` is assembled BELOW `createAnalyzer`, so the advisor's dep is the
// lazy side. The substrate was never widened for it, which is the OTHER thing
// both markers asked: `field-analyzer.ts`' bar note had it qualifying on reader
// count and refusing on ownership, and this is the owner it was waiting for.
//
// THE ASSEMBLY IS THE LOWEST IN THE FILE, and the position is decided by an
// arrow COUNT rather than by a constraint. Every one of this record's
// twenty-three deps names a module declared above it, so not one of them is a
// forward arrow. The mirror image was available — assembling `createWorld` up
// where `markDirtyWithNeighbors` was would have let its five consumers take
// plain refs — and it costs ~20 arrows against the 6 this direction costs
// (`field-tool.ts` 1, `field-voidcast.ts` 2, `field-analyzer.ts` 1,
// `field-machine.ts` 3, `field-camera-rig.ts` 2 — 9 dep SITES, 6 of which were
// plain refs that became one-line arrows). §2.10's `currentSelectionSpec` fork
// is the same arithmetic one task earlier: one arrow there against four here.
//
// THE SEAM IS 18 VERBS OVER A 14-FUNCTION ROW, and the surplus is not inbound
// reads (`field-materials.ts`' third mechanism) but the FACADE: three of the
// five `FieldHost` members this cluster owns had bodies rather than delegates,
// and `newWorld`/`loadWorld`/`exportArtifact` came with the functions they
// drive. Five of the fourteen functions are PRIVATE — `buildKit`,
// `destroyChunkRender`, `applyMesh`, `remeshOne`, `compactLoadedLog` — and
// `destroyChunkRender` is Task 4's rule: it had TWO callers outside this cluster
// (`ret.dispose` and `ret.setMaterialTable`), both wanting the same
// two-statement group, so they became one verb —
// {@link World.discardChunkRenders} — and the function itself never crosses the
// boundary.
//
// **`resetWorld` is NOT one of them and does not use that verb**, which is worth
// stating because the obvious reading of "three callers, one verb" is a
// de-duplication that did not happen. It is INSIDE this cluster (one of the
// fourteen functions that travelled), and it still spells the group inline
// because it must `chunkMeshes.clear()` even when there is NO context to free the
// renders with — a world swap on a host that never initialized still has to empty
// the map, and the verb takes a `Context`. A first draft of this header claimed
// all three collapsed; `chunkSetBox`'s own docblock below records a past review
// catching the identical shape of claim about that function, which is why this
// one is spelled out rather than trimmed.
//
// TWO VERBS EXIST ONLY BECAUSE A WRITER COULD NOT FOLLOW ITS TARGET, and they
// are the register's last four cluster-to-cluster edges paid off:
// {@link World.discardChunkRenders} and {@link World.redirtyAll} are what
// `ret.init`, `ret.dispose` and `ret.setMaterialTable` call instead of touching
// `chunkMeshes` and `dirty` directly. That takes §5.7's in-closure residual to
// ZERO — the tally §5.7 predicted two tasks running, since `world` was the
// TARGET of all four.
//
// NO UNIT TEST, by the house pattern twelve extractions old — the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED are this module's contract, and this cluster is
// the most broadly driven of all of them, because `loadWorld` is the only
// headless route to a committed entity: every GPU suite that needs a fixture
// installs it through this file.
import * as field from "@furnace/core/field";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import type { WireBucket } from "./field-protocol.ts";
import type { ChunkRender, HostSubstrate } from "./substrate.ts";

type Vec3T = [number, number, number];
type Box = { min: Vec3T; max: Vec3T };

const REMESH_PER_FRAME = 2; // dirty-set drain budget per rAF

// Load-time compaction fires only when the loaded log carries MORE than this
// many foldable ops (spec D-F3-16). Named, not inlined: the meter's
// `compactable N` reads against the SAME logStats ceiling, so a user watches
// the number climb toward the point where the next load will fold it.
const COMPACT_THRESHOLD_OPS = 200;

/** A saved world as {@link World.load} takes it: manifest + chunk bytes +
 *  material siblings + raw oplog text. Structurally identical to
 *  `FieldHost.loadWorld`'s parameter, and deliberately NOT shared with it — that
 *  type block is the facade's public contract and states its own shape. A name
 *  is not part of a structural type's identity (`field-camera-rig.ts`'s `Box`
 *  note makes the same argument on count). */
type WorldFiles = {
  manifest: field.FieldManifest;
  chunks: { key: string; bytes: Uint8Array }[];
  materials?: { key: string; bytes: Uint8Array }[];
  oplog: string | null;
};

/** What the world needs from the rest of the host.
 *
 *  TWENTY-THREE members and NOT ONE forward arrow — the widest record in the
 *  tranche after `field-render.ts`' twenty-nine, and the opposite kind of width.
 *  `render`'s is fan-IN: every entry a read, describing what a frame is.
 *  This one is fan-OUT: seventeen of the twenty-two non-substrate members are
 *  VERBS this module calls on someone else, because replacing a world is an act
 *  that every other cluster has to hear about. §5.6's "zero mutations is what
 *  makes a 29-member deps record safe" does not apply here and the inverse is
 *  the honest reading: this record is wide *because* the cluster mutates across
 *  twelve edges, and every one of those edges is named here rather than reached
 *  for.
 *
 *  All twenty-three are plain refs onto seams declared above the assembly except
 *  four one-line arrows, and each of those four narrows rather than adapts:
 *  three CLEAR a slot whose setter is wider than this cluster's use of it
 *  (`clearBoxAnchor`, `clearSegmentAnchor`, `clearPendingStamp` — the last would
 *  otherwise have made this file import `PendingStamp` to name a parameter it
 *  only ever passes `null`), and `cameraYaw` takes one field off a pose. */
export type WorldDeps = {
  /** The host's shared state. This module is its busiest consumer and reads
   *  SEVEN members: `store`, `log`, `dirty`, `worker` and `chunkMeshes` — the
   *  five value members this cluster owns on paper and cannot take with it (see
   *  the header) — plus `table()` and the `ctx()`/`disposed()` pair every
   *  GPU-touching and async path guards on. */
  substrate: HostSubstrate;
  /** The lit material for one mesher bucket (per class, surface or kit backing).
   *  `field-materials.ts`'. */
  bucketMat(classId: number, backing: boolean): material.Material;
  /** The instanced kit material. `field-materials.ts`'. */
  kitInstancedMat(): material.Material;
  /** The active slice ceiling, or `null`. `field-view.ts`', and the remesh
   *  passes it to the worker so a sliced view meshes the slab it shows. */
  sliceY(): number | null;
  /** Tell the X-ray its snapshot is stale. `field-voidcast.ts`', called from THE
   *  density choke point. */
  invalidateVoidCast(): void;
  /** Drop the X-ray outright. `field-voidcast.ts`', called by the world swap —
   *  silently, unlike the invalidation, because everything else on screen is
   *  being replaced too. */
  discardVoidCast(): void;
  /** Copy a density change across to the advisor's mirror. `field-analyzer.ts`',
   *  and the one verb the choke point below calls per edit. */
  noteDensityWritten(changed: ReadonlySet<string>): void;
  /** The whole of what a world swap means to an advisor — stale keys, dirty set,
   *  re-sync, seeds, findings, publish. `field-analyzer.ts`', and it shares its
   *  name with {@link retireSelection} on purpose: two clusters, one act. */
  retireAdvisorWorld(): void;
  /** The agent's start seed plus the two staleness flags, as one act.
   *  `field-analyzer.ts`'. */
  noteWorldLoaded(seed: Vec3T): void;
  /** Ask the advisor to run a pass. `field-analyzer.ts`', kept separate from the
   *  two above because a load's request must not depend on the prop layer
   *  happening to rebuild on the same path. */
  requestAnalyzerPass(): void;
  /** Rebuild the committed prop layer from the log. `field-props.ts`'. */
  rebuildProps(): void;
  /** The tool-error channel — the optional-chrome failure stance's surface.
   *  `field-tool.ts`', and this module's only use of it is a skipped
   *  compaction. */
  reportToolError(msg: string): void;
  /** Drop the box-select anchor. `field-selection.ts`', narrowed to the clear. */
  clearBoxAnchor(): void;
  /** The whole of what a world swap means to the selection — both slots, the Esc
   *  stack, both display halves, the push. `field-selection.ts`'. */
  retireSelection(): void;
  /** Drop the segment anchor. `field-segment.ts`', narrowed to the clear. */
  clearSegmentAnchor(): void;
  /** Disarm the pending stamp. `field-machine.ts`', narrowed to the clear. */
  clearPendingStamp(): void;
  /** End any live stamp/reconfigure session. `field-machine.ts`'. */
  cancelSession(): void;
  /** Select one entity, or nothing. `field-entities.ts`', called with `null` by
   *  the world swap. */
  selectEntity(entityId: number | null): void;
  /** The entity-list tick. `field-entities.ts`'. */
  notifyEntities(): void;
  /** Park a drift report, or clear it. `field-drift.ts`'. */
  setDrift(next: field.DriftFinding[] | null): void;
  /** Publish the drift seam. `field-drift.ts`', always immediately after
   *  {@link setDrift} — the file's established two-call spelling for that act,
   *  which `stepHistory` and `dismissDrift` also use. */
  notifyDrift(): void;
  /** The camera's world-space eye. `field-camera-rig.ts`', baked into a saved
   *  world as the runtime spawn. */
  cameraEye(): Vec3T;
  /** The camera's yaw. `field-camera-rig.ts`', narrowed off the pose for the
   *  same reason and at the same site. */
  cameraYaw(): number;
};

/** The world cluster's seam: the dirty set's choke point and drain, the chunk
 *  render state, the box arithmetic, the density snapshots, and the four verbs
 *  that replace or save a world. */
export type World = {
  /** THE density-mutation choke point (strokes, stamp commits, ⌘Z/⇧⌘Z,
   *  reconfigure apply, entity delete/duplicate). Dirties every changed chunk
   *  AND its 26 allocated neighbours — the watertight-seam rule — and is where
   *  the void cast learns its snapshot went stale and the advisor learns what to
   *  copy across. An EMPTY set is not a field change and returns early; a pure
   *  scatter writes no cells, and announcing one would tear down a cast that
   *  could not have staled. */
  markDirtyWithNeighbors(changed: Set<string>): void;
  /** One chunk's world-space origin. */
  chunkOrigin(cx: number, cy: number, cz: number): Float32Array;
  /** Drain up to {@link REMESH_PER_FRAME} dirty chunks through the worker. The
   *  budget is what keeps an init burst from stalling the first frames. */
  drainDirty(): void;
  /** Free every chunk render and empty the map. What `ret.dispose` and
   *  `ret.setMaterialTable` call instead of reaching into `chunkMeshes` — the
   *  two-statement group both of them spelled out, named once. */
  discardChunkRenders(c: Context): void;
  /** Mark every ALLOCATED chunk dirty. What `ret.init` and
   *  `ret.setMaterialTable` call instead of reaching into `dirty`: a re-init has
   *  to re-mesh a store nothing edited, and a table swap re-buckets every chunk.
   *  Not the same as dirtying a CHANGE — nothing is announced, because nothing
   *  changed. */
  redirtyAll(): void;
  /** One chunk's density as a buffer another realm may own. */
  chunkCopy(density: Int8Array): ArrayBuffer;
  /** The stamp-preview snapshot: density COPIES + cloned materials of every
   *  allocated chunk in the region's chunk box grown by one. */
  snapshotChunks(region: Box): {
    key: string;
    density: ArrayBuffer;
    materials: field.ChunkMaterials | null;
  }[];
  /** Every allocated chunk's density as a COPY, keyed as the store keys it. */
  snapshotAllChunks(): { key: string; density: ArrayBuffer }[];
  /** The world-space AABB of a set of chunk keys, or `null` for an empty set. */
  chunkSetBox(chunks: Iterable<field.ChunkKey>): Box | null;
  /** The AABB of the WHOLE allocated world, or `null`. {@link chunkSetBox} over
   *  the store's own keys — published as a verb so `field-camera-rig.ts` asks
   *  where the world IS rather than being handed a store. */
  worldBox(): Box | null;
  /** {@link FieldHost.occupiedTopY}'s body: the highest solid sample layer's
   *  world Y, or `null` when nothing is solid. */
  occupiedTopY(): number | null;
  /** Reset the field session + free every GPU chunk render + drop the whole
   *  selection state. Shared by {@link newWorld} and {@link load}. */
  reset(): void;
  /** {@link FieldHost.newWorld}. Named `create` and not `newWorld` on the same
   *  rule the rest of this seam follows — `loadWorld` is {@link load},
   *  `resetWorld` is {@link reset}, `worldEpoch` is {@link epoch} — because
   *  `world.newWorld()` says the word twice. `field-analyzer.ts` states the rule
   *  at its own seam ("the word 'flag' would be saying it twice"). The FACADE
   *  member keeps `newWorld`: that name is public contract. */
  create(): void;
  /** {@link FieldHost.loadWorld}. Throws on a cellSize mismatch. */
  load(data: WorldFiles): void;
  /** {@link FieldHost.exportArtifact}. */
  exportArtifact(name: string): field.BakedFile[];
  /** The world generation counter, bumped by {@link reset}. Read by the
   *  advisor's verify guard and the entity footprint memo's signature. */
  epoch(): number;
  /** Wall-clock ms of the last completed remesh. Read by the stats meter. */
  lastRemeshMs(): number;
  /** Monotonic remesh counter, bumped once per remesh completion. Read by the
   *  stats meter. */
  remeshVersion(): number;
};

/** Build the world over one host's dependencies. One per host; it holds that
 *  host's remesh timings and its world generation counter for the host's
 *  lifetime. The field itself lives in the substrate, not here. */
export function createWorld(deps: WorldDeps): World {
  const { substrate } = deps;

  let lastRemeshMs = 0;
  // Monotonic remesh counter (see the FieldStats TSDoc): bumped once per
  // remesh completion so the panel's entity refresh has an event-driven
  // trigger that Safari's ~1 ms performance.now() clamp can't alias.
  let remeshVersion = 0;
  // Bumped by every world reset. A verify is seconds long and `reset` drops
  // every finding, so a verdict landing after one would be re-added to a store
  // that has just dropped every verdict it had — describing a field that no
  // longer exists. The advisor's own staleness rule (a chunk's re-analysis drops
  // its verdicts) cannot catch that one, because the clear already happened;
  // every OTHER way a verdict goes stale is that rule's job.
  let worldEpoch = 0;

  // --- dirty set + remesh -------------------------------------------------

  // Watertight seams need the FULL dirty set: a border write dirties the
  // neighbour whose apron reads the changed sample (the lower-endpoint-owns
  // rule). Add the 26 allocated neighbours of every changed chunk.
  const markDirtyWithNeighbors = (changed: Set<string>): void => {
    // An EMPTY set is not a field change, and saying so is load-bearing rather
    // than defensive: a pure scatter writes no cells (core `scatter.ts`'s
    // `{ ops: [], placements }`, and a placement op returns null from
    // applyFieldOp — pinned by core's "commitGenerator accepts a pure scatter",
    // which asserts `dirty.size === 0`), so committing one — or undoing it,
    // through stepHistory — arrives here with nothing changed. Without this the
    // void cast, which shows SHAPE and never props, would tear itself down on
    // the commit of a scatter that could not have staled it, and announce a
    // field change that did not happen. The loop below is already inert for an
    // empty set; only the invalidation below is not.
    if (changed.size === 0) return;
    // THE density-mutation choke point (strokes, stamp commits, ⌘Z/⇧⌘Z,
    // reconfigure apply) — and so where the void cast learns its snapshot went
    // stale. The paths that bypass it change no density: setSlice and
    // setMaterialTable re-mesh the DISPLAY, and a world new/load routes through
    // `reset`, which discards the cast with everything else.
    deps.invalidateVoidCast();
    // Same choke point, second consumer: the analyzer mirrors this store, so
    // this is where it learns what to copy across. ONE call rather than the three
    // lines it replaced (the dirty keys, the pass request, the whole-world
    // re-arm) because those three were one act — see the verb's own docs. The
    // apron neighbours below are a MESH-seam rule and deliberately not part of
    // what goes across: the worker owns that widening.
    deps.noteDensityWritten(changed);
    const { store, dirty } = substrate;
    for (const k of changed) {
      dirty.add(k);
      const [cx, cy, cz] = field.parseChunkKey(k);
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nk = field.chunkKey(cx + dx, cy + dy, cz + dz);
            if (store.chunks.has(nk)) dirty.add(nk);
          }
    }
  };

  // BEHAVIOUR-NEUTRAL RESTRUCTURING, declared because this slice is
  // behaviour-frozen and an undocumented one is exactly what a future reader will
  // suspect. In the closure this was a concise arrow reading the bare `store`
  // three times; the substrate spelling would have read `substrate.store.cellSize`
  // three times on one expression, so the read is hoisted to a local and the arrow
  // gains a body. Same three multiplications, same `Float32Array`, same order —
  // `store` is a substrate VALUE member whose identity never moves, so one read
  // and three reads cannot differ.
  const chunkOrigin = (cx: number, cy: number, cz: number): Float32Array => {
    const s = substrate.store.cellSize;
    return new Float32Array([
      cx * field.CHUNK_DIM * s,
      cy * field.CHUNK_DIM * s,
      cz * field.CHUNK_DIM * s,
    ]);
  };

  // Build one chunk's instanced kit mesh: a unit cube drawn once per piece, each
  // transformed by its (yaw · box) matrix at its world position, tinted per piece.
  // Matrix packing + tinting live in @furnace/core/field kit-render; only GPU
  // calls here. The unit-cube + quarter-turn no-normal-matrix invariant that
  // makes litInstanced safe is documented on `packKitMatrices` — do NOT swap to
  // non-axis-aligned kit geometry (it would skew normals with no test to catch).
  const buildKit = (
    c: Context,
    key: string,
    kit: field.KitInstance[],
  ): { im: mesh.InstancedMesh; g: geometry.Geometry } | null => {
    if (kit.length === 0) return null;
    const g = geometry.cube(c, { size: 1 });
    const im = mesh.createInstanced(c, {
      geometry: g,
      material: deps.kitInstancedMat(),
      count: kit.length,
    });
    const [cx, cy, cz] = field.parseChunkKey(key);
    const dim = field.CHUNK_DIM * substrate.store.cellSize;
    mesh.setInstanceMatrices(
      c,
      im,
      field.packKitMatrices(kit, [cx * dim, cy * dim, cz * dim]),
    );
    kit.forEach((k, i) =>
      mesh.setInstanceTint(c, im, i, field.pieceColor(substrate.table(), k)),
    );
    return { im, g };
  };

  const destroyChunkRender = (c: Context, cm: ChunkRender): void => {
    for (const e of cm.entries) {
      mesh.destroy(c, e.m);
      geometry.destroy(c, e.g);
    }
    if (cm.kit) mesh.destroyInstanced(c, cm.kit);
    if (cm.kitGeo) geometry.destroy(c, cm.kitGeo);
  };

  // Replace a chunk's GPU render state with a fresh remesh result: one mesh per
  // non-empty per-class bucket + one instanced kit mesh. Empty buckets AND empty
  // kit (a fully re-buried chunk) destroys any stale state and creates none —
  // never skipped, since a neighbour's owned crossing may have vanished here.
  const applyMesh = (
    c: Context,
    key: string,
    buckets: WireBucket[],
    kit: field.KitInstance[],
  ): void => {
    const { chunkMeshes } = substrate;
    const old = chunkMeshes.get(key);
    if (old) {
      destroyChunkRender(c, old);
      chunkMeshes.delete(key);
    }
    const [cx, cy, cz] = field.parseChunkKey(key);
    const origin = chunkOrigin(cx, cy, cz);
    const entries: ChunkRender["entries"] = [];
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
        material: deps.bucketMat(bucket.classId, bucket.backing),
      });
      mesh.setPosition(c, m, origin);
      entries.push({ m, g, classId: bucket.classId, backing: bucket.backing });
    }
    const kitRes = buildKit(c, key, kit);
    if (entries.length === 0 && kitRes === null) return; // re-buried chunk
    chunkMeshes.set(key, {
      entries,
      kit: kitRes?.im ?? null,
      kitGeo: kitRes?.g ?? null,
    });
  };

  // Mesh one chunk through the worker. The client rejects on dispose and on a
  // worker-side mesh error; callers must catch (the client does not) or a
  // post-dispose rejection becomes an unhandled rejection.
  const remeshOne = async (key: string): Promise<void> => {
    const c = substrate.ctx();
    if (!c) return;
    const { store } = substrate;
    const aprons = field.extractFieldAprons(store, key);
    const t0 = performance.now();
    try {
      const res = await substrate.worker.mesh(
        key,
        aprons,
        substrate.table(),
        store.cellSize,
        deps.sliceY() ?? undefined,
      );
      lastRemeshMs = performance.now() - t0;
      remeshVersion++;
      if (substrate.disposed()) return;
      applyMesh(c, key, res.buckets, res.kit);
    } catch (err) {
      if (substrate.disposed()) return; // dispose rejects pending jobs — expected
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`field-host: remesh failed for ${key}: ${message}`);
    }
  };

  const drainDirty = (): void => {
    const { dirty } = substrate;
    let n = 0;
    for (const key of dirty) {
      if (n >= REMESH_PER_FRAME) break;
      dirty.delete(key);
      void remeshOne(key);
      n++;
    }
  };

  /** The world-space AABB of a set of chunk keys. Used by `frameChunks` (which
   *  takes its centre) and `frameWorld` (which fits to the whole box), because
   *  two copies of this arithmetic is how a re-centre and a fit come to disagree
   *  about where a world is — and there WERE two until the F4.5 gate added the second
   *  verb and a review noticed the docblock claiming a de-duplication that had not
   *  happened. `null` for an empty set: a box with no chunks in it has no centre and
   *  no edges, and both callers refuse rather than fit to infinities. */
  const chunkSetBox = (chunks: Iterable<field.ChunkKey>): Box | null => {
    const dim = field.CHUNK_DIM * substrate.store.cellSize;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let any = false;
    for (const key of chunks) {
      any = true;
      const [cx, cy, cz] = field.parseChunkKey(key);
      minX = Math.min(minX, cx * dim);
      maxX = Math.max(maxX, (cx + 1) * dim);
      minY = Math.min(minY, cy * dim);
      maxY = Math.max(maxY, (cy + 1) * dim);
      minZ = Math.min(minZ, cz * dim);
      maxZ = Math.max(maxZ, (cz + 1) * dim);
    }
    return any ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } : null;
  };

  /** {@link FieldHost.occupiedTopY}'s body, which is also `frameWorld`'s ceiling.
   *  It was inline in the returned object until the F4.5 gate added a second
   *  caller; a `host.occupiedTopY()` self-call from inside the same literal would
   *  have worked and would also have been the one place a reader cannot see that
   *  the two verbs share a scan. */
  const occupiedTopYOf = (): number | null => {
    // Walk SAMPLE layers from the top down, and stop at the first solid one.
    // Sample-layer order rather than chunk order is what makes the answer
    // exact: two chunks in the same cy layer can have their topmost rock 15
    // samples apart, and taking the first chunk that has any rock in it would
    // answer with the wrong one whenever the map iterates them in that order.
    //
    // Density is int8 with the isosurface at 0 (`SOLID` = -127, `AIR` = 127),
    // so "solid" is `< 0` — the same test the mesher's sign change uses. Not
    // `=== SOLID`: a smoothed or partially-dug ceiling is solid rock the user
    // can see and stand under, and it is never exactly -127.
    //
    // COST, measured on Bun/JSC over synthetic stores, 5 runs each. Per
    // sample layer this reads at most 256 int8s per chunk in that layer and
    // returns on the first hit, so the early exit is what the numbers are
    // about:
    //
    //   192 chunks, rock in every chunk (a floor)    0.29 - 1.26 ms
    //   5 000 chunks, same shape                     1.27 - 1.40 ms
    //   192 chunks, ALL AIR (worst case)             0.61 - 2.30 ms
    //   5 000 chunks, ALL AIR                       16.1 - 17.9 ms
    //
    // The pair that matters is rows 2 and 4: at the SAME 5 000 chunks the
    // answerable world costs 1.3 ms and the unanswerable one 16 ms, because
    // the first returns out of the top layer and the second reads every
    // allocated sample (4096 int8s per chunk, ~20 M). So the cost tracks the
    // top layer, not the world — and the worst case is a store dug out and
    // then filled back to nothing, which is both rare and still inside the
    // editor's 100 ms interaction ceiling. Once per slice-enable, never per
    // frame and never per slider drag (the chrome seeds once, then owns the
    // value — see `useView.tsx`).
    const { store } = substrate;
    if (store.chunks.size === 0) return null;
    // Bucket by chunk-Y once so each sample layer looks at only the chunks
    // that can contain it, rather than re-filtering the whole map per layer.
    const byLayer = new Map<number, Int8Array[]>();
    let maxCy = Number.NEGATIVE_INFINITY;
    let minCy = Number.POSITIVE_INFINITY;
    for (const [key, density] of store.chunks) {
      const cy = field.parseChunkKey(key)[1];
      if (cy > maxCy) maxCy = cy;
      if (cy < minCy) minCy = cy;
      const bucket = byLayer.get(cy);
      if (bucket) bucket.push(density);
      else byLayer.set(cy, [density]);
    }
    const D = field.CHUNK_DIM;
    for (let cy = maxCy; cy >= minCy; cy--) {
      const chunks = byLayer.get(cy);
      if (!chunks) continue;
      for (let ly = D - 1; ly >= 0; ly--) {
        for (const density of chunks) {
          // The layer's samples are `lx + D*(ly + D*lz)`, so one ly spans D
          // runs of D contiguous entries — walked as runs rather than with a
          // multiply per sample.
          for (let lz = 0; lz < D; lz++) {
            const base = D * (ly + D * lz);
            for (let lx = 0; lx < D; lx++)
              if ((density[base + lx] ?? 0) < 0)
                return (cy * D + ly) * store.cellSize;
          }
        }
      }
    }
    return null;
  };

  // --- chunk snapshots (the void cast + the analyzer mirror) ---------------
  //
  // BEHAVIOUR-NEUTRAL REORDER, declared for the reason above. In the closure
  // these three sat as `snapshotChunks` … `chunkCopy` … `snapshotAllChunks`, with
  // `snapshotChunks` forward-referencing `chunkCopy` ~45 lines below it. Here
  // they read in dependency order, `chunkCopy` first.
  //
  // FOR READABILITY, and explicitly NOT because a module body is different: this
  // factory's body has exactly the same guarantee the closure had — nothing
  // between its brace and its `return {` executes, which is the invariant
  // `field-host.ts` states once at the `createVoidCast` assembly. The old order
  // was correct and would still be correct here; a one-line helper reading above
  // its two callers is simply easier to follow than below them. No statement
  // changed.

  // One chunk's density as a buffer another realm may own. Boundary cast:
  // `.slice()` allocates a fresh ArrayBuffer, which the Int8Array declaration
  // widens to ArrayBufferLike. Shared by the void cast and the analyzer mirror —
  // the two differ in WHY they copy (see each call site), not in how.
  const chunkCopy = (density: Int8Array): ArrayBuffer =>
    density.slice().buffer as ArrayBuffer;

  // The stamp-preview snapshot: density COPIES + cloned materials of every
  // allocated chunk in the region's chunk box grown by one (the protocol's
  // completeness contract — every allocated chunk intersecting the region +
  // its 26-halo; the grown box over-includes by at most one boundary chunk,
  // harmless since completeness is a floor). The COPY is load-bearing: the
  // client TRANSFERS density buffers to the worker — sending the store's live
  // buffers would detach them and destroy the field. Known limit (protocol
  // TSDoc): a generator whose params overflow the region past the one-chunk
  // halo can preview against solid where the store is carved — the region-vs-
  // params mismatch is the stamp UI's to surface.
  const snapshotChunks = (
    region: Box,
  ): {
    key: string;
    density: ArrayBuffer;
    materials: field.ChunkMaterials | null;
  }[] => {
    const { store } = substrate;
    const dim = field.CHUNK_DIM * store.cellSize;
    const lo: Vec3T = [
      Math.floor(region.min[0] / dim) - 1,
      Math.floor(region.min[1] / dim) - 1,
      Math.floor(region.min[2] / dim) - 1,
    ];
    const hi: Vec3T = [
      Math.floor(region.max[0] / dim) + 1,
      Math.floor(region.max[1] / dim) + 1,
      Math.floor(region.max[2] / dim) + 1,
    ];
    const out: {
      key: string;
      density: ArrayBuffer;
      materials: field.ChunkMaterials | null;
    }[] = [];
    for (const [key, density] of store.chunks) {
      const [cx, cy, cz] = field.parseChunkKey(key);
      if (cx < lo[0] || cx > hi[0]) continue;
      if (cy < lo[1] || cy > hi[1]) continue;
      if (cz < lo[2] || cz > hi[2]) continue;
      const mats = store.materials.get(key);
      out.push({
        key,
        density: chunkCopy(density),
        materials: mats === undefined ? null : field.cloneChunkMaterials(mats),
      });
    }
    return out;
  };

  // Every allocated chunk's density as a COPY, keyed as the store keys it. The
  // copy is load-bearing for the same reason snapshotChunks' is: the client
  // TRANSFERS these buffers, and sending the store's live ones would detach
  // them and destroy the field.
  const snapshotAllChunks = (): { key: string; density: ArrayBuffer }[] =>
    [...substrate.store.chunks].map(([key, density]) => ({
      key,
      density: chunkCopy(density),
    }));

  // --- what the facade's three lifetime methods call instead of reaching ----
  //
  // The register's last two cluster-to-cluster mutation targets, behind verbs.
  // `ret.dispose` and `ret.setMaterialTable` both spelled out the same two
  // statements over `chunkMeshes`, and `ret.init` and `ret.setMaterialTable`
  // both spelled out the same loop over `dirty` — four write sites, two acts,
  // and none of their writers can follow the state here (two are the frame
  // lifetime, two are the catalog setter, and all three rows are declared
  // facade-resident). Task 4's ten momentary writes are the precedent: when a
  // writer is never going to move, the write becomes a CALL in place.
  const discardChunkRenders = (c: Context): void => {
    const { chunkMeshes } = substrate;
    for (const [, cm] of chunkMeshes) destroyChunkRender(c, cm);
    chunkMeshes.clear();
  };

  const redirtyAll = (): void => {
    for (const key of substrate.store.chunks.keys()) substrate.dirty.add(key);
  };

  // Reset the field session + free every GPU chunk render + drop the whole
  // selection state (a different world invalidates it — Reselect slot too).
  // Shared by newWorld/load. `FieldHost.dispose` deliberately does NOT clear
  // selection state: like the tool/radius/camera pose, it is CPU-only session
  // state that survives a dispose/re-init on the same store.
  const resetWorld = (): void => {
    worldEpoch += 1; // retires any stage-2 verdict still in flight
    // BEFORE the store is cleared below, while the outgoing keys still exist: the
    // analyzer's mirror has no reset verb, so a world swap lists them as removals
    // on the next sync. Its findings describe a field that is about to be gone,
    // and its pending write set names chunks that will not be there to copy —
    // five lines that were always one act, and are one verb since T3d.
    //
    // The epoch bump moved ABOVE it in the same change, and the move is provably
    // inert rather than merely harmless. Name the statements it crossed, because
    // that IS the proof: the four mirror writes the verb's first half now does —
    // `analyzerStale.add` over the outgoing keys, `analyzerDirty.clear()`,
    // `analyzerResync = true`, `analyzerSeeds = []`. None reads `worldEpoch`, and
    // none can reach it transitively (`store.chunks` is a plain Map, no getter),
    // so the four and the bump commute. Putting the bump after the verb instead
    // would move it past `flagStore.clear()` AND `publishFlags()` — and the
    // publish delivers to subscribers that are free to call back into the host
    // synchronously, which is the one re-entrancy window in this function.
    deps.retireAdvisorWorld();
    const { store, log, chunkMeshes } = substrate;
    store.chunks.clear();
    store.materials.clear();
    log.ops.length = 0;
    log.undoStack.length = 0;
    log.redoStack.length = 0;
    log.nextId = 1;
    substrate.dirty.clear();
    const c = substrate.ctx();
    if (c) for (const [, cm] of chunkMeshes) destroyChunkRender(c, cm);
    chunkMeshes.clear();
    // `rebuildProps()`, not a prop-layer destroy: the log was emptied above, so
    // this both frees the outgoing draws AND resets the counts — a bare destroy
    // would leave propInstanceCounts describing the world that just went away.
    deps.rebuildProps();
    deps.clearBoxAnchor();
    // The segment anchor is a point in the OLD field — a capsule swept from it
    // into the new one would start somewhere the user never clicked.
    deps.clearSegmentAnchor();
    // …and so is the pending stamp arm: the region it is asking for would be
    // drawn in the new world for a question the old one posed, and every surface
    // reading the seam would go on saying "drag a region" across a world swap.
    // (Its own clear takes the box anchor again — harmless, already null.)
    deps.clearPendingStamp();
    // FIVE STATEMENTS behind one verb since T3d Task 5, and the verb exists
    // because what this path wanted was never a setter: it clears BOTH slots
    // without parking (a Reselect across a world swap would restore cells
    // describing the field that just went away), then pays the Esc stack back,
    // then refreshes both display halves, then pushes the null. The order is the
    // whole content and it now lives in one place — `field-analyzer.ts`'s
    // `retireWorld` two calls up is the same act on the other cluster, and the
    // name is shared on purpose.
    deps.retireSelection();
    // A different world invalidates the stamp session (its region + snapshot
    // describe the old field), the entity selection (log entity ids reset) and
    // any drift report (its findings name op ids the new log does not have).
    deps.cancelSession();
    // Notified, not just cleared: the selection is a SEAM now, and a subscriber
    // left holding an id from the outgoing world is the same class of bug as the
    // stale stamp session announced above.
    deps.selectEntity(null);
    // The cast describes the field that just went away. Discarded SILENTLY,
    // unlike an edit-time invalidation: everything else on screen is being
    // replaced too, so "void cast cleared" beside a fresh world is noise.
    deps.discardVoidCast();
    deps.setDrift(null);
    deps.notifyDrift();
  };

  // World-load compaction (spec D-F3-16 / D-F3-6): fold aged brush runs into
  // patches when the loaded log carries more than COMPACT_THRESHOLD_OPS foldable
  // ops. Load is the ONLY safe moment — compactRuns REQUIRES both undo stacks
  // empty (its entries address log.ops POSITIONALLY, which folding shifts), and
  // a freshly loaded log has none by construction: serializeOps persists
  // log.ops and never the stacks, and resetWorld cleared them just above. No
  // mid-session auto-compact, no button — compaction is for history that has
  // aged out of an edit session, which is exactly what a load carries.
  // `keepIds` is empty: nothing in the editor references an op id across a load,
  // and the meter's `compactableOps` reads the same empty-pinned ceiling so it
  // predicts this fold. DEFENSIVE: a fold can throw (a catalog that dropped a
  // class id the ops recorded — see compactRuns' TSDoc), and a failed
  // compaction is never worth failing a load; compactRuns validates before its
  // first write, so a throw leaves the log exactly as parsed. The world loads
  // uncompacted and the reason surfaces on the tool-error channel rather than
  // blanking the panel (the optional-chrome failure stance).
  const compactLoadedLog = (): void => {
    const { store, log } = substrate;
    if (field.logStats(log).compactableOps <= COMPACT_THRESHOLD_OPS) return;
    try {
      field.compactRuns(store, log, substrate.table(), { keepIds: new Set() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.reportToolError(
        `world loaded, but log compaction was skipped: ${message}`,
      );
    }
  };

  return {
    markDirtyWithNeighbors,
    chunkOrigin,
    drainDirty,
    discardChunkRenders,
    redirtyAll,
    chunkCopy,
    snapshotChunks,
    snapshotAllChunks,
    chunkSetBox,
    worldBox: () => chunkSetBox(substrate.store.chunks.keys()),
    occupiedTopY: occupiedTopYOf,
    reset: resetWorld,
    epoch: () => worldEpoch,
    lastRemeshMs: () => lastRemeshMs,
    remeshVersion: () => remeshVersion,
    create() {
      resetWorld();
      // The mirror is emptied by the pass resetWorld's outgoing keys ride on;
      // this request is the explicit one, so that emptying does not depend on the
      // prop layer happening to rebuild on the same path. No ANALYSIS follows
      // either way — a new world holds no field and, with no manifest, no seed.
      deps.requestAnalyzerPass();
      deps.notifyEntities();
    },
    load(data) {
      const { store, log } = substrate;
      // Setup-loud: the store's cellSize is fixed at construction and captured by
      // every closure here, so it can't be cheaply rebuilt. A world baked at a
      // different scale would decode at the wrong size silently — refuse it.
      if (data.manifest.cellSize !== store.cellSize) {
        throw new Error(
          `FieldHost.loadWorld: world cellSize ${data.manifest.cellSize} != host ${store.cellSize} (multi-cellSize load not supported in v0)`,
        );
      }
      resetWorld();
      for (const { key, bytes } of data.chunks)
        store.chunks.set(key, field.decodeChunkFile(bytes));
      for (const { key, bytes } of data.materials ?? [])
        store.materials.set(key, field.decodeMaterialFile(bytes));
      const ops = data.oplog === null ? [] : field.parseOps(data.oplog);
      for (const op of ops) log.ops.push(op);
      log.nextId = ops.reduce((max, o) => Math.max(max, o.id), 0) + 1;
      // v0: manifest.playerStart/playerYaw are the dungeon runtime spawn, and the
      // editor never adopts them as its own camera. `playerStart` IS read, as the
      // walkability advisor's seed: it is
      // where the agent starts, which is exactly what "can it get there" and
      // "can it get back" are asked from. Copied, not aliased — the manifest is
      // the caller's. A world with no manifest (newWorld) leaves the seeds empty
      // and both connectivity passes skip, rather than guessing a spawn.
      const [seedX, seedY, seedZ] = data.manifest.playerStart;
      // The seed AND the two staleness flags as one act: the chunks above were
      // written straight into the store, so nothing marked them dirty, and the
      // mirror still holds the world `resetWorld` listed as removals. The
      // REQUEST stays separate and stays where it is, below `rebuildProps()` —
      // moving it up here would fire the pump before the log is compacted and
      // before the prop layer is rebuilt, which is a different pass.
      deps.noteWorldLoaded([seedX, seedY, seedZ]);
      redirtyAll();
      // Fold aged brush runs before the panel reads the log: quiescent history
      // is guaranteed here (see compactLoadedLog), and it never touches entity
      // ops, so the entity list below is unaffected either way.
      compactLoadedLog();
      // AFTER the ops land, not inside resetWorld: the tick must carry the
      // loaded world's entities, not the empty log the reset left behind — and
      // the prop layer must be built from the loaded placement ops, not the
      // empty log (resetWorld tore the previous world's props down).
      deps.rebuildProps();
      // Explicit rather than left to `rebuildProps()`'s own request: a load's
      // analyzer work (full re-sync, placements, whole-world pass) must not
      // depend on the prop layer happening to rebuild on the same path.
      deps.requestAnalyzerPass();
      deps.notifyEntities();
      // NO AUTOMATIC FRAME HERE, and the first attempt at ruling 5 put one in —
      // which is worth recording, because it looked like the obvious home. This
      // method holds both the freshly-decoded store and the camera, so framing
      // from here needed no seam and no ordering.
      //
      // It is still wrong: `loadWorld` is a DATA primitive, and the editor is not
      // its only caller. It is also the only headless route to a committed entity,
      // so nine GPU and analyzer suites use it to install a fixture and then pick
      // with a ray — and a camera that re-aims itself on load moves what those rays
      // hit. All nine went red, which is the honest version of "this changes what
      // every loader is pointing at". The UX belongs to the verb the RULING names,
      // `Open`, which is the chrome's (`hooks/useWorld.tsx`), and the chrome already
      // holds the host so it needs no seam either.
    },
    exportArtifact(name) {
      return field.bakeFieldWorld(
        substrate.store,
        substrate.log,
        substrate.table(),
        {
          name,
          playerStart: deps.cameraEye(),
          playerYaw: deps.cameraYaw(),
        },
      );
    },
  };
}

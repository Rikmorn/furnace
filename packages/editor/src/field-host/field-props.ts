// The committed prop layer: one instanced proxy draw per archetype, rebuilt
// WHOLE from the op log's placement records. The THIRD cluster lifted out of
// `createFieldHost` — after `field-segment.ts` and `field-voidcast.ts` — built
// on the first's shape, and the second module ever handed a
// {@link HostSubstrate}.
//
// WHAT MAKES IT DIFFERENT FROM `field-voidcast.ts` is the interesting fact about
// this move, and it is FAN-IN. The void cast has zero `FieldHost` members and
// seven host call sites spread over EVERY member its seam has left (three verbs
// and the one fact) — three of the seven are `discard`, and `destroy` and
// `apply`, the two members with no host caller at all, came off the seam at T3b2
// (it read four-of-six before that trim) — so no single entry point carries that
// cluster.
// This one has one facade member (`propInstanceCounts`) and NINE call sites on a
// SINGLE verb, `rebuildProps()`, in nine functions across six of the map's
// clusters: `commitStampSession` and
// `applyReconfigureSession` (stamp), `stepHistory` (history), `resetWorld` and
// `loadWorld` (world), `init` (lifecycle), `setEntityCatalog` (catalogs), and
// `deleteEntity` and `duplicateEntity` (entities). A tenth caller, `dispose`,
// takes the teardown alone.
//
// The closure map (`docs/reference/field-host-clusters.md` §6) recorded ONE
// inbound edge — `render.renderScene` reading `propMeshes` — and that edge is
// real and unchanged, though since 2026-08-08 it crosses a MODULE line rather
// than a cluster one: `renderScene` is `field-render.ts`'s, and it reaches the
// array through the same substrate record this module fills it through. The nine
// calls stand beside it uncounted, because the
// map's edges are over DATA bindings and a cross-cluster CALL is not one (§2.1's
// second correction, which `segment` found and this cluster is the loudest
// instance of). Size this cluster off its row and you read it as something the
// host occasionally looks at; six of the host's clusters ask it to run.
//
// That fan-in is what shapes the seam. Nine callers is nine chances to re-point
// wrong, so `rebuild` takes no arguments and returns nothing — exactly the shape
// the nine sites already had, so every one of them is a textual swap with no
// decision in it. What the layer needs to know it reads, per call, off the
// substrate.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument):
//
//   - `propMeshes` and `log` are `const` in the host, mutated through the
//     identity it hands over, so they ride BY VALUE inside the substrate. The
//     array is emptied with `length = 0` and re-pushed rather than replaced,
//     which is the only reason `renderScene` and this module can never disagree
//     about what is drawn.
//   - `ctx` and `archetypeById` are host `let`s and both ride as SUBSTRATE
//     THUNKS — but NOT for the same reason, and the difference is the part a
//     third extraction needs. `ctx()` has two extracted readers today
//     (`field-voidcast.ts` and this one), so it would have earned its place on
//     any rule. `archetypeById()` has exactly ONE: this module. It rides in the
//     record anyway because T3a DECLARED it there, ahead of any consumer — and
//     the two-reader bar governs ADDING a member, not declining one that is
//     already sitting in the record. Reading a declared member costs nothing
//     new.
//   - `kitMat` WAS a host `let` that is not in the record, and while it was, this
//     module's being its only extracted reader is what kept it off the substrate:
//     the bar in its active form, since widening the record for a single consumer
//     charges every future cluster's assembly for this one's convenience. That
//     argument EXPIRED on 2026-08-08 (foundations T3d), when the material layer
//     got an owner. `kitMat` and `kitInstancedMat` are now plain refs onto
//     `field-materials.ts`'s seam, and the substrate is not involved in either
//     direction. What survives is the CALL and the reason for it — the material
//     is built at `init` and nulled at `dispose`, so a value copy would be `null`
//     forever or would outlive the device — and what is gone is the claim that
//     this is a substrate-bar decision. It is now simply reading another module.
//     The bar itself still stands and is still worked at `archetypeById` above.
//
// So the split is not `let` vs `const`, and it is not reader count alone — it is
// whether the member is ALREADY declared. What is universal is the CALL: all
// three are reassignable, and a value copy of any of them would be a photograph,
// which is the failure `substrate.ts`'s doc header exists to describe.
//
// And the one boundary MUTATION travels as a named CALL, on `field-segment.ts`'s
// `armMaskDropReport` precedent: {@link PropsDeps.markPlacementsStale}. It
// covers all THREE of the lines it replaced — both analyzer flags AND the pump
// request — because those three lines were one act under one comment, and a
// module that set two flags and left the scheduling to a separate dep could set
// them and have nothing happen. The pump is therefore NOT a dep of this module;
// the host names the whole act and owns how it is performed.
import * as field from "@furnace/core/field";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import type { EntityCollision } from "../shared/catalog.ts";
import {
  FALLBACK_COLLISION,
  FALLBACK_TINT,
  groupPlacements,
  PROXY_PRIMITIVE,
  proxyRecords,
} from "./field-placements.ts";
import type { HostSubstrate } from "./substrate.ts";

/** What the prop layer needs from the rest of the host.
 *
 *  Three entries beside the substrate, and each one is a CALL for a different
 *  reason: `kitMat` because it names a handle `field-materials.ts` replaces at
 *  `init` and `dispose`, `kitInstancedMat` because it is that module's throwing
 *  getter over the same handle (shared with the chunk kit-piece draws, so it
 *  stays there rather than being duplicated here), and `markPlacementsStale`
 *  because it is a WRITE into another cluster's state and a write that crossed
 *  the boundary as anything but a named call would be a flag this module could
 *  set and the host never see. */
export type PropsDeps = {
  /** The host's shared state. Four members are read: `log` (the placement ops
   *  the whole layer is derived from), `archetypeById()` (the catalog that
   *  decides each archetype's proxy primitive and tint), `ctx()` (the GPU
   *  guard), and `propMeshes` — the array this module fills and empties and
   *  `field-render.ts`'s `renderScene` draws from, shared BY IDENTITY. */
  substrate: HostSubstrate;
  /** The kit material, or `null` before the first `init` and after `dispose`.
   *  The NULLABLE read, and the layer's GPU guard: `rebuild` refuses to upload
   *  without it. A call because `field-materials.ts` builds the handle at `init`
   *  and nulls it at `dispose`, so a value copy would be `null` forever or would
   *  outlive the device. */
  kitMat(): material.Material | null;
  /** The same material as the THROWING getter — `field-materials.ts`'s, shared
   *  with the chunk kit-piece draws. Used only past the `kitMat()` guard above,
   *  so the throw is unreachable from here. */
  kitInstancedMat(): material.Material;
  /** Tell the walkability advisor that the placement colliders moved, and that
   *  the next pass is the whole-world one.
   *
   *  THE cluster's one boundary mutation, and it is one CALL rather than two
   *  flags plus a pump because the three lines it replaced were a single act:
   *  props rasterize into the solidity stage 1 reads, so a rebuild of this layer
   *  IS a change to what the analyzer must re-run over. Setting the flags
   *  without asking for a pass would leave the staleness sitting until something
   *  else happened to request one. */
  markPlacementsStale(): void;
};

/** The prop layer's two verbs and the one fact the host publishes off it.
 *
 *  No state is exposed. The meshes live in the substrate because
 *  `field-render.ts`'s `renderScene` draws them; the per-archetype counts are
 *  private because the only thing that
 *  ever read them is `FieldHost.propInstanceCounts`, which
 *  {@link Props.instanceCounts} now is.
 *
 *  It was THREE verbs until foundations T3b2. `proxyGeometry` was put here on
 *  the argument that the layer's geometry choice is its contract with the
 *  catalog, and no reader outside this module ever arrived — so the seam gave
 *  it back. The function is unchanged and `rebuild` still calls it; what went
 *  is the claim that anyone else may. */
export type Props = {
  /** Free every instanced prop draw and empty the layer. Takes the context
   *  rather than reading it, because its one external caller (`dispose`) has
   *  already proved the context non-null for the whole teardown block. */
  destroy(c: Context): void;
  /** Rebuild the whole layer from the op log. Nine callers — this module's own
   *  header names them, and the shape (no arguments, no return) is what lets
   *  all nine be a textual swap. */
  rebuild(): void;
  /** The per-archetype instance counts as of the last {@link Props.rebuild}, as
   *  a COPY — the caller may keep it, and this module goes on replacing its
   *  own. */
  instanceCounts(): Map<string, number>;
};

/** Build the prop layer over one host's dependencies. One per host; it holds the
 *  layer's meshes (in the substrate) and its instance counts for that host's
 *  lifetime. */
export function createProps(deps: PropsDeps): Props {
  // The layer's per-archetype instance counts as of the last rebuild — the ONE
  // observable fact about a layer that is otherwise write-only GPU state (see
  // `FieldHost.propInstanceCounts`, which this feeds). Recorded even when there
  // is no context, because rebuild's whole job is to decide these numbers and
  // only then upload them; init() replays the upload from the same source.
  let propCounts = new Map<string, number>();

  // The unit-sized proxy primitive for a collision kind — cube `size: 1`,
  // sphere/cylinder ⌀1 — so `proxyRecords`' folded scale IS the world extent.
  // Do NOT change these sizes without changing proxyScale: the two are one
  // formula split across the CPU/GPU boundary.
  const proxyGeometry = (
    c: Context,
    collision: EntityCollision,
  ): geometry.Geometry => {
    const primitive = PROXY_PRIMITIVE[collision.kind];
    if (primitive === "sphere") return geometry.sphere(c, { radius: 0.5 });
    if (primitive === "cylinder")
      return geometry.cylinder(c, { radius: 0.5, height: 1 });
    return geometry.cube(c, { size: 1 });
  };

  const destroyProps = (c: Context): void => {
    for (const p of deps.substrate.propMeshes) {
      mesh.destroyInstanced(c, p.im);
      geometry.destroy(c, p.g);
    }
    deps.substrate.propMeshes.length = 0;
  };

  // Rebuild the committed prop layer from the op log: one instanced proxy draw
  // per archetype, its instance count the archetype's record count, its matrices
  // core's packPlacementMatrices over records re-scaled to the catalog collision
  // primitive, its tint the archetype's catalog colour. Called by every path that
  // can change which placement ops are in the log (commit, reconfigure apply,
  // ⌘Z/⇧⌘Z, world new/load) plus the two that change how they DRAW (init,
  // setEntityCatalog). Whole-layer teardown-and-rebuild, like a chunk remesh:
  // instance counts are fixed at creation, and a placement op is a whole
  // generator's worth of props at once, so there is no partial update to make.
  // Silent no-op before GPU init — init() rebuilds once the materials exist, so
  // a world loaded pre-init still gets its props.
  const rebuildProps = (): void => {
    // The prop layer and the analyzer's collider set are derived from the SAME
    // log, so one call site keeps them in step. Whole-world, not incremental:
    // props rasterize into the solidity stage 1 reads, and there is no
    // incremental placement-sync path — `voxelizePlacements` is whole-map
    // replacement by construction.
    deps.markPlacementsStale();
    const groups = groupPlacements(deps.substrate.log.ops);
    // The counts settle FIRST and unconditionally: they are what the layer IS,
    // and recording them before the GPU guard keeps them honest for a host that
    // has not initialized yet (init replays the upload from this same log).
    propCounts = new Map([...groups].map(([id, r]) => [id, r.length]));
    const c = deps.substrate.ctx();
    if (!c || !deps.kitMat()) return;
    destroyProps(c);
    for (const [archetypeId, records] of groups) {
      // The thunk per iteration rather than one read hoisted above the loop:
      // the substrate's whole point is that a `let` is read where it is used,
      // and a hoist here would be a snapshot that is merely small (see
      // `substrate.ts`). It costs one arrow call per archetype.
      const archetype = deps.substrate.archetypeById().get(archetypeId);
      const collision = archetype?.collision ?? FALLBACK_COLLISION;
      const g = proxyGeometry(c, collision);
      const im = mesh.createInstanced(c, {
        geometry: g,
        material: deps.kitInstancedMat(),
        count: records.length,
      });
      mesh.setInstanceMatrices(
        c,
        im,
        field.packPlacementMatrices(proxyRecords(records, collision)),
      );
      const tint: [number, number, number, number] =
        archetype === undefined
          ? FALLBACK_TINT
          : [archetype.color[0], archetype.color[1], archetype.color[2], 1];
      records.forEach((_, i) => mesh.setInstanceTint(c, im, i, tint));
      deps.substrate.propMeshes.push({ im, g });
    }
  };

  return {
    destroy: destroyProps,
    rebuild: rebuildProps,
    instanceCounts: () => new Map(propCounts),
  };
}

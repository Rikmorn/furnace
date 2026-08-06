// What a module lifted out of the field host may hold BY VALUE, and what it
// must ask the host for on every call.
//
// This is `field-segment.ts`'s SegmentDeps lesson generalised from one cluster
// to the whole host. That module's own comment states the rule — "a value read
// once at construction is correct only for state that cannot move afterwards" —
// and had to state it because getting the split wrong there would have forked
// the dig radius. At host scale the same mistake is available sixteen times
// over, so the split stops being a per-cluster judgement call and becomes a
// type.
//
// PACKAGE-INTERNAL, deliberately not re-exported from `index.ts`: like
// `view-channel.ts` and `input-router.ts` this is a seam between the host and
// the clusters lifted out of it, not surface the chrome may reach for.
//
// The RECORD is unconsumed today, and that is the plan: `createFieldHost` adopts
// it when T3b's first cluster extraction has something to hand it, and
// constructing one before there is a consumer would be dead code claiming to be
// a boundary. The two render-bookkeeping types below are already live — the host
// reads them from here.
import type * as binding from "@furnace/core/binding";
import type * as field from "@furnace/core/field";
import type * as geometry from "@furnace/core/geometry";
import type * as gpu from "@furnace/core/gpu";
import type { Context } from "@furnace/core/gpu";
import type * as material from "@furnace/core/material";
import type * as mesh from "@furnace/core/mesh";
import type { EntityArchetype } from "../frontend/lib/catalog.ts";
import type { FieldWorkerClient } from "../frontend/lib/field-client.ts";
import type { FlagStore } from "./field-flags.ts";

// The two render-bookkeeping shapes below are declared HERE, not in the host
// that has always built them, because this module owns the vocabulary of what
// the host's extracted clusters share — and a per-chunk render entry is shared
// substrate by definition, being half of what a rendering cluster would be
// lifted out to own. `field-host.ts` type-imports them from here, so the host
// and the first cluster to arrive read one declaration rather than two
// structurally identical ones the compiler could never tell apart.

/** One chunk's GPU render state: per-class surface/backing bucket meshes plus an
 *  optional instanced kit mesh (one draw call for all its kit pieces). */
export type ChunkRender = {
  entries: {
    m: mesh.Mesh;
    g: geometry.Geometry;
    classId: number;
    backing: boolean;
  }[];
  kit: mesh.InstancedMesh | null;
  kitGeo: geometry.Geometry | null;
};

/** One archetype's committed prop draw: an instanced proxy primitive + the
 *  geometry it owns (one draw call for every placed record of that archetype). */
export type PropRender = { im: mesh.InstancedMesh; g: geometry.Geometry };

/**
 * The field host's shared state, split by whether the host can REPLACE it.
 *
 * The split is not a style preference and it is not about mutability. Every
 * member of the first group is a `const` in `createFieldHost`, so its binding
 * can never be reassigned and the host's writes all land THROUGH the identity
 * it already handed out (`chunkMeshes.set`, `propMeshes.length = 0`,
 * `flagStore.applyFlags`). A holder of that reference therefore sees every
 * write, and passing it by value is not merely acceptable — it is the only
 * spelling that says "this object is the one object".
 *
 * The second group is the `let`s, where the host REPLACES the value rather than
 * writing into it, and a snapshot is a permanent fork. The failure mode is what
 * makes it worth a type: nothing throws. `setMaterialTable` assigns a whole new
 * `table`, and a module that had copied the old one goes on meshing, validating
 * and baking against a perfectly well-formed material table that describes a
 * project the user has already changed — wrong buckets, wrong class split, no
 * error anywhere. `disposed` is the same bug with the volume up: snapshot it and
 * it reads `false` for the life of the process, so every "am I still alive"
 * guard in an extracted module passes after teardown. `ctx` and `canvasEl` fail
 * at both ends — copied before `init` they are `null` forever, copied before
 * `dispose` they outlive the device — and `archetypeById` is `setEntityCatalog`'s
 * version of the `table` story.
 *
 * So: a thunk is not defensive boilerplate around a value, it is the difference
 * between reading the host's state and reading a photograph of it. When a
 * member moves between `const` and `let` in the host, it moves sides here, and
 * the compiler makes every consumer say so.
 */
export type HostSubstrate = {
  // --- frozen bindings: `const` in the host, safe to hold ------------------
  /** The live field: chunk grids keyed by chunk key. Mutated in place by every
   *  apply and by the loader; never replaced, not even by a world reset. */
  readonly store: field.FieldStore;
  /** The op log behind undo/redo and the bake — the host's `log`. */
  readonly log: field.OpLog;
  /** Chunk keys owing a remesh. The host drains it a bounded number per frame,
   *  so a module that adds to it is scheduling work rather than doing it. */
  readonly dirty: Set<string>;
  /** The remesh/preview worker pipe. Spawns lazily on first request, which is
   *  why holding it costs nothing before anything is meshed. */
  readonly worker: FieldWorkerClient;
  /** Per-chunk GPU render state, keyed by chunk key. */
  readonly chunkMeshes: Map<string, ChunkRender>;
  /** The advisor's findings store (walkability flags, pits, verdicts). */
  readonly flagStore: FlagStore;
  /** How a context is requested — `gpu.requestContext` in production, a stub in
   *  tests. A `const` because it is resolved once from `createFieldHost`'s
   *  `deps`, unlike the context it produces. */
  readonly requestContext: typeof gpu.requestContext;
  /** Per-class lit materials keyed `c<classId>` (surface) / `b<classId>` (kit
   *  backing). REBUILT from `table` on a table swap — by clearing and refilling
   *  this map, which is exactly why the map may travel by value while the table
   *  it is derived from may not. */
  readonly litByClass: Map<
    string,
    { mat: material.Material; bind: binding.Binding }
  >;
  /** The committed prop layer: one instanced draw per archetype. An ARRAY, not
   *  a map — rebuilt by emptying it in place (`length = 0`) and re-pushing. */
  readonly propMeshes: PropRender[];
  /** Stamp-preview ghost meshes, one entry per previewed chunk. */
  readonly ghostMeshes: Map<string, { m: mesh.Mesh; g: geometry.Geometry }[]>;
  /** The void cast (X-ray) layer's meshes — a `ghostMeshes` sibling, one entry
   *  per cast chunk. */
  readonly voidCastMeshes: Map<
    string,
    { m: mesh.Mesh; g: geometry.Geometry }[]
  >;

  // --- live reads: `let` in the host, ALWAYS a call ------------------------
  /** The project's resolved material table. A call because `setMaterialTable`
   *  replaces it wholesale; see this type's own TSDoc for what a snapshot costs. */
  readonly table: () => field.MaterialTable;
  /** The entity catalog indexed by archetype id. A call because
   *  `setEntityCatalog` rebuilds the map rather than editing it. */
  readonly archetypeById: () => ReadonlyMap<string, EntityArchetype>;
  /** The GPU context, or `null` before `init` and after `dispose`. */
  readonly ctx: () => Context | null;
  /** Whether the host has been torn down. A snapshot taken when a cluster is
   *  constructed reads `false` forever, which is precisely the answer that makes
   *  every `if (disposed) return` guard wave the teardown through. */
  readonly disposed: () => boolean;
  /** The bound canvas, or `null` while unbound. */
  readonly canvasEl: () => HTMLCanvasElement | null;
};

/**
 * Assembles a {@link HostSubstrate}. Returns `deps` unchanged.
 *
 * An identity function on purpose. What it buys is a single named place where
 * the host states the split — the compiler checks that every member is present
 * and on the correct side, and a `let` handed over as a value fails to compile
 * at the assembly site instead of going wrong months later at the read site.
 *
 * Nothing is validated, frozen or copied, and adding any of that would be a
 * mistake rather than hardening: there is nothing left to validate once the
 * types check, and every value-side member is deliberately the host's own
 * object — the shared identity IS the contract, so defending it from mutation
 * would break the thing it is for.
 *
 * @param deps - The sixteen members, thunks included.
 * @returns `deps`. Never fails.
 */
export function createHostSubstrate(deps: HostSubstrate): HostSubstrate {
  return deps;
}

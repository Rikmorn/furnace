// The standing reconfigure-drift report: the downstream ops a replay could not
// re-land, and which committed entities they touch. The eleventh cluster lifted
// out of `createFieldHost`.
//
// A RESULT SLOT, NOT A PRODUCER, and that is the whole reason this row looked
// unextractable. The closure map says it outright (§3.3): *"all three writes to
// `drift` come from other clusters (`stamp`, `history`, `world`); nothing in the
// `drift` cluster writes it."* A cluster whose state is written only by its
// neighbours has no obvious home — the instinct is to leave the `let` where four
// writers can reach it and call the arrangement shared.
//
// The instinct is wrong, and the map's own §3.3 wording is what says why: THE
// READERS DECIDE. There are exactly two, and both are this module's — the panel
// seam (`FieldHost.subscribeDrift`) and the payload builder that shapes what the
// seam pushes. Nothing outside reads the findings at all; the four writers each
// write and then ask for a push. So the state travels with its readers and the
// writers get a two-verb seam, which is what {@link Drift.set} and
// {@link Drift.notify} are.
//
// WHY THOSE ARE TWO VERBS AND NOT ONE. Every write site in the host settles state
// FIRST and notifies LAST — the field-host ordering rule, which exists because a
// subscriber is free to call back into the host during delivery. The machine's
// reconfigure apply writes the report in the middle of a longer settle and pushes
// at the end of it; folding the pair into one `setAndNotify` would move that push
// forward past state the same apply had not finished writing. `MachineDeps` says
// so at its own `setDrift`, and this seam keeps the shape rather than arguing with
// it.
//
// AND WHY {@link Drift.standing} EXISTS FOR ONE CALLER. Three of the four clears
// are unconditional and one — `stepHistory`'s — is guarded on the report being
// non-null, so an already-clean history step does not publish. That is not
// incidental: `ViewChannel.publish` has no change detection (by design, see its
// header), so an unconditional clear on every undo would push `null` to the panel
// on every keystroke of a ⌘Z run. The guard is behaviour, so it needs a read, so
// the seam has one. Collapsing it into an "only publish on change" rule inside
// `set` would silently change the other three sites.
//
// THE LAW, applied (see `substrate.ts`'s doc header for the argument): the only
// substrate member read is `store`, on the VALUE side — a `const` in the host,
// mutated through the identity it hands over. Nothing here reads a host `let` at
// all, so this module's single named dep is a plain function.
//
// NO UNIT TEST, by the house pattern eight extractions old: the argument is
// `tests/field-host/field-machine.test.ts`'s header and is not re-made here. The
// host suites passing UNMODIFIED across this move ARE this module's contract —
// `tests/field-host-history.test.ts` and `tests/field-host-session-params.test.ts`
// between them drive every one of the four writers.
import * as field from "@furnace/core/field";
import type { FieldDriftReport } from "./field-host.ts";
import type { HostSubstrate } from "./substrate.ts";
import { createViewChannel } from "./view-channel.ts";

type Vec3T = [number, number, number];

/** What the drift report needs from the rest of the host.
 *
 *  One entry beside the substrate, which is what a pure result slot costs: the
 *  report is plain data, and the only thing it cannot derive from itself is which
 *  entities its findings land on. */
export type DriftDeps = {
  /** The host's shared state. One member is read: `store`, for the cell size the
   *  chunk-box arithmetic is in metres of. */
  substrate: HostSubstrate;
  /** Every committed entity's footprint box, memoized against the log. Read at
   *  PUSH time rather than at write time — see {@link Drift.notify}. */
  entityFootprints(): Map<number, { min: Vec3T; max: Vec3T }>;
};

/** The drift report's slot, its panel seam, and the two verbs its four writers
 *  share.
 *
 *  The findings themselves are never exposed. What leaves is the PAYLOAD, through
 *  the channel — a clone plus the derived entity ids — because a report is data
 *  the palette keeps and a caller holding the host's array would be holding
 *  something `set(null)` is about to strand. */
export type Drift = {
  /** Replace the standing report (`null` = none). Called by the reconfigure
   *  apply, by a history step, by a world reset and by the panel's dismiss.
   *  Writes only — see this module's header for why the push is separate. */
  set(next: field.DriftFinding[] | null): void;
  /** Push the current report to the panel.
   *
   *  The touched-entity set is recomputed HERE rather than stored beside the
   *  findings, because the FOOTPRINTS can move under a standing report (a
   *  reconfigure re-splices a span; the report survives) — deriving at push time
   *  is what keeps the badge pointing at the geometry as it currently is. */
  notify(): void;
  /** Whether a report is standing. ONE caller, `stepHistory`, whose clear is the
   *  only conditional one of the four — see this module's header. */
  standing(): boolean;
  /** {@link FieldHost.subscribeDrift}. Snapshots on subscribe (the remount rule:
   *  a panel arriving after a reconfigure must not drop its report). */
  subscribe(cb: (report: FieldDriftReport | null) => void): () => void;
};

/** Build the drift report over one host's dependencies. One per host; it holds
 *  that host's standing report and the panel channel for its lifetime. */
export function createDrift(deps: DriftDeps): Drift {
  // The last reconfigure's drift report (null = the last apply was clean, or
  // none has run).
  let drift: field.DriftFinding[] | null = null;

  // Which committed entities the findings TOUCH — the palette's drift badges.
  //
  // Driven from the FINDINGS, not from the entities, and that direction is the
  // whole cost model: a report holds a handful of ops each naming the chunks it
  // wrote, so this is (findings × chunks × entities) box tests with NO string
  // allocation at all. The other direction — enumerate each entity's chunk box and
  // look each key up — allocates a key per chunk of every footprint, which grows
  // with the cube of region size and is unbounded in a way findings are not.
  //
  // The overlap test reproduces chunk-box membership exactly rather than
  // approximately: a box covers chunk `c` iff `floor(min/dim) <= c <= floor(max/dim)`,
  // and those two are `c·dim <= box.max` and `(c+1)·dim > box.min` respectively —
  // half-open on the high side, which is how a chunk owns its span.
  const driftedEntities = (
    findings: readonly field.DriftFinding[],
  ): number[] => {
    const boxes = deps.entityFootprints();
    const dim = field.CHUNK_DIM * deps.substrate.store.cellSize;
    const hit = new Set<number>();
    for (const finding of findings)
      for (const key of finding.chunks) {
        const [cx, cy, cz] = field.parseChunkKey(key);
        const lo: Vec3T = [cx * dim, cy * dim, cz * dim];
        for (const [entityId, box] of boxes) {
          if (hit.has(entityId)) continue;
          if (
            lo[0] <= box.max[0] &&
            lo[0] + dim > box.min[0] &&
            lo[1] <= box.max[1] &&
            lo[1] + dim > box.min[1] &&
            lo[2] <= box.max[2] &&
            lo[2] + dim > box.min[2]
          )
            hit.add(entityId);
        }
      }
    return [...hit];
  };

  // Cloned like the session: a drift report is plain data the palette keeps.
  const driftPayload = (): FieldDriftReport | null =>
    drift === null
      ? null
      : { findings: structuredClone(drift), entityIds: driftedEntities(drift) };

  // Snapshot for the remount rule: a subscriber arriving after a reconfigure
  // must not drop its report.
  const driftChannel = createViewChannel<[FieldDriftReport | null]>({
    snapshot: () => [driftPayload()],
  });

  return {
    set: (next) => {
      drift = next;
    },
    notify: () => {
      driftChannel.publish(driftPayload());
    },
    standing: () => drift !== null,
    subscribe: (cb) => driftChannel.subscribe(cb),
  };
}

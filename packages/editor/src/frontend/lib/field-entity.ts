// The committed-entity policy the host and the chrome must agree on, in ONE
// place. Pure predicates over a GeneratorEntity's state flags — no engine
// values, so it unit-tests without a GPU and (the load-bearing part) the CHROME
// may value-import it.
//
// Direction matters: this lives under `frontend/lib/` and the HOST imports it,
// the same way it already imports field-brush.ts. The reverse — parking it in
// `viewport-host/` and importing it from a component — is forbidden by the
// project-first invariant (`tests/frontend-no-engine-leakage.test.ts` rejects
// any chrome value-import whose specifier contains `viewport-host`, because the
// barrel carries core), and would be caught by that test rather than by review.
import type { GeneratorEntity } from "@furnace/core/field"; // type-only: erased

/**
 * Why a committed entity cannot open a reconfigure session, or null when it
 * can. ONE spelling of the rule, because two consumers act on it in ways that
 * must never disagree: the entities row uses it to DISABLE its Open button, and
 * the host uses it to REFUSE the session (prefixing `entity <id> is …`). Split,
 * a third blocking state would enable a button the host silently rejects.
 *
 * The phrasing is written to read correctly in both — as a button tooltip on
 * its own, and as the tail of the host's `entity 7 is …` report.
 *
 * Both flags are `true`-or-ABSENT core-side (absent is the only spelling of
 * "not set"), so the tests read presence and never `=== false`. Baked wins:
 * baking clears `frozen`, so the two cannot both be set, and if they somehow
 * were, the permanent state is the one worth naming.
 */
export function openBlockedReason(entity: GeneratorEntity): string | null {
  if (entity.baked === true) return "baked — its recipe was severed";
  if (entity.frozen === true) return "frozen — unfreeze it to edit";
  return null;
}

/**
 * Why a committed entity cannot be DELETED, or null when it can — core
 * `deleteGeneratorEntity`'s two refusals, in the vocabulary of a button tooltip.
 *
 * Unlike {@link openBlockedReason} the HOST does not read this: core throws its
 * own sentence and `FieldHost.deleteEntity` passes that through to the tool-error
 * seam verbatim, which is the better message when the row's own state was stale.
 * So this is strictly the chrome's mirror of a core rule, and the thing that
 * keeps the two honest is the pair of tests either side — the row asserting a
 * DISABLED 🗑 here, and the host suite asserting core's message reaches the seam.
 *
 * Baked wins over frozen, for {@link openBlockedReason}'s reason (baking clears
 * `frozen`, so the two cannot both be set, and the permanent state is the one
 * worth naming) — core's own delete checks frozen first, which is the same
 * decision under a different order because the states are mutually exclusive.
 */
export function deleteBlockedReason(entity: GeneratorEntity): string | null {
  if (entity.baked === true)
    return "baked — its ops are plain history now, not a span to remove";
  if (entity.frozen === true) return "frozen — unfreeze it to delete";
  return null;
}

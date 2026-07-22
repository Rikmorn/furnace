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

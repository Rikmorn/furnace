// The committed-entity policy the host and the chrome must agree on, in ONE
// place. Pure predicates over a GeneratorEntity's state flags — no engine
// values, so it unit-tests without a GPU and (the load-bearing part) the CHROME
// may value-import it.
//
// Direction matters: this lives under `src/shared/` — the neutral layer BOTH
// arrows may point at — and the host and the chrome each import it downward, the
// same way they both import field-brush.ts. The reverse — parking it in
// `field-host/` and importing it from a component — is forbidden by the
// project-first invariant (`tests/frontend-no-engine-leakage.test.ts` rejects
// any chrome value-import whose specifier reaches UNDER `field-host/`, because
// the barrel carries core), and would be caught by that test rather than by
// review. "Reaches under", not "contains": the rule is anchored to the directory
// boundary, so the chrome-internal `frontend/lib/field-host-mirrors.ts` — which
// merely starts with the same characters — is deliberately not caught by it.
// That same test also scans `src/shared/` itself, with no exemptions, which is
// what keeps the "no engine values" claim above a fact rather than a promise.
import type { GeneratorEntity } from "@furnace/core/field"; // type-only: erased

// ——— AUTHORITATIVE rules — the host imports these and ACTS on them ———————————
//
// One spelling, two actors. Splitting any of these would let the UI enable a
// control the host silently rejects.

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

// ——— MIRRORS of CORE rules — chrome-only, and NOT what refuses ———————————————
//
// Everything below this line is a different KIND of thing from `openBlockedReason`
// above, and the difference matters enough to be visible at the export site rather
// than only inside a docblock: the host does not import any of them. Core owns
// each of these refusals, throws its own sentence, and `FieldHost` passes that
// sentence through to the tool-error seam verbatim — which is the better message
// precisely when a row's state was stale enough to offer the button at all.
//
// So these exist to DISABLE a control early, never to decide anything. The
// obligation that comes with that: each one has to keep agreeing with a rule it
// does not own. What holds them honest is a test either side — the row asserting
// the disabled control here, and `tests/field-host-entity-verbs.test.ts` asserting
// core's own message reaches the seam. A mirror that drifts shows up as a live
// button that reports instead of a dead one, which is a degradation, not a break.
//
// Baked wins over frozen throughout, and the two can never both be set anyway
// (`bakeGeneratorEntity` clears `frozen`); where core checks frozen first, that is
// the same decision under a different order.

/** Why a committed entity cannot be DELETED, or null when it can — core
 *  `deleteGeneratorEntity`'s two refusals in the vocabulary of a button tooltip.
 *  A MIRROR (see the banner above). */
export function deleteBlockedReason(entity: GeneratorEntity): string | null {
  if (entity.baked === true)
    return "baked — its ops are plain history now, not a span to remove";
  if (entity.frozen === true) return "frozen — unfreeze it to delete";
  return null;
}

/** Why a committed entity cannot be FROZEN or unfrozen, or null when it can —
 *  core `setGeneratorFrozen`'s one refusal. A MIRROR (see the banner above). */
export function freezeBlockedReason(entity: GeneratorEntity): string | null {
  return entity.baked === true
    ? "baked — its recipe was severed, so there is nothing left to protect"
    : null;
}

/** Why a committed entity cannot be BAKED, or null when it can — core
 *  `bakeGeneratorEntity`'s one refusal. A MIRROR (see the banner above). */
export function bakeBlockedReason(entity: GeneratorEntity): string | null {
  return entity.baked === true
    ? "baked — its recipe is already severed; there is no second bake"
    : null;
}

// ——— row formatting ————————————————————————————————————————————————————————

/** Renders one committed-entity param for display — schema-driven primitives
 *  (number/boolean/enum string); the object branch is a robustness fallback, not
 *  an expected shape.
 *
 *  Here rather than beside the `<dl>` that shows it, because it has TWO callers
 *  that must never disagree: the row renders through it, and the shell provider's
 *  `sameEntities` push guard COMPARES through it. What must not go stale is the
 *  string on screen, so the guard asks the renderer rather than re-deciding what
 *  "same param" means — and a hook reaching into `components/` for that would
 *  invert the layering, which is the reason it moved out of `EntitiesList.tsx`. */
export const formatParam = (v: unknown): string =>
  typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

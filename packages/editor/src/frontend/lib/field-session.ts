// How a live session is NAMED and TAGGED, in one place.
//
// Two surfaces say it at once — the top bar's session strip and the session card (D-13) —
// and they must not disagree about either half. The strip's own header put it plainly
// while it was the only reader: "a third spelling here is a third thing to keep in
// agreement with the card". This is the second reader arriving, so the two moved out
// rather than being copied.
//
// Pure and DOM-free, and it stays in `frontend/lib/` rather than following
// `shared/field-entity.ts` down a layer: the host has no use for it (both readers are
// chrome), and it type-imports the host barrel, which `src/shared/` — the layer BELOW
// viewport-host — must not name at all. The property it shares with field-entity.ts is
// the one that matters here: it value-imports nothing, so the chrome may use it without
// pulling the engine barrel into its bundle.
import type { StampSession } from "../../viewport-host/index.ts"; // type-only: erased

/** What a session is ABOUT, in the entity rows' vocabulary: `hall #3` once it owns a
 *  committed entity, the bare generator id while it has not created anything yet. The
 *  same spelling `entityName` gives the rows and the menu labels, so the strip, the card
 *  and the list all point at one object in one language. */
export function sessionName(session: StampSession): string {
  return session.entityId === null
    ? session.generator
    : `${session.generator} #${session.entityId}`;
}

/** The three states a live session can be in. A UNION rather than `string`, so a surface
 *  that maps tags onto anything (the card maps them onto its ⏎/Esc verb pair) fails to
 *  COMPILE when a fourth arrives, instead of silently rendering nothing for it. */
export type SessionStateTag = "STAMP" | "RECONFIGURE" | "MOVE";

/** The session's STATE as a surface tags it. Read off `mode` + `moving` rather than
 *  stored, because those two fields ARE the state — and the three tags are not cosmetic:
 *  they commit to different things (a new entity, a re-run of an existing one, a
 *  translation of one), which is why `⏎` reads "commit", "apply" and "drop". */
export function sessionStateTag(session: StampSession): SessionStateTag {
  if (session.moving === true) return "MOVE";
  return session.mode === "reconfigure" ? "RECONFIGURE" : "STAMP";
}

/** The pair of verbs that ends a session: what `⏎` does and what `Esc` does. */
export type SessionVerbs = { primary: string; secondary: string };

/** What `⏎` and `Esc` DO, per state — the ONE source, because three surfaces name them
 *  and a user working a stamp sees all three at once (the card, the session strip, and
 *  the status bar's keymap line).
 *
 *  Three pairs rather than two, and the STAMP row is the reason this is keyed on the tag
 *  rather than on `moving`. A stamp has no prior state, so "revert" over one promises a
 *  restoration there is nothing to restore — which is what two of the three surfaces said
 *  while they each re-derived the pair from `moving` alone, collapsing STAMP into
 *  RECONFIGURE. Keyed on `SessionStateTag`, a fourth state fails to compile here instead
 *  of quietly inheriting whichever branch happened to be the `else`. */
export const SESSION_VERBS: Record<SessionStateTag, SessionVerbs> = {
  STAMP: { primary: "commit", secondary: "discard" },
  RECONFIGURE: { primary: "apply", secondary: "revert" },
  MOVE: { primary: "drop", secondary: "revert" },
};

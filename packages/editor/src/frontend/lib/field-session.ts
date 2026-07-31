// How a live session is NAMED and TAGGED, in one place.
//
// Two surfaces say it at once — the top bar's session strip and the session card (D-13) —
// and they must not disagree about either half. The strip's own header put it plainly
// while it was the only reader: "a third spelling here is a third thing to keep in
// agreement with the card". This is the second reader arriving, so the two moved out
// rather than being copied.
//
// Pure and DOM-free, in `frontend/lib/` beside `field-entity.ts` for the same reason: it
// type-imports the host (erased) and value-imports nothing, so the chrome may use it
// without pulling the engine barrel into its bundle.
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

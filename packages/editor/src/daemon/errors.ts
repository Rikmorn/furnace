/**
 * Closed union of editor-domain error codes. The domain speaks codes; each
 * transport edge owns its own mapping (HTTP today via `httpStatus`; future
 * MCP/agent bindings map the same codes at their edges). Codes are part of the
 * command contract — clients branch on code; messages are for humans.
 */
export type EditorErrorCode =
  | "invalid-input"
  | "invalid-json"
  | "unknown-command"
  | "not-found"
  | "outside-root"
  | "already-exists"
  | "forbidden-origin"
  | "no-session"
  | "session-timeout"
  | "internal";

const HTTP_STATUS: Record<EditorErrorCode, number> = {
  "invalid-input": 400,
  "invalid-json": 400,
  "unknown-command": 404,
  "not-found": 404,
  // Traversal reports 404, not 400: don't reveal whether anything exists
  // outside the project root.
  "outside-root": 404,
  // TWO OCCUPANCY CLASSES SHARE THIS CODE since foundations T4b, and the reader who
  // meets it on `session.claim` deserves the argument rather than a rediscovery. The
  // original meaning is a NAME ON DISK (`world.duplicate`/`world.rename` onto a taken
  // one); the second is a CLAIM IN MEMORY — the world is fine, what is taken is the
  // authoring right, and it evaporates when the holding tab closes. Both are "what you
  // asked for is already occupied; pick differently or displace", both are 409, and
  // the remedies (another name / `session.steal`) differ. A ninth code would have been
  // surface with no consumer that needs it: the DISAMBIGUATOR is the command, and every
  // caller has one in hand — `api.ts`'s `call` takes it as its first argument, and the
  // MCP door dispatches tool → command before any error exists. The same reasoning
  // `invalid-input` records for a malformed request target (`server.ts`'s `requestUrl`).
  // SPLIT IT the day a caller must tell the two apart WITHOUT knowing which command it
  // ran; nothing can today.
  "already-exists": 409,
  // A declared browser origin that is not this machine's loopback. 403, not
  // 404: unlike `outside-root` there is nothing to hide — the page already
  // knows the port answered, and the response is unreadable to it anyway
  // (no CORS headers). The code names the ORIGIN rather than the refusal so
  // it cannot be mistaken for a general "forbidden" a future auth check
  // would want. `origin.ts` throws it; see `assertLoopbackOrigin` for the
  // threat model and for why an ABSENT origin passes.
  "forbidden-origin": 403,
  // The caller named a session connection the daemon does not have (foundations T4b):
  // a token from a feed that has since closed, or one this daemon never minted.
  //
  // 409 RATHER THAN 404, decided against the `outside-root` precedent two rows up and
  // NOT by inheriting it. That row is 404 to hide EXISTENCE, and the question here is
  // what existence would be hidden: none. The command is real, the world is nobody's
  // secret, and the session in question is the caller's own — there is nothing here a
  // stranger could learn, and refusing to say would be the harmful direction, since
  // 404 already carries three meanings in this table (`unknown-command`, `not-found`,
  // `outside-root`) and a fourth would leave an agent unable to tell "no such command"
  // from "you hold no session". This code exists precisely so that call answers
  // discriminably and never hangs, which is the settled policy's own wording. 409 is
  // then the accurate one on the semantic axis: a conflict with the CURRENT STATE of
  // the target (RFC 9110 §15.5.10), which is exactly what an expired connection is —
  // the same reason `already-exists` is 409, and unlike a 404's "the thing you named
  // is not here", which would be a claim about the world rather than about the session.
  "no-session": 409,
  // The claimed editor session was asked something and did not answer inside the budget
  // (`daemon/backchannel.ts`, foundations T4b). It is the code that makes "a typed error,
  // never a hang" true for the one path where the daemon does not own the answer.
  //
  // 504 — THE FIRST STATUS IN THIS TABLE THAT DESCRIBES A RELATIONSHIP RATHER THAN A
  // REQUEST, and it is earned rather than borrowed: 504 is for a server "acting as a
  // gateway or proxy" that "did not receive a timely response from an upstream server"
  // (RFC 9110 §15.6.5), and the backchannel is the moment this daemon acquires an upstream
  // at all. Every other row answers about the request, the path or its own state; this one
  // answers about a browser tab the daemon is relaying to.
  //
  // Decided against three that look closer. 408 is the WRONG DIRECTION — it says the
  // CLIENT was too slow to send its request, which would send an agent off to speed up
  // something that was never late. 500 is `internal`'s own row and would be a lie about
  // blame: a timeout is a stated outcome with a remedy (the tab is busy, gone or blocked;
  // ask again, or check the editor), not an uncaught error, and the two differ on whether
  // retrying is sensible — the half a client actually branches on. 409 would inherit
  // `no-session`'s reasoning without its premise: nothing here conflicts with the daemon's
  // state, the session exists and is claimed, it simply did not speak. Keeping the two
  // apart is the point — "the session is gone" and "the session is silent" have different
  // remedies, and an ask that loses its connection deliberately answers with the FORMER.
  "session-timeout": 504,
  internal: 500,
};

/** An editor-domain error: a contract `code` plus a human-readable message. */
export class EditorError extends Error {
  readonly code: EditorErrorCode;
  constructor(code: EditorErrorCode, message: string) {
    super(message);
    this.name = "EditorError";
    this.code = code;
  }
}

/** The HTTP edge's status mapping for an editor error code. */
export function httpStatus(code: EditorErrorCode): number {
  return HTTP_STATUS[code];
}

// packages/editor/src/shared/wire.ts

/**
 * The backchannel's two frames — and the **first contract in this editor that both sides
 * IMPORT rather than mirror by hand** (foundations T4b).
 *
 * WHAT THE BACKCHANNEL IS FOR, since the shape only reads as necessary once that is said:
 * the daemon cannot compute what an agent wants to know about a live editing session.
 * Every fact but the project root and the worlds on disk — selection, tool, gesture,
 * camera, stats, history — lives behind a mirror the CHROME holds, in the other bundle.
 * So an agent-facing read is a QUESTION the daemon relays to the claimed connection and an
 * ANSWER it correlates back: the daemon is a relay with a correlation table, never a
 * reader. These two types are that protocol, and they are the whole of it.
 *
 * WHY THE FOURTH BOUNDARY CONTRACT IS THE FIRST SHARED ONE. Three already cross this
 * boundary and each is a HAND-MIRROR: `WorldRow` (`daemon/worlds.ts` ↔ `frontend/lib/api.ts`),
 * `ServerEvent` (`daemon/events.ts`'s `DaemonEvent` ↔ `frontend/lib/events.ts`) and
 * `EVENT_TYPES` (mirrored against nothing but prose until this same commit gave it a
 * type-level pin). They stay hand-mirrored: retrofitting them is a mechanical change to
 * four files that buys nothing this tranche needs, and the two that matter are already
 * pinned by `tests/events.test.ts`. Filed with its trigger at
 * `docs/backlog/editor-and-tooling/wire-contracts-are-hand-mirrored.md`.
 *
 * This one is shared rather than mirrored because it is the one where a drift is INVISIBLE
 * in both directions at once: a request the chrome cannot parse produces no answer, which
 * the daemon reports as a timeout — a sentence about the session's speed for what is
 * actually a shape disagreement. The other three fail loudly (a missing world column
 * renders `undefined`) or are pinned.
 *
 * WHY `shared/` IS THE RIGHT FLOOR, and it is not merely the only directory both sides can
 * reach. The two leakage suites already scan it and hold it **React-free, engine-free and
 * zod-free** — the binding cases by name, since each suite's rules are declared far from the
 * walk that applies them to this directory: *"shared/ imports no React — the neutral floor
 * stays neutral"* (`tests/no-chrome-leakage.test.ts`) and *"shared/ carries no engine — the
 * neutral layer stays neutral"* (`tests/frontend-no-engine-leakage.test.ts`, whose
 * `FORBIDDEN` set is where the zod half rides in)
 * — which is exactly the property a daemon-facing module needs, from the other end: the
 * daemon is Node-portable (`AGENTS.md`'s shipping contract) and must never pull React or
 * the engine. Two rules written for opposite reasons meet on the same floor. This module
 * holds TYPES ONLY, so every import of it is erased and neither side takes a runtime edge
 * on the other at all.
 *
 * It is also `shared/`'s first DAEMON-facing member — the others (`catalog.ts`,
 * `field-brush.ts`, `action-table.ts`, `tool-registry.ts`, …) are chrome↔host. The layer
 * arrow `frontend/ → { field-host/, action-registry/ } → shared/` (editor-architecture §7)
 * is unchanged by that: the daemon is a fourth reader ABOVE the floor like every other, and
 * `shared/` still imports nothing above itself.
 */

/**
 * A question the daemon is relaying to the claimed editor session.
 *
 * `requestId` IS THE CAPABILITY, and that is why `session.answer` needs no connection
 * token while every other `session.*` command does. It is a `randomUUID` written INTO one
 * connection's SSE stream (`daemon/events.ts` argues the same structure for the token
 * itself), so holding one means holding that stream; it names exactly one pending ask; and
 * the daemon deletes it the instant an answer claims it, so it is one-shot. A token would
 * add a second name for a fact this string already carries.
 *
 * `method` is a name in the CHROME's answerer registry, which the daemon cannot enumerate
 * — the two live in different bundles and a tab can be older than the daemon serving it.
 * So an unrecognised method is a real state, not a defensive one, and it is answered
 * rather than ignored: see {@link SessionAnswer}'s error arm.
 *
 * `params` is `unknown` because this type is the ENVELOPE. Each method owns its own
 * argument shape, and putting a union of them here would make every new method a change to
 * the file both bundles import.
 */
export type SessionRequest = {
  requestId: string;
  method: string;
  params: unknown;
};

/**
 * What the claimed session says back — a discriminated union, because **the error arm is
 * what makes "a typed answer, never a hang" true for the half the daemon cannot police.**
 *
 * Without it, a method the chrome does not serve would simply produce no answer, and the
 * ask would sit until its timeout and then report a TIMEOUT: a claim about how fast the
 * session is, for what is actually "this tab does not know that word". An agent told the
 * first thing retries with a longer wait forever; told the second, it reloads the tab.
 *
 * `error` IS PROSE, NOT A CODE, and the split is deliberate: `EditorErrorCode` is the
 * daemon's wire contract (`daemon/errors.ts` — "the domain speaks codes; each transport
 * edge owns its own mapping"), and the chrome is not one of its throwers. Letting the
 * chrome mint codes would put a second author on a closed union it cannot even import.
 * So the chrome supplies the SENTENCE and the daemon decides the code — the same division
 * `daemon/claims.ts` already keeps, where the table answers in plain values and the handler
 * layer decides which contract code each answer earns.
 */
export type SessionAnswer =
  | { requestId: string; ok: true; payload: unknown }
  | { requestId: string; ok: false; error: string };

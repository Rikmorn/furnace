---
summary: The closed `EditorErrorCode` union, its HTTP status table, and the agent-door edge that maps every code to a remedy.
verified: 2026-08-18
---

# The error contract

`packages/editor/src/daemon/errors.ts` defines a **closed string-code union**
`EditorErrorCode`. Codes are the contract — clients branch on `code`; the human-readable
`message` is for display only. **Each transport edge owns its own mapping.**

Wire shape on every error: `{ "error": { "code": "<EditorErrorCode>", "message": "<human text>" } }`.

## The HTTP edge

`httpStatus(code)` is the mapping, over the exhaustive `HTTP_STATUS` record — so adding a
member to the union is a compile error until its status is stated.
`packages/editor/tests/errors.test.ts` restates the whole table independently.

| `EditorErrorCode` | HTTP status | Meaning |
| --- | --- | --- |
| `invalid-input` | 400 | zod validation of a command's input failed — or the request target does not parse as a URL (`server.ts`'s `requestUrl`). One code, because both mean "the client sent something this daemon will not accept"; a malformed target earns no new contract surface. |
| `invalid-json` | 400 | the request body is not valid JSON (`server.ts`, at the route boundary). |
| `unknown-command` | 404 | no handler for the command name. |
| `not-found` | 404 | the named world does not exist or has no manifest; also `server.ts`'s no-route fallback for an unsupported method/path. |
| `outside-root` | 404 | a resolved path escapes the project root. *(404, not 400 — don't reveal what exists outside root.)* |
| `already-exists` | 409 | **two occupancy classes**: the write would clobber something already there (`world.duplicate` / `world.rename` onto a taken name), OR the world is already claimed by another live editor session (`session.claim`). Both mean "what you asked for is occupied; pick differently or displace"; the remedies differ (another name / `session.steal`) and the DISAMBIGUATOR is the command, which every caller has in hand. Split it the day a caller must tell the two apart without knowing which command it ran. |
| `no-session` | 409 | the caller named a session connection the daemon does not have — a token from a feed that has since closed, or one it never minted. It also answers an ask made with **no** claimed session, with **more than one** (there is then no single session to speak for), and one whose connection departs mid-ask. *(409, not 404: nothing is hidden here, unlike `outside-root`. 404 already answers `unknown-command`, `not-found` and `outside-root` in this table, and an agent must be able to tell "no such command" from "you hold no session" — this code exists precisely so that call answers discriminably and never hangs. 409 is also the accurate one: a conflict with the CURRENT STATE of the target, RFC 9110 §15.5.10.)* |
| `session-timeout` | 504 | the claimed editor session was asked something over the backchannel and did not answer inside the budget — `DEFAULT_ASK_TIMEOUT_MS`, chosen strictly under the 60 s per-request floor an MCP client cannot lower (`packages/editor/src/daemon/backchannel.ts`). **The budget is per method**: `ask()`'s third parameter is used by `viewport.capture` (`CAPTURE_ASK_TIMEOUT_MS`) because that ask makes the tab render and read back off the GPU where every other one reads a record it already holds. Both numbers sit under the same floor, for the same reason. *(504, and the only status here that describes a RELATIONSHIP rather than a request: a gateway that "did not receive a timely response from an upstream server", RFC 9110 §15.6.5 — the backchannel is where this daemon acquires an upstream. Not 408, which says the CLIENT was slow to send; not 500, which is `internal`'s row and would misplace the blame and the retry semantics; not 409, since nothing conflicts — the session exists and simply did not speak. "The session is gone" and "the session is silent" have different remedies, which is why a departed connection answers `no-session` instead.)* |
| `forbidden-origin` | 403 | the request declared an `Origin` that is not this machine's loopback (`packages/editor/src/daemon/origin.ts`, called ahead of every route — [daemon](daemon.md)). *(403, not 404 — unlike `outside-root` there is nothing to hide: the page already knows the port answered, and no CORS headers are sent, so the body is unreadable to it anyway.)* |
| `internal` | 500 | any other uncaught error at the route boundary. |

**The code names the FACT, not the status.** `forbidden-origin` says which fact was refused
(the origin) rather than which status HTTP chose, so another binding maps it without
inheriting `403`, and a general `forbidden` stays free for a genuinely different refusal
class.

## The agent-door edge

`packages/editor/src/daemon/mcp.ts`'s `AGENT_REMEDY` is `httpStatus`'s sibling and is what
"each transport edge owns its own mapping" was written for: an exhaustive
`Record<EditorErrorCode, string>`, so a code added to the union is a compile error until this
edge has said what to do about it too.

A throw out of `dispatch()` becomes an `isError: true` tool result whose text is
`<code>: <the daemon's message>` followed by **what the AGENT should do** — whether retrying
is sensible, and whether a human has to move first. That second half is the part no
daemon-side message is written for: the messages are addressed to a human reading an error
envelope, and an agent needs to know that `no-session` will not change until someone opens a
tab (so do not poll), that `session-timeout` is worth one retry, and that `internal` is not
worth any.

`isError` rather than a JSON-RPC error, deliberately — "no editor is open" is an answer and
must reach the agent's model, not its error handler. A name that was never advertised
(`session_claim`, `field_load`) is the opposite case and is refused as a protocol error.

### Which codes actually reach that edge

Exactly these, and the derivation lives at `AGENT_REMEDY` where the next person to add a row
will read it:

- `no-session` and `session-timeout` — the backchannel's own refusals, and the reason
  `AGENT_REMEDY` exists;
- `internal` — a chrome that could not serve the method, and a genuine daemon fault alike;
- `invalid-input` — **schema refusals only**, since `action.run` holds no deny-list.

The rest are stated because the union is CLOSED, not because they are merely unlikely, and
each is unreachable for its own reason:

- `not-found` / `outside-root` / `already-exists` are thrown by world, bake and claim
  commands, none of which is projected. The near miss is `action_run` reaching
  `world.makeDefault` — but through the CHROME's own HTTP client, so the code is thrown one
  bundle away and arrives here as a relayed `ActionResult` rather than as this edge's throw.
- `invalid-json` is thrown parsing an HTTP body, which the MCP transport reads for itself.
- `forbidden-origin` is refused ahead of the route branch, so no tool call is running when it
  is thrown.
- `unknown-command` is **structurally** unreachable: `createMcpDoor` resolves every row's
  command against the registry when the door is BUILT, so a table naming a command the
  registry lacks fails at startup and no tool call can be in flight to discover it.

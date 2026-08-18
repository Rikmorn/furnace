---
summary: The SSE broadcaster and its event table, the session claim and connection token, and the one directory the daemon watches.
verified: 2026-08-18
---

# The change feed and the session claim

## The SSE change feed

`packages/editor/src/daemon/events.ts` is the SSE broadcaster. Events are
**notification-only dirty-bits** — there is no payload protocol beyond the event itself; a
consumer refetches whichever command owns the changed state (`world.list` on
`worlds-changed`), so a slow consumer naturally coalesces N changes into one refetch. Each
subscriber gets a 15 s heartbeat comment (`: ping`); the heartbeat interval is `unref`'d so it
never holds the process open.

**The last three events are ADDRESSED rather than broadcast**: they are written to ONE
connection through `hub.emitTo`, because a broadcast token would hand every tab the name of
every other tab's connection, a broadcast `claim-lost` would blank the tab that just WON the
world, and a broadcast `session-request` would have N tabs answer one question — N−1 of them
about a session nobody asked about, with the first answer to arrive winning. Everything else
about them is identical: the same generic frame, the same `ServerEvent` arm, the same
`EVENT_TYPES` row.

| Event `type` | Payload fields | Emitted when |
| --- | --- | --- |
| `bundle-outdated` | none beyond `type` | a source file under the extensions entry's directory changed (below) — the browser should reload to pick up the freshly-rebuilt `/engine.js`. |
| `generation-baked` | `files` (count written) | `generation.bake` wrote the browser-uploaded file set to the project root ([commands](commands.md)). |
| `worlds-changed` | none beyond `type` | the worlds directory or its index changed — `world.delete` / `rename` / `duplicate` / `makeDefault` each raise it AFTER their FS mutation succeeds. Consumers refetch `world.list`. |
| `session-token` *(addressed)* | `token` | **the first frame every subscriber gets** — the name the daemon minted for this connection, which `session.*` commands echo back. |
| `claim-lost` *(addressed)* | `world` (`string \| null`) | another session stole the world this connection was authoring. Only the displaced connection receives it. |
| `session-request` *(addressed)* | `requestId`, `method`, `params` | the daemon is relaying a question to the claimed session and expects a `session.answer` POST back (`packages/editor/src/daemon/backchannel.ts`). The **only arm both sides import rather than mirror** — it composes `SessionRequest` from `packages/editor/src/shared/wire.ts`. |

The SSE wire frame is `event: <type>\ndata: <json>\n\n` — every event rides it generically.
The frontend `ServerEvent` union and `EVENT_TYPES` subscription list
(`packages/editor/src/frontend/lib/events.ts`) mirror this daemon union, and **both halves
are compile-time pinned** in `packages/editor/tests/events.test.ts`: the unions against each
other (mutual assignability), and `ServerEvent["type"]` against `EVENT_TYPES`. The second
closes a hole where an arm added to both unions but not to the subscription list type-checks,
ships, and silently never arrives, because an `EventSource` delivers only the names it was
asked for. `packages/editor/tests/chrome/session-answer.test.tsx` reds on the same gap at
runtime.

**There is no file watching.** The daemon watches exactly one thing, a directory.

## The session claim, and the connection token

`packages/editor/src/daemon/claims.ts` is a `Map<ClaimKey, ServerResponse>` — at most one
connection per world, at most one world per connection, a partial bijection. The commands
live in `packages/editor/src/daemon/session-handlers.ts`, their own module on the daemon's
existing convention (`worlds.ts`, `claims.ts`, `bundle.ts`, `origin.ts` are each one
concern): `handlers.ts` is the filesystem verbs, nothing there touches connection identity,
and nothing in the session module touches a file. `createHandlers` merges the map it returns.
`server.ts` wires the table to the hub in two lines: `hub.onClose(conn => claims.release(conn))`
and `claims.onDrop((conn, world) => hub.emitTo(conn, { type: "claim-lost", world }))`.

**The world key is `string | null`.** `null` is the untitled scratch a fresh editor boots
into, mirroring the chrome's own world name, which is never prefilled by design. It is a KEY
rather than an absence, because the commonest session in the editor's life — a user digging
before they have named anything — must be claimable, or an agent could never reach a fresh
editor at all. Two untitled tabs then contend for the same key, which is the policy's own
answer: they cannot both be the session an agent drives.

**No grace period across a reconnect, because none is needed** — measured rather than
assumed: the daemon notices a departure ~3.5 ms after the socket dies and the browser's
automatic re-subscribe arrives ~3.0 s later, so the claim simply drops and the reconnecting
tab re-claims and wins. What IS structural is that `release(conn)` is
**identity-conditional** — an entry is dropped only when its holder IS that connection —
because a new subscribe can land ~52 ms before an old close, and an unconditional release
would let a reloading tab's late close revoke the claim its own new connection had just taken.

### The connection token

A POST and the SSE stream are different HTTP requests, so a command acting for *this*
connection needs a way to say which one it is. The hub mints an opaque `randomUUID` inside
`subscribe`, writes it as the stream's first frame (`session-token`), and resolves it back to
the `ServerResponse` by live-table lookup. It rides the **body**, not a header, because
`dispatch()` has exactly one input channel by design and a header would carry a transport
assumption into the module built to outlive its transport.

*What the token is NOT*: authentication. The daemon binds loopback and serves one local user
([daemon](daemon.md)); the question a token answers has N equally legitimate answers, one per
open tab — *which* of my subscribers are you, never *may* you. A leaked token grants exactly
what a second tab already has. It is not a second thing to steal either, on the origin
module's own threat model: obtaining one means reading a response body, the rebinding page
cannot open this stream (403 before `subscribe` is reached) and could not read it if it did
(no CORS headers). **An MCP client can never present one**, structurally rather than by a
check: the mint is written into the stream it opens, so holding a token means holding that
stream, and the `/mcp` door never routes there. Guests, not claimants.

### Departure is watched on both halves of the exchange

`res.on("close", …)` **never fires under Bun** (1.3.14, measured by raw socket destroy,
`fetch` abort and reader cancel alike; Node 22 fires it in 2–5 ms). Both `edit` scripts start
this daemon with `bun`, so a `res`-only liveness signal is a silent no-op in the live editor.
`req.on("close")` fires on **both** runtimes within 2 ms, and on neither while a client is
still connected. `subscribe` watches both halves, latched so one departure is announced once.
Pinned in `packages/editor/tests/claims.test.ts` (the request half alone releases; one
departure, one announcement) and end-to-end in `packages/editor/tests/server.test.ts` (a
hang-up frees the world for the next connection, with no steal — the case that pins
`server.ts`'s own wiring).

### A lost tab never claims again

`onToken` returns early while the claim-lost flag is set, and the case is routine rather than
exotic: after a steal, the daemon restarts (every source change in the `bun run edit` loop
does that) or the stream blips, `EventSource` reconnects **both** tabs, and the daemon has no
memory of who lost what — so without the guard the covered tab re-claims and may win the
race. It would then HOLD the claim while displaying "another editor session took over" and
suppressing its own keyboard: an agent driving "the session" wired to a tab the human cannot
operate, and the tab the human is actually in refused and steal-prompted. The early return is
what makes the cover's own sentence true — *reload to claim it back*, a reload being the one
thing that legitimately produces a fresh tab with no memory of having lost.

### Chrome side

`packages/editor/src/frontend/hooks/useSessionClaim.ts` claims on the **token frame**, not on
`onOpen`: the token arrives as the stream's first frame, so at open there is nothing to
present yet. `onOpen` keeps the one job it can honestly do — forget the dead connection's
token, so no POST goes out carrying a name the daemon has already dropped. A refusal opens
the steal prompt through the existing `useConfirmDialog`; losing the claim raises
`packages/editor/src/frontend/components/ClaimLostOverlay.tsx`, a full-viewport cover no
gesture dismisses whose one control is a reload.

**True read-only mode is NOT built** — that narrowing of the settled policy ("a second tab
gets read-only or an explicit steal") is deliberate and filed at
`docs/backlog/editor-and-tooling/read-only-chrome-for-an-unclaimed-session.md`.

**The cover is the whole enforcement of that narrowing, so it has to be terminal in all three
channels.** None of the three is free:

- **It outranks the portalled layer.** React mounts into `#root`; every Radix overlay portals
  to `document.body`, a sibling AFTER it — so at equal `z-50` a confirm prompt paints *over*
  the cover. The cover declares `z-[60]`, one step above the control library's whole layer,
  and `packages/editor/tests/chrome/session-claim.test.tsx` derives that maximum from
  `packages/editor/src/frontend/components/ui/` rather than hard-coding it, so a library-wide
  raise reds instead of silently going over the top.
- **It suppresses the keyboard.** A full-viewport layer stops a pointer by existing; the
  window keydown listener is on the WINDOW and never saw one, so ⌘K, ⌘S, ⌘Z and every tool
  letter would keep dispatching behind it — ⌘K's palette being itself a portalled dialog,
  i.e. the first bullet in action. `useGlobalKeybindings` takes a third ref (`claimLostRef`)
  and returns before it matches anything. A ref **of its own**, not `confirmRef`: that one
  also feeds `ctx.isConfirmOpen()` into the gate env, so reusing it would make a claim-lost
  refusal answer `because: "modal"` — false in the refusal vocabulary. It short-circuits
  BEFORE the funnel rather than refusing through it, because a refusal speaks through the
  toast stack, which renders inside the canvas cell — behind the cover, where nobody can read
  it. Nothing is prevented, matching what a modal-refused key already does. Pinned in
  `packages/editor/tests/chrome/keybindings-dom.test.ts`, with its control case.
- **It traps focus.** The third channel, and the one neither of the above touches: **tab
  order follows DOM order and z-index does not affect it.** `<Shell />` stays mounted behind
  the cover with real buttons in the top bar and status bar, so Tab off "Reload" walked into
  the shell and ⏎ invoked that button's own `onClick` — not a keybinding, so the window guard
  cannot see it. The cover installs a capture-phase `focusin` listener that hands focus back
  to its one control: a bounce, which is what a focus scope is. Pinned by a case that MOVES
  focus, with a control case proving the trap is not always on — `aria-modal` is a
  declaration and happy-dom implements no `inert` semantics, so a pin written against either
  would pass while the hole stayed open. The residue is named at the source:
  `aria-modal="true"` is the only thing telling assistive tech to ignore the rest of the
  document; there is no `inert`/`aria-hidden` enforcement, because marking the shell subtree
  means either a wrapper element around `<Shell />` (against its own layout contract) or a
  component mutating its siblings.

## Directory watching

`packages/editor/src/daemon/watch.ts` defines the `WatchDir` capability —
`(dir, onChange) => unwatch` — and its production adapter `chokidarWatchDir`: a **chokidar v4
recursive watch** over `dir` (`node_modules` and `/dist/` paths ignored), firing `onChange` on
any `add`/`change`/`unlink` beneath the tree (chokidar's `"all"` event, settled by
`awaitWriteFinish`). It is **injected** — `server.ts` takes an optional `watchDir` in
`ServerOptions` for tests to fake, defaulting to the real `chokidarWatchDir` in production, so
chokidar timing never gates a test.

`server.ts` wires this to close the inner-loop staleness gap ([bundling](bundling.md)): when
`config.extensions` is set, it watches `dirname(resolve(root, config.extensions))` — the
consumer's extensions-entry directory — and on any change emits
`hub.emit({ type: "bundle-outdated" })`. That emit is the whole of the callback; there is no
daemon-side registry to invalidate.

The chrome's handler is `packages/editor/src/frontend/hooks/useDaemonFeed.ts`, and its guard
is a world write in flight, not a dirty document: a hard reload is the only way to pick up the
new bundle and it would kill an in-flight upload, so the reload is refused while
`bakeBusyRef` is set (the shell's world verbs hold the ref for the duration of the upload)
and taken otherwise.

## The chrome reduces the whole feed to three things

`useDaemonFeed` is the ONE place in the chrome that reads an event `type`, and what it produces
is:

- a **`worldsVersion` counter** bumped on `worlds-changed` / `generation-baked` — a version
  rather than a payload, because those events are notification-only dirty bits. Anything
  rendering the world list refetches on it ([world](world.md)).
- the **hard reload** a stale engine bundle needs (`bundle-outdated`), refused while a world
  write is in flight (above).
- the two **addressed** frames (`session-token`, `claim-lost`) routed into a `SessionFeed` of
  named handlers, plus `session-request` handed to the answerer, so the claim's POLICY lives in
  `useSessionClaim` while the type dispatch stays here.

**The reduction is EXHAUSTIVE**, and that is worth stating rather than assuming: every arm of
the daemon's event union reaches one of the three, so there is no feed member the chrome quietly
ignores. Adding a seventh event without a branch here is the failure this claim exists to make
visible.

Both `bakeBusyRef` and the `session` handlers are in the effect's dep list, so **both carry a
STABILITY rule** — and the cost of breaking the second is worse than the first's: a re-subscribe
mints a new connection token and re-claims.

It is a hook rather than App-local state for the shell's reason ([chrome](chrome.md)): a feed
wired inside App is a feed no test can drive, because App owns the WebGPU probe and the
`/engine.js` import.

**There is nothing to catch up on at `onOpen`** — the editor mirrors no daemon-owned document;
the field world lives in the host until the user saves it. What a (re)connect DOES mean is that
the previous connection's token is dead, and forgetting it is the one honest job that seam has.

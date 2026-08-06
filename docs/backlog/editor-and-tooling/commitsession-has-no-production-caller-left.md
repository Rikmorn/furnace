# `FieldHost.commitSession` has no production caller left, and three comments still say otherwise

`commitSession` — "end the live session with whichever verb its MODE calls for" — is a public
`FieldHost` member with **zero production call sites repo-wide at head**. The only callers
anywhere are two assertions in `packages/editor/tests/field-host-move.test.ts` (:317, :400).
Three comments in `field-host.ts` still describe it as live — two naming a caller that no
longer exists, one claiming a contract it does not have:

- `field-host.ts:776` (in the member's TSDoc, :774–782) — "A panel commit button is this, and
  so is the app-level ⏎".
- `field-host.ts:5398–5399` (over `commitActiveSession`) — "Public as `commitSession` — the
  panel's button calls THIS rather than re-deriving the same mapping from the session it
  mirrors."
- `field-host.ts:917` (in `beginMove`'s TSDoc) — a move opens a session with "{@link
  commitSession} as its terminal verb". Not a caller claim but a CONTRACT claim, and it
  contradicts `commitSession`'s own TSDoc at `:781` ("A live MOVE is the one case this does
  NOT cover — {@link confirmSession} is the verb for that"). Both cannot be right; `:781` is
  the one that matches the code.

The first two are plainly false. The app-level ⏎ is `session.confirm` → `confirmSession` (the
registry's `run`, `frontend/lib/actions.ts`), and the session card's footer routes there too —
`SessionCard.tsx`'s `onConfirm={() => fieldHostRef.current?.confirmSession()}` — because the
button wears the ⏎ keycap and must mean what the key means. `chrome/session-card.test.tsx`
(:348–352) pins exactly that, `commitSession` explicitly NOT called.

## Context

Found during foundations T3b2 Task 1, which trimmed four never-called members off the three
extracted field-host cluster seams (`VoidCast.destroy`, `VoidCast.apply`,
`Props.proxyGeometry`, `StatsMeter.currentLogStats`). This is the same "provably-dead
member" class one layer up — on the `FieldHost` facade rather than on a cluster seam — and it
was left alone deliberately, for two reasons the cluster four did not have.

**It is behaviour-bearing, not a pass-through.** `commitActiveSession` carries the
mode→verb mapping (`commitStampSession` for a stamp, `applyReconfigureSession` for a
reconfigure) and is called internally; only the FACADE member is dead. Deleting the member
is cheap, deleting the function is not.

**The split with `confirmSession` was a design decision, and it is documented as one**
(`field-host.ts:5412–5419`): `confirmSession` adds `dropMove`'s zero-step rule and the
pending-preview latch, and the two are kept apart so a filed defect in one cannot silently
change the other. Retiring `commitSession` means deciding whether that separation still earns
its keep now that nothing outside the host asks for "end by mode" — which is a design
question, not a trim.

The two stale comments are the cheaper half and could go on their own. They were not fixed
in T3b2 Task 1 because `field-host.ts` was outside that commit's touched set and a comment
correction that leaves the underlying question open is the kind of half-move this register
exists to hold.

## Trigger to revisit

The next task that opens `field-host.ts`'s session block for any reason — T3b2's later tasks
do not, but the `setTool` seam conversion and any further cluster extraction would. Take the
two comment fixes unconditionally at that point; take the deletion only if the session-verb
pair is being reconsidered anyway. A second trigger: anything that gives `commitSession` a
caller again, which would make this entry moot and should be noted rather than left.

## Reference

- `packages/editor/src/field-host/field-host.ts` — `commitSession` (member :783, facade
  impl :6896), its TSDoc :774–782 with the false sentence at :776, `beginMove`'s
  contradicting terminal-verb claim at :917, `commitActiveSession` :5400 with the stale
  comment above it :5398–5399, and the deliberate-split note at :5412–5419. (Line numbers
  measured at `d9ade3f0`; grep the names if they have moved.)
- `packages/editor/src/frontend/components/shell/SessionCard.tsx` — `onConfirm`, the button
  that the stale comments claim calls `commitSession`.
- `packages/editor/src/frontend/lib/actions.ts` — `session.confirm`'s `run`.
- `packages/editor/tests/chrome/session-card.test.tsx` (:348–352) — the pin that
  `confirmSession`, not `commitSession`, is the button's verb.
- `packages/editor/tests/field-host-move.test.ts` (:317, :400) — the only callers left.

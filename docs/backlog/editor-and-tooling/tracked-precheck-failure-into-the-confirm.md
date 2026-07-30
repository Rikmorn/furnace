# Route a tracked-precheck failure INTO the overwrite confirm

`saveWorld` (`packages/editor/src/frontend/lib/world-actions.ts`) reads `world.list`
before every write to find out whether the target world is tracked, because D-21 requires
an explicit confirmation before overwriting one. Today a failure of that pre-check
**refuses the save** — "save refused — could not check whether worlds/<n> is tracked
(<why>); nothing was written".

## Context

Three behaviours were on the table when the guard shipped (F4.5a Task 8):

1. **Degrade to indeterminate** — treat a failed check as `tracked: null` and write
   anyway. Rejected: `null` already means "no git repo / ambiguous answer", so a daemon
   hiccup would silently become a bypass of the one guard standing between a scratch
   session and the world the game loads. A safety check that disappears when the system
   is unhealthy is the wrong shape.
2. **Fail loud** (shipped) — refuse, and say the write did not happen. Endorsed at review:
   `world.list` and `generation.bake` cross the SAME transport, so the dominant failure
   mode (the daemon is down) would have failed the bake a moment later anyway. Refusing
   costs approximately zero availability in that case.
3. **Escalate into the confirm** — on a failed check, open the overwrite prompt with the
   uncertainty named: *"Couldn't verify whether worlds/<n> is tracked — overwrite
   anyway?"*, and write only if the user says yes.

(3) strictly dominates both: it keeps the user's ability to save through a partial
outage (which (2) takes away) while never writing over a possibly-tracked world without
consent (which (1) does). It was not shipped because it is not a message change — it adds
a **fourth outcome status** to `SaveOutcome` (`needs-unverified-confirm`, distinct from
`needs-tracked-confirm`: different copy, different meaning, and the caller must not
collapse them), plus its own routing branch in `useWorld`'s `write()`, plus its own
confirm copy and tests. That is design surface, and the case that motivates it has never
been observed.

The narrow window (2) actually costs anything in: `world.list` fails while
`generation.bake` would have succeeded — a permissions/`readdir` problem confined to
`worlds/`, or a daemon partially degraded. Real, but unobserved.

## Trigger to revisit

The first time the fail-loud refusal bites a real session — i.e. someone hits "save
refused — could not check whether worlds/<n> is tracked" while the daemon is otherwise
working. That report is the evidence the narrow window is real, and it should be taken as
sufficient on its own; no second occurrence needed.

## Reference

- `packages/editor/src/frontend/lib/world-actions.ts` — `saveWorld`'s pre-check block
  (its own `try`, separate from the write-path catch) and the `SaveOutcome` union.
- `packages/editor/src/frontend/hooks/useWorld.tsx` — `write()`, which routes
  `needs-tracked-confirm` into the App-owned prompt; a fourth status lands beside it.
- `packages/editor/tests/world-actions.test.ts` — "a world.list failure fails the save
  rather than silently dropping the guard" is the case that changes.
- D-21 (the overwrite-confirm requirement) in the F4.5 charter.

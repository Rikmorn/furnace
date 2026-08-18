---
summary: The editor's verbs as Node-importable rows — the descriptor table, the gate's caller split, and `ActionResult`, the one refusal vocabulary every surface and the agent door share.
verified: 2026-08-18
---

# The action registry

**The editor has one action registry** (D-10/D-11/D-12), written in two halves that join by id.

`packages/editor/src/action-registry/` holds the DATA per action, so a process with no DOM can
hold the table. `packages/editor/src/frontend/lib/actions.ts` holds the four closures a row
cannot — `label`, `enabled`, `checked`, `run` — and joins them onto those rows exhaustively and
at compile time.

The directory is five files: `descriptors.ts` (the table), `keys.ts` (bindings and keycaps),
`result.ts` (the refusal vocabulary), `schemas.ts` (the input schemas), and `index.ts`.

## The table

```sh
bun -e 'const {ACTION_DESCRIPTORS} = await import("./packages/editor/src/action-registry/index.ts"); console.log(ACTION_DESCRIPTORS.length)'
```

`ActionDescriptor` carries **eight** data fields: `id`, `group`, `keys?` (the binding as a
`KeyBinding` row), `hint?`, `gate?`, `armsTool?`, `flyLetter?` and `mcpProjection?`.

Two fields a reader may look for are deliberately not on it:

- **The display chord is DERIVED** from the binding (`keycap()`, read through the chrome's
  `capOf`) rather than stated beside it. What that replaces is a `keys: "⇧⌘S"` string on every
  row, declared beside a matcher it had to agree with by review.
- **There is no `input` field.** The schema is looked up by the same id in
  `ACTION_INPUT_SCHEMAS`, so there is one home for it rather than a field that could only ever
  be populated elsewhere. The type says so at its own declaration.

`inertHint` is not a descriptor field either — it lives on the chrome's `ActionBehavior`,
because it is prose about a live context.

`ACTION_DESCRIPTORS` is declared `as const satisfies` and exported widened, which is two
statements about one array: the literal tuple gives `ActionId` (the union of every id), and the
widened export keeps `hint` readable without narrowing. The chrome's behavior table is
`{ readonly [Id in ActionId]: ActionBehavior<Id> }` — so a descriptor with no behavior and a
behavior with no descriptor are both COMPILE errors, where the join they replace was a runtime
`find` that threw at module init.

## The layer

`action-registry/` may value-import `@furnace/core` and `shared/`; it may import React, the DOM,
`field-host/` or `frontend/` not at all. It sat BESIDE `field-host/` under the chrome until
`field-host/` began holding the refusal vocabulary, and it now sits **beneath** it. The full
layer arrow and the bundling consequences are [bundling](bundling.md)'s.

Five rules hold the arrow, split across two guard files **by mechanism rather than by subject**,
so each stays provable the way its file proves things:

| Rule | Where | How |
| --- | --- | --- |
| no React | `tests/no-chrome-leakage.test.ts` | specifier scan |
| nothing out of `frontend/` | same | specifier scan |
| nothing out of `field-host/` | same | specifier scan — the upward half of a one-way arrow |
| the chrome may not VALUE-import `schemas.ts` (nor bare `zod`) | `tests/frontend-no-engine-leakage.test.ts` | that file's value-import rules, which already know `import type` is erased |
| `field-host/` may import `result.ts` from here **and nothing else** | `tests/no-chrome-leakage.test.ts` | capturing scan — the answer needed is *which* specifier, not *whether*, so a boolean ban could not express it |

The fourth is that file's rule because it is that file's *reason*: `schemas.ts` is licensed to
value-import core (an action that takes input carries a zod schema built from core's `z`
re-export — the single-instance contract), so a chrome VALUE-import of **it** would pull zod and
behind it core into the main bundle, arriving by a fourth door. The last rule names the FILE, not
the barrel, so `schemas.ts`'s zod stays unreachable from the host's graph even if the barrel
widens; the barrel is covered by construction, since `index.ts` re-exports the schema module's
TYPES only and there is no value edge for a chrome import to follow.

**The DOM half is not a regex, and could not usefully be one** — `KeyboardEvent` in a type
position is erased, and `window`/`document` are ordinary English words in files this dense with
prose. `tests/action-registry/node-door.test.ts` imports the module in a bare runtime instead,
three times, each in a fresh spawned child: by absolute path to the barrel, by the
`@furnace/editor/action-registry` bare specifier (the daemon's actual route in), and by absolute
path into `schemas.ts`, which the barrel deliberately does not value-re-export and which is the
only module here whose graph reaches outside the package. All three doors were
sabotage-verified — a module-scope `document.title` fails them, and removing the export-map
entry fails the second alone.

**One check in that file is not a proxy.** Every rule above is a specifier scan, and that file
says in its own words that it deliberately does not chase `await import(…)`. So it also BUILDS
the chrome module that value-imports the registry — one `Bun.build` of one module, targeting the
browser — and asserts zod's runtime class names are absent from the output, with a positive
marker first so an empty build cannot pass. Sabotage-verified with a DYNAMIC import of
`schemas.ts` planted in `descriptors.ts`: invisible to every regex in the file, caught here.

`packages/editor/package.json` carries two `exports` entries, `./field-host` and
`./action-registry`; the daemon bundles from the CONSUMER's root, so it names editor modules by
bare specifier.

## Bindings are data

Five `KeyBinding` kinds — `chord`, `bare`, `shifted`, `char`, `named` — and one pure
`matchBinding(binding, facts)`. The facts are `{ key, mod, shift, alt }`: four, not five, because
`e.key` IS the produced character for a printable press and the key's NAME otherwise, which is
exactly the distinction `char` and `named` draw, so carrying it twice would be two fields to keep
equal. **The dispatcher is the only place a `KeyboardEvent` is read.**

The union's one real axis is **what each kind does about ⇧**. `chord`/`bare`/`shifted` state it
(that is what makes ⌘Z and ⇧⌘Z two actions); `char` cannot, because the character is what the
layout produced and which modifier produced it is the layout's business; `named` does not read
it. `char` and `named` reach the same ⇧-indifferent predicate and are still separate kinds,
because `{ kind: "named", keys: ["?"] }` would read as a claim that `?` is a key name, which is
the thing `char` exists to deny.

**⇧ is accepted everywhere a key is matched by NAME** — ⇧⌫ deletes, uniform with ⏎ and Esc (user
decision, 2026-08-07). The `ShiftPolicy` field that had preserved two silently-disagreeing
policies is gone; the declarative table forced the question, the user answered it, and only then
did the schema simplify. The decision is pinned in keycaps at
`tests/action-registry/descriptors.test.ts` and in the unit half at `tests/action-registry/keys.test.ts`.
`char` still has no policy field for its own LAYOUT reason: pinning ⇧ up would kill `?` on a
layout that puts it unshifted, and pinning it down would kill it on the one this editor is
developed against.

Rows that carry a binding also carry a gate, and the two sets are asserted identical. Derive:

```sh
bun -e 'const {ACTION_DESCRIPTORS} = await import("./packages/editor/src/action-registry/index.ts"); console.log(ACTION_DESCRIPTORS.filter(d=>d.keys).length)'
```

`tests/action-registry/descriptors.test.ts` pins the shape half — keyed ⟺ gated, unique ids,
unique caps, the MCP-projection membership — plus **at most one action claims any press**, over a
cross-product of keys against every modifier combination, with the canvas keys claiming none.

## Input schemas

Six rows take an object input; the rest are bare. Derive:

```sh
bun -e 'const m = await import("./packages/editor/src/action-registry/schemas.ts"); console.log(Object.keys(m.ACTION_INPUT_SCHEMAS).length)'
```

They are `world.saveAs` and `world.makeDefault` (`{name}`), `edit.duplicate` / `edit.delete` /
`edit.grab` (`{entityId}`), and `tool.stamp` (`{generatorId}`).

**Six, not twelve — the axis views take their input from their own ids.** Six actions that a
naive worklist counts as needing input are the axis views, and they carry no schema: their axis
and sign ARE the id, so a `{axis, sign}` schema on `view.snapNegZ` would let a caller hand it
`x` and make the id a lie. What they carry instead is `mcpProjection`, and they are its whole
membership — the six project onto one `view.snap {axis, sign}` agent-door tool while the chrome
keeps six literal greppable ids.

**Every row is `z.strictObject`.** Two doors into one editor had two postures — every daemon
command REFUSES an undeclared key, these rows STRIPPED one — and the stripping half is the worse
half because it is indistinguishable from success. The conversion happened at the trigger that
mattered: the moment these ids became agent-reachable.

**Every field inside an input is REQUIRED and the whole input is optional**, which is the
chrome/agent split expressed once: `InputOf<Id>` admits `undefined`, so a chrome surface
dispatches a verb with nothing and each run falls back to what the ctx has selected, while a
caller that names a verb must name its object too.

One asymmetry is worth knowing: **`edit.delete` REFUSES an `entityId` that is not the selected
one**, because its confirm names the generator and counts the ops and both come off
`ctx.selectedEntity` — the only entity the chrome can describe. Duplicate and Grab need the id
alone and take any. It is pinned so a later reader does not "fix" the asymmetry.

**Where the input typing does and does not reach.** The DECLARATION site is checked — the
behavior table is keyed by `ActionId` and each row's `run` states its own `InputOf<Id>`, so
`edit.duplicate` reading a `generatorId` does not compile. The DISPATCH site is not: `runAction`
types `input` as the widened union, so handing an action another action's input compiles and
degrades to the ctx fallback. A generic was tried and does not close it — `byId` answers
`ActionDef` with `id: string`, so the id cannot be inferred at any call site the chrome writes,
and recovering it means making `ActionDef` generic everywhere it is held.

## `ActionResult` — the one vocabulary of refusal

```ts
type RefusalClass =
  | "modal" | "typing" | "looking" | "menuOnly" | "session" | "inert" | "member" | "input";

type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "refused"; readonly message: string; readonly because: RefusalClass }
  | { readonly ok: false; readonly kind: "failed"; readonly message: string };
```

**Eight arms, five of them the gate's.** Derive:

```sh
sed -n '/^export type RefusalClass =/,/;$/p' packages/editor/src/action-registry/result.ts | grep -c '^  | "'
```

- `modal`, `typing`, `looking`, `menuOnly`, `session` are the gate's.
- `inert` is the widest: it is the funnel's own verdict when the gate is OPEN and `enabled` is
  false, and it is also what a verb's own body answers when it finds nothing to act on — no world
  name, no selected stamp, no engine, no generators.
- `member` is about the REQUEST rather than the state: the member funnel takes an ID and resolves
  it against the family BEFORE gating, so an id nothing answers to is refused as a malformed ask
  rather than as a bad moment. It carries a LIST of what would have worked, which is what keeps
  it distinct from `input`.
- `input` — *the ARGUMENT was wrong, and the world is fine* — is the counterpart to `inert`:
  where that one says *change the state and ask again*, this says *ask again differently*.

The vocabulary is pinned as a `Record<RefusalClass, …>`, so a class with no route producing it
does not compile.

`result.ts` sits below the chrome precisely so non-chrome callers can hold the vocabulary — the
agent door's write verbs answer an `ActionResult` ([agent-door](agent-door.md)). A host-local
result type converted in the chrome verb was the alternative, and it is the
second-name-for-a-subset the file argues against.

### Three provenances, never a doubled toast

This is why there are two non-`ok` kinds rather than one:

1. **The host's** — `reportToolError` → `subscribeToolError` → a toast. Not actions, and they did
   not move. A verb that hands off to the host returns `{ ok: true }` on the hand-off; the host
   answers for itself, later, on its own channel.
2. **The world seam's** — the world-actions module composes and says its own save and load
   sentences (*"bake failed: ENOSPC"*). Same shape as the host's, one layer up.
3. **The action's** — the Result, said out loud exactly once by the funnel.

`refused` is a verdict the action itself reached that nobody has said yet, so the funnel says it
with `notify.error` — the same call, in one place, that used to sit inside the verb. `failed` is
an error a layer below already surfaced on its own channel, so the funnel stays quiet and the
Result carries it to a caller who is not looking at the screen. **The sabotage that proves it:**
make the say step speak `failed` too and the no-double-toast case reddens.

**A throw out of ANY run is surfaced rather than thrown past the dispatcher**, and that is the
whole of what `failed` means. Before the funnel a run that threw took its listener with it: a
sync throw out of the keydown handler, and an unhandled rejection once the world verbs became
async. The funnel catches it, returns `failed`, and — uniquely among `failed` results — SAYS it,
because this is the one no layer below has voiced.

## The funnels

`runAction(def, ctx, env, input?, onClaim?)` is **gate → claim → `enabled` → run → say**. It is
the one funnel every surface dispatches a NAMED ACTION through.

`onClaim` fires the instant the gate ALLOWS and before `enabled` is consulted, because at that
point the key has been claimed: a disabled ⌘S must still suppress the browser's save-page
dialog. It is the global-keybindings hook's `preventDefault` seam and nothing else passes one.

`runMember(family, memberId, ctx)` is the sibling, for picking a member out of a tool family —
gated against the family's own arm action through the same shared sequence (`refuseOrClaim`),
voiced the same way, answering the same `ActionResult`, and synchronous because every member arm
is. It is a second way into an existing row, not a fourth provenance, which is why it needs no
descriptor row of its own. It takes an **ID** rather than a member object, so the funnel resolves
the member against the family it was handed rather than taking the caller's word that the pair
belongs together.

**No bare `member.arm` outside the funnel.** `tests/actions.test.ts` walks `src/` and asserts the
caller list is exactly the chrome's actions module — the file, deliberately, not `[]`, which
would pass just as happily with the funnel deleted. The instrument's limits are stated where it
lives: a source scan is a proxy, blind to a caller spelling the receiver differently and — since
definition and caller share a file — to a second caller added inside that file.

**A second scan holds the asymmetry's other half: `clickGate` has exactly ONE caller, the
display seam it feeds.** The env pin below catches the two envs COLLAPSING into one; it cannot
catch a THIRD reader appearing. `clickGate` is exported and asks the modal-blind render env, so
nothing structural stops a future surface writing `if (clickGate(def, ctx).ok) { …do it… }` and
getting an enforcement path that silently cannot see a modal — which is what every display call
site looks like one line before it dispatches. Same instrument, same stated limits.

`runNamedById` is the funnel that knows the whole table: it refuses an unknown id and names the
verbs that do exist, because a caller with no menu cannot see one.

## The gate

`gateAction` has two classes plus two per-action flags, and `clickGate` is its `caller: "named"`
reading for a pointer press on the same verb, so a button and its key refuse for the same reason
in the same words.

| Class / flag | When it may fire |
| --- | --- |
| `chord` | ⌘/Ctrl chords. Live everywhere **including inside a text input**, because the browser default they replace is worse. |
| `typed` | Every bare letter plus ⌫, Esc and ⏎. Refused when the focus is in a text input, and nowhere else. |
| `flyLetter` | Refused while the host is looking. Declared per action rather than per class — `S` / ⇧S are the whole membership, because the fly reader reads only w/a/s/d/q/e and a blanket rule would kill `R` and `F` mid-orbit for no collision at all. |
| `armsTool` | Refused while a session is live, **with a toast**, because a key that looks dead teaches the user it is dead. It is the one `spoken` refusal. |

A modal confirm suppresses every class. **"Text input" means TYPED TEXT ENTRY, not "focusable
form control"**: the predicate matches textarea, select, contentEditable and the textual `<input>`
types, and deliberately NOT `range`/`checkbox`/etc. Both directions of that line cost something
real — a matched slider makes bare-letter verbs dead on the control users drag while looking at
the field, and an unmatched `<select>` lets the Esc that dismisses its popup run the cancel ladder
and discard a live session.

### The caller split

`GateEnv` is a UNION discriminated by `caller`, and the third caller class it was never written
for is the agent. `clickGate` used to branch around the gate for menu-only actions and hard-code
"not in a text input" on the argument *"the user typed to find it and then named it"* — true of a
palette row, untrue of an agent.

| | `key` | `named` (menu / palette / rail / agent) |
| --- | --- | --- |
| modal confirm open | refuses | refuses |
| `armsTool` during a session | refuses, with the hint | refuses, with the same hint |
| no `gate` (menu-only) | refuses | **runs** — the rule is about keycaps, and a control has none |
| `typed` gate + in a text input | refuses | not asked |
| `flyLetter` + right button held | refuses | not asked |

The three key clauses live inside the `key` branch, so the two key-only facts are simply not
askable of a named call — there is no `false` left to write down and nobody has to justify one.
**The hard-code became unwriteable rather than relocated.**

### Two named envs, differing on exactly one clause

| | `namedDispatch(ctx)` | `NAMED_RENDER` |
| --- | --- | --- |
| asks | may this verb RUN, now? | how does this control LOOK, now? |
| callers | `runNamed`, `runMember` | `clickGate` → `controlVerdict` |
| confirm-open | `ctx.isConfirmOpen()` | `false`, by decision |

`isConfirmOpen` is a CALL on the ctx, not a boolean field, for the same reason the host's looking
predicate is: a modal goes up and down between renders, so a snapshot would answer for a frame
that has gone.

**The display path stays modal-blind on purpose**, and three things make that the right
asymmetry. (1) A modal is an ENFORCEMENT fact, not a display one: the confirm dialog is a Radix
dialog at its `modal: true` default, so while one stands every chrome control is behind an
overlay nobody can click — dimming them all would say nothing a user could act on. (2) It keeps
`controlVerdict` a pure function of memoizable ctx facts; a verdict that polled the modal could
survive its close and leave the rail visibly dimmed with nothing on screen explaining why.
(3) It makes "display behaviour did not move" a property rather than a coincidence.

**The consequence is that a control can render runnable while a dispatch of the same verb at the
same instant refuses.** That is invisible to a human (the overlay) and correct for an agent
(which is on the dispatch side), and it is pinned by name. **Enforcement lives in the funnels;
`clickGate` is not one and never was.**

### Every refusal carries a machine-readable reason

`GateVerdict`'s refusal arm is `{ ok: false; hint: string; spoken: boolean; because: RefusalClass }`.
It replaced `{ hint: string | null }`, where one absence had been doing two jobs — "say nothing"
and "there is nothing to say" — and the second was never true. The silent classes state their
sentences; `spoken` is the display policy.

`hint` is a non-nullable `string`, so a reasonless refusal is unwriteable rather than discouraged,
and there is no `?? def.label(ctx)` fallback behind it — the fallback that made an agent's "a
modal is open" refusal read `"Frame selection"`.

**The `message` is prose written for a toast and is free to be reworded, so the CLASS is the half
a caller may branch on.**

## The inert refusal names the enabling CONDITION

The one surviving label fallback was the INERT case, argued as *"the verb's own name IS the
honest reason, and no gate was consulted"* — and a live gate walk falsified it, an agent reading
`{because:"inert", message:"Move"}` off `edit.grab`: a refusal naming neither the missing
precondition nor a remedy.

`ActionBehavior` gained `inertHint`, the enabling condition as prose, and the arm is
`refused(def.inertHint ?? def.label(ctx), "inert")`. Derive the membership:

```sh
grep -c "inertHint:" packages/editor/src/frontend/lib/actions.ts
```

The rows without one spell `enabled: () => true` and **can never be inert** — most literally, the
rest through the shared axis-view factory the `view.snap*` rows are built from — so the label
stays the fallback rather than becoming dead prose. `tests/actions.test.ts` derives the inert set
from an empty ctx rather than listing ids, and also refuses a hint that merely REPEATS the label
— the fallback wearing a costume.

**`enabled` is `(ctx, input?)`.** Two verbs resolved `input?.entityId ?? ctx.selectedEntity` in
their run BODIES while `enabled` saw only the ctx — so a named request was refused as inert
before the body that would have honoured it, with the id in hand. The widening was user-ruled in
explicitly rather than deferred.

## Who owns a key

Two keydown listeners. The canvas keeps the keys that steer the viewport under the pointer — the
fly set, `[`/`]`, the arrow nudges, the momentary ⇧/⌃ — plus first refusal on ⌘Z, ⏎, Esc, R and
F. Everything else is the registry's, on `window`, which is the only listener that carries the
gates and the only one that still works after a palette click takes the canvas's focus.

Where both bind one key, the canvas branch that ACTS calls `stopPropagation`, and that call is
the whole licence for the second owner. `preventDefault` fires as soon as the gate ALLOWS an
action, *before* `enabled` is consulted. A REFUSED action prevents nothing, so the character the
user is typing still reaches their field.

**WASD/QE fly ONLY while the right button is held** (D-10, the Unity mechanism), and the gate
lives in the fly application rather than at the key handler because the key set still collects
w/a/s/d/q/e whatever the button is doing. That gate is what buys the bare-letter budget the
registry spends: `S` is fly-backward *and* the stamp family, and the button is what decides which.

The action context provider assembles the `ActionCtx` those predicates read and owns the ONE
window keydown listener. It is a PROVIDER rather than a hook the shell calls, and that is
load-bearing for render cost: assembling the ctx reads values that move on every op and every
drag frame, so doing it inside the shell body would rebuild the palette elements per pointermove.
The listener binds ONCE and reads the ctx through a ref written in an effect — a render React
discards must not leave its ctx behind as the one the next keypress acts on.

## Who renders from the table

Several chrome surfaces render from the registry, which is what stops a binding from being live
and undocumented or documented and dead: the window key dispatcher, the burger menu's
World/Edit/View groups, the shortcuts overlay, the ⌘K command palette (which renders the whole
table at once), the tool rail, the top bar, the status bar's selection-chip popover, and the
tooltip component that looks a keycap up by id so a tooltip cannot print a stale chord.

**The exact counts are derived, never typed.** Distinguishing importers from value-importers from
table-readers takes three different numbers, this file's predecessor had them wrong at every
re-count, and they moved again between then and now. Derive:

```sh
# importers of the chrome's action module, package-wide
grep -rlE 'from "[^"]*/actions\.ts"' packages/editor/src packages/editor/tests
```

Then separate value from type-only by reading each import statement — `import type` and inline
`type` specifiers are erased and are not table reads.

The `tool` and `session` groups are deliberately absent from the menu — arming a brush and ending
a session are the rail's and the viewport's, and the shortcuts overlay is where they are
discovered.

**One surface prints keycaps and does NOT derive them**, and it is not an oversight: the status
bar's keymap line, whose clauses spell their own keys as row text. It is a real duplication,
measured and adjudicated rather than assumed, and it is open because `keycap()` lives ABOVE the
floor those rows sit on — closing it would reverse the import arrow. Filed at
`docs/backlog/editor-and-tooling/status-line-respells-derived-keycaps.md`.

## What moved down, and what deliberately did not

`ActionGroup` and `ActionGate` **moved** into the registry rather than being duplicated and
pinned: they are types, so the chrome may type-import them. Only `ActionGroup` is re-exported
from the chrome's actions module, so its importers keep one import site; **`ActionGate`
deliberately is not** — it has no consumer outside the registry, and a re-export is one line on
the day one appears. That is the surface-membership rule applied rather than a barrel filled by
habit.

`ACTION_GROUPS` stays in the chrome: a group's title and render order are rendering facts, and it
is a value the chrome value-imports.

`shared/action-table.ts` sits BELOW the registry, so its own `ToolActionId` cannot use the
`ActionId` union and still resolves by throwing. It is module-private there — seven hand-written
literals — and that is the cost of the floor's position, stated rather than hidden.

## The registry's own invariants, and what enforces them

- **Cross-origin requests get 403.** The origin assert is the daemon route's first statement,
  ahead of every branch AND ahead of parsing the target ([daemon](daemon.md)). Coverage splits by
  question: a pure spelling table of admitted and refused rows, each carrying its reason; and the
  wiring, asserting the refusal on **every** route branch, because a check that had drifted into
  the POST branch would satisfy a POST-only suite. **Scope, restated because the code cannot
  enforce its own reading: this is DNS-rebinding defence, not client authentication.**
- **An invalid op in a group means nothing applies.** All three committing paths run
  validate-the-whole-list-then-apply, and pass 1 reads no store state, so a mid-list rejection
  leaves the store, the log, both stacks and the id counter untouched — and it NAMES the
  rejection, with the original on `cause`. **What it does not cover, on any of the three:** an op
  that VALIDATES and then throws out of the applier strands earlier ops' writes with no entry
  describing them. That is a store-rollback design decision, not a validation gap, and it stands
  open at `docs/backlog/engine-architecture/oplog-group-apply-is-not-a-transaction.md`.

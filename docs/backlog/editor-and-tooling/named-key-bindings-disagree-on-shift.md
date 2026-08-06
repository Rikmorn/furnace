# The three named-key bindings disagree about ⇧ — should ⇧⌫ delete?

The editor binds three actions to keys matched by NAME (⌫/⌦, ⏎, Esc). Two of them ignore ⇧
entirely; the third refuses it. Neither side says why. Foundations T3b2 **preserved both**
rather than picking, and this entry is the question it declined to answer.

## Context

The three matchers, as they stand at `packages/editor/src/frontend/lib/actions.ts`
(re-read the file rather than trusting these line numbers — the surrounding table moves):

| action | keycap | matcher | ⇧ held |
| --- | --- | --- | --- |
| `edit.delete` | ⌫ | `!mod(e) && !e.altKey && !e.shiftKey && (e.key === "Backspace" \|\| e.key === "Delete")` | **refused** |
| `session.confirm` | ⏎ | `!mod(e) && !e.altKey && e.key === "Enter"` | accepted |
| `session.escape` | Esc | `!mod(e) && !e.altKey && e.key === "Escape"` | accepted |

So today: **⇧⌫ and ⇧⌦ do nothing**, while **⇧⏎ commits a session** and **⇧Esc cancels one**.
All three are `gate: "typed"`, so all three are refused inside a text input regardless.

**The asymmetry is undocumented on both sides**, and that is the whole difficulty. This
codebase does document a deliberate shift-agnostic binding when it makes one: `?`
(`help.shortcuts`) spends eleven lines of TSDoc on why it reads no ⇧ — ⇧/ on a US layout,
⇧ß on a German one, ⇧, on a French one, *"what the user PRODUCED is a question mark"* — and
even files its AltGr residue to backlog. `edit.delete`'s `!e.shiftKey` carries no note at
all, and neither do ⏎ and Esc. The evidenced practice is that an intentional choice here
gets written down; none of these three was.

**What T3b2 did.** Task 3 turned every binding into data (`src/action-registry/keys.ts`).
Four of the five `KeyBinding` kinds have one ⇧ rule each; `named` needed two, so the union
carries a required `ShiftPolicy` field — `"up"` (⇧ must not be held) or `"any"` (⇧ is not
read). `edit.delete` states `"up"`; the other two state `"any"`. A 640-press cross-product
in `tests/action-registry/descriptors.test.ts` proves the rows reproduce the closures
exactly, with **zero** divergences, and a second case pins the two policies as data so
unifying them cannot happen as a side effect of a tidy-up.

That was the right call for a task whose contract was "no behaviour changes". It is not an
answer. A required field on a two-member union is the smallest honest way to say *the
source disagrees and we do not know which side is right* — it is not a design that wants to
survive forever.

**Why it is a real question, not bikeshedding.** ⌫ is the editor's one destructive keycap
(it deletes a committed stamp and the ops behind it — behind a confirm, and `⌘Z` puts it
back, but still). Whether a stray modifier should suppress it or be ignored is a genuine
product call, and the answer might go either way:

- **Tighten ⏎/Esc to `"up"`** — the ⌫ side becomes the house rule, and a modified press
  never reaches a bare-key verb. Costs: a user holding ⇧ can no longer cancel or confirm,
  and Esc is the universal escape hatch.
- **Loosen ⌫ to `"any"`** — the ⏎/Esc side becomes the house rule, matching what `?` does
  and what most editors do with Delete. Costs: ⇧⌫ starts deleting where it did nothing.
- **Keep both, and document each** — the status quo, but with the reasons written down, at
  which point this stops being a defect and becomes a decision.

Do not read the order above as a preference. It is the user's call.

## Trigger to revisit

Any of:

- **A fourth named-key binding is added** (Tab, Home, Delete-forward as its own verb, …).
  Its author has to pick a `ShiftPolicy` with no house rule to follow, which is the moment
  the cost of not having decided lands on someone.
- **A ⇧-modified named key produces a bug report** — "⇧Esc cancelled my session", "⇧⌫ did
  nothing", either direction.
- **Foundations T4 wires the descriptor rows into `useGlobalKeybindings`.** The rows become
  the live matchers there; nothing changes behaviourally (that is what the cross-product
  gate holds), but it is the last point at which both policies are still cheap to revisit
  in one place.

## Reference

- `packages/editor/src/action-registry/keys.ts` — `ShiftPolicy` and its note; `matchBinding`.
- `packages/editor/src/action-registry/descriptors.ts` — the three rows, with the comment on
  `edit.delete`.
- `packages/editor/tests/action-registry/descriptors.test.ts` — *"the three named-key
  bindings keep TWO ⇧ policies — preserved, not unified"*, the assertion that fails if
  someone tidies this away, and the 640-press equivalence beside it.
- `packages/editor/tests/action-registry/keys.test.ts` — the unit half, both policy values.
- `docs/reference/editor-architecture.md` §22.5 — the as-built for the layer and the finding.
- `packages/editor/src/frontend/lib/actions.ts` — `question`'s TSDoc, for what this codebase
  writes down when a shift-agnostic binding IS deliberate.

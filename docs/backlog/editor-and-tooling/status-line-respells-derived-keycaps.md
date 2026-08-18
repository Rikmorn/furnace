---
summary: ten of the status line's 27 distinct clauses lead with a keycap `action-registry/keys.ts` already derives from the binding row, and the direct fix reverses the editor's one-way import arrow — the other seventeen are canvas-owned and must not be swept in
---

# The status line spells ten keycaps the action registry already derives

`src/shared/action-table.ts` carries each row's status line as literal clauses — `"⌫ delete"`,
`"R rotate ¼"`, `"Esc clears"`, the `"⏎ "` lead-in. Ten of them lead with a cap that
`src/action-registry/keys.ts`' `keycap()` derives independently from the binding row. Edit a
binding and the menu, the tooltip and the shortcuts overlay all follow; the status bar does
not.

## Context

Foundations T3b2 Task 5 was asked to adjudicate this and reached verdict **(ii): a real
duplication of an owned fact**, not prose legitimately spelling its own keys. The verdict is
written into `action-table.ts` beside the `text()` helper; this entry is the deferred half.

**Measured at T3b2 Task 5 head** by walking `EFFECT_ROWS` (plus `deriveModifierParts`) +
`GESTURE_ROWS` (both `statusLine` and `readoutLine`) + both `TRANSIENT_STATUS` entries, and
matching each clause's lead token against every `keycap(d.keys)` in `ACTION_DESCRIPTORS`.
Re-run it rather than trusting these numbers.

**THE COUNTING RULE, because "distinct clause" is ambiguous and a first pass got it wrong:** one
entry per clause **as the table writes it** — a text fragment is its text, and a slot is its
lead-in plus the slot NAME, so a slot counts once however many values it can take. **38
occurrences, 27 distinct.** (Expanding `sessionSteer` to the two values `SESSION_STEER` can give
it would read 28; the first pass published 26, which is wrong under either rule — it collapsed
`sessionSteer` and `segmentMeasure` into one entry because both are slots with no lead-in.)

| lead cap | distinct clauses | the action that also derives it |
| --- | --- | --- |
| `Esc` | 4 — `Esc clears` · `Esc drops the point` · `Esc cancels` · the `Esc ` lead-in | `session.escape` |
| `⏎` | 1 — the `⏎ ` lead-in | `session.confirm` |
| `⌫` | 1 — `⌫ delete` | `edit.delete` |
| `G` | 1 — `G grab` | `edit.grab` |
| `F` | 1 — `F frame` | `view.frame` |
| `R` | 1 — `R rotate ¼` | `session.rotate` |
| `X` | 1 — `X swap` | `tool.swapEffect` |

(`Esc clears` is ONE distinct clause carried by three gesture rows — box, material and void —
which is why the occurrence count is higher than the distinct one.)

Ten of 27 distinct clauses. The other seventeen are NOT duplications and must not be swept in
with them: `LMB …` and `click ×2 …` name a mouse gesture rather than a key, and `[ ] radius`,
`⇧ smooth`, `⌃ dig` / `⌃ fill`, `← → ↑ ↓ nudge` and `drag ghost move` are canvas-owned keys
the registry does not carry at all. That split is exactly what the retired non-derivation
decision got half right (editor-architecture §22.2): it claimed the whole line was
canvas-owned vocabulary, and half of it is.

**Why T3b2 did not close it.** `keycap()` lives in `src/action-registry/`, which sits ABOVE
`src/shared/`. A value import from the floor into the registry reverses the editor's one-way
import arrow and `tests/no-chrome-leakage.test.ts` refuses it. Inverting a layer to
deduplicate ten single characters is the wrong trade.

## The shape that would close it, and what it costs

Give `StatusFragment` a third kind that names an ACTION ID and lets the CHROME resolve the
cap — `{ kind: "keycap", action: ToolActionId, gives: "delete" }`, rendered by the adapter as
`${capOf(byId(action))} ${gives}`. The arrow stays correct: the table already holds action
ids it cannot resolve (`FamilyRow.arm` / `.cycle`), and `tests/shared/action-table.test.ts`
already pins that they resolve in the registry.

The cost is the reason it is filed rather than done. `StatusFragment`'s own TSDoc makes the
two-kind count its whole claim — *"TWO kinds, and the count is the model's whole claim … There
is no third shape — no conditionals, no nesting, no formatting directives — which is what
makes a row's line readable as prose in the source."* A third kind is a deliberate retreat
from that, and it wants its own deletion pass: `ToolActionId` would have to widen past the
seven tool verbs to reach `edit.delete` / `view.frame` / `session.*`, which is most of the
registry arriving in the floor's type vocabulary. There may be a better answer (moving the
BINDING rows to `shared/` and leaving only the schemas above, for instance) and this entry
should not prejudge it.

## Trigger to revisit

Any of:

- **A binding in the table above changes its keycap** — the seven actions listed are the
  exposure, and `session.escape` is the one with four clauses riding on it.
- **A new status clause is written naming a key that HAS a binding.** Adding an eleventh is
  the moment the cost of not deciding lands on someone.
- **`action-registry/`'s layer is revisited** for any other reason — the MCP projection
  (T4/T5 of the foundations program) is the likely one, and moving the binding rows is only
  cheap while there is one consumer.

## Reference

- `packages/editor/src/shared/action-table.ts` — the verdict, beside `text()`; `EFFECT_ROWS`,
  `GESTURE_ROWS`, `TRANSIENT_STATUS` are the clauses.
- `packages/editor/src/action-registry/keys.ts` — `keycap()` and `NAMED_CAPS`.
- `packages/editor/src/action-registry/descriptors.ts` — the seven bindings.
- `packages/editor/tests/no-chrome-leakage.test.ts` — the arrow that forbids the direct fix.
- `docs/reference/editor-architecture.md` §22.2 — the full-derivation decision this is the
  residue of.

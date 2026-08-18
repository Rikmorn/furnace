---
summary: `ExactNumberInput` buffers the user's text and commits it on blur, and the form's capture-phase re-seed runs FIRST — so a push landing mid-edit leaves the input showing the incoming value while the row still prints a refusal about text nobody can see
---

# A buffered numeric input commits stale text when a push lands mid-edit

**Context.** `ExactNumberInput` (`packages/editor/src/frontend/inspector/fields/common.tsx`)
holds the user's TEXT in local state and commits it on blur — the buffered parse D-25 asks
for, and the reason clearing a bounded field never snaps it to 0. It has no way to learn
that the value underneath it was replaced while it was being typed into, so a blur commits
text the form has already superseded.

The sequence, reproduced this session (F4.5b Task 11's review round) while pinning the
re-seed fix:

1. Focus a bounded field and type an out-of-range value — say `99` on a `maximum: 24` param.
   `SchemaForm` refuses it: nothing is written, nothing previews, the row prints
   `must be at most 24`.
2. An external push arrives — a different entity's reconfigure, a ⚄ reroll, an undo, an SSE
   change. `SchemaForm` DEFERS the re-seed because an input has focus (the echo guard,
   `lib/echo-guard.ts`), which is correct: it must not clobber what the user is typing.
3. The user clicks away. React runs the form's `onBlurCapture` (capture phase, downward)
   BEFORE the input's own `onBlur` (bubble phase, upward), so:
   - the form re-seeds the drafts to the incoming values and drops the refusal, then
   - the input commits its buffered `"99"`, which is refused again.

**Observed end state: the input correctly displays the incoming `12` while the row still
prints `must be at most 24` — about text that is no longer anywhere on screen — and the
commit verb stays disabled naming a field that now holds a valid number.** That is the same
user-visible symptom as the re-seed bug fixed in Task 11, reached by a different mechanism,
which is why fixing that one did not close this.

**Why it was not fixed inline.** It fails two of the four inline-fix conditions: it needs a
design decision, and the decision changes a shared primitive's contract. The candidate
shapes, none obviously right:

(a) **Move the form's deferred re-seed from `onBlurCapture` to the bubble phase**, so the
input finishes its business first and the re-seed wins. One line, but it reorders the echo
guard against every field renderer, and a *valid* blur commit would then be immediately
overwritten by the re-seed it currently precedes — trading this bug for a lost edit.
(b) **Give `ExactNumberInput` a "my value was superseded" signal.** Honest, but it needs a
discriminator the component does not have: the incoming `value` changes on every preview the
component itself fires, so "the prop moved while I was focused" is true during normal typing.
(c) **Let the refusal channel carry the decision** — a field whose refusal is dropped by a
re-seed also has its buffer reset. Puts the form in charge of a child's local state.

**Scope note.** Only the DEFERRED path is affected. The common case — no focus in the form
when the push lands — takes the render-phase re-seed and is fixed and pinned
(`tests/inspector/schema-form-validation.test.tsx`, "an external RE-SEED clears a standing
refusal", sabotage-proven red in both re-seed branches). Reaching this one needs a push to
arrive while the user is mid-edit in a field holding an *invalid* value.

**Trigger to revisit:** the first browser-driven gate that exercises the session card while
an external change lands (an SSE reload, a second client, an undo bound to a key while a
field has focus), or any task that touches `ExactNumberInput`'s blur contract or
`SchemaForm`'s echo guard.

**Reference:** `packages/editor/src/frontend/inspector/fields/common.tsx`
(`ExactNumberInput`'s `onBlur`), `packages/editor/src/frontend/inspector/SchemaForm.tsx`
(`reseed`, and the `onBlurCapture` branch that calls it),
`packages/editor/src/frontend/inspector/lib/echo-guard.ts`,
`packages/editor/tests/inspector/schema-form-validation.test.tsx` (the note above the
deferral case records why that test moves focus to a sibling rather than blurring).

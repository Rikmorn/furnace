---
summary: The swappable schema-driven form — kind resolution, the kind→renderer registry, `<SchemaForm>`'s draft/validation/echo-guard contract, and the session card that is its one consumer.
verified: 2026-08-18
---

# The inspector module

`packages/editor/src/frontend/inspector/` is an editable, reflection-driven form over JSON
Schema. It has exactly ONE consumer — the session card, which renders a generator's
`paramSchema` through it — and the whole point of the boundary is that it could have another.

## Where a schema's field semantics come from

The inspector reads one optional annotation off a schema node: a `furnace` bag carrying
`kind` (which control) and/or `unit` (the display suffix). It is written with zod's
`.meta({ furnace: … })` and hoisted to the node ROOT by `toJsonSchema` in
`@furnace/core/registry` — which is the whole contract, and deliberately so: the annotation is
a *registry* convention.

**Nothing in the repo emits a `furnace.kind`.** Core's generator schemas carry only
`furnace.unit`, and every control the one consumer renders is chosen by the schema's SHAPE.
The `kind` half of the contract is live code with no current writer, which is a fact worth
stating plainly rather than leaving a reader to discover. Derive:

```sh
grep -rn 'furnace: {' packages/core/src packages/editor/src packages/dungeon/src
```

## The boundary

The inspector is a **self-contained, swappable boundary**: the chrome consumes it only
through `<SchemaForm>` and the types in `index.tsx`. Input is standard JSON Schema (with a
root-level `furnace` field-semantics key) plus the target's value plus change callbacks;
output is rendered controls. Swapping the inspector library touches only this directory —
`SchemaForm.tsx` plus the field renderers in `fields/`, keeping the module's CONSUMER
untouched. The `JsonSchemaNode` type and the `onPreview` / `onCommit` / `onCancel` /
`onInvalid` callback contract are the stable interface.

**JSON Schema contract** (`packages/editor/src/frontend/inspector/types.ts`). The inspector's
`JsonSchemaNode` is a plain frontend-local type — deliberately NOT core's, because the module
must not value-import `@furnace/core` ([bundling](bundling.md)). There is exactly ONE boundary
cast, in `packages/editor/src/frontend/components/shell/SessionCard.tsx`, where a generator's
`paramSchema` (typed `Record<string, unknown>` in core for that same reason) becomes a
`JsonSchemaNode`.

## Kind resolution and the shape rules

`resolveKind(schema)` (`packages/editor/src/frontend/inspector/kind.ts`) maps a schema node to
a `FieldKind` in priority order: `schema.furnace.kind` → `enum` (by CARDINALITY) → numeric
SHAPE → JSON type string → `"unknown"`. The furnace kinds handled are the members of
`FURNACE_KINDS`: `vec2`, `vec3`, `vec4`, `quat`, `color`.

**`furnace` sits at the schema-node ROOT, not nested under `meta`** — `z.toJSONSchema` hoists
zod's `.meta({ furnace })` to the node root. Every member of `furnace` is optional, `kind`
included, so a node can carry only a `unit`.

**Shape rules (D-25).** Two kinds are chosen from the schema's SHAPE rather than from a
`furnace.kind`, and both decisions live in `resolveKind` so the registry keeps its single
lookup:

- an `enum` of **≤ `SEGMENTED_MAX_MEMBERS`** members → `segmented`; above that → `enum` (the
  Select).
- a **bounded** number (`minimum` and `maximum` both finite,
  `packages/editor/src/frontend/inspector/lib/numeric-schema.ts`) → `stepper` when every
  reachable value is a whole number AND the step spans ≤ `STEPPER_MAX_STEPS` intervals, else
  `slider`. An unbounded number keeps `number`.

Both thresholds carry their argument at `kind.ts`: the segmented cap is what the palette
width allows for word-length labels, and the stepper cap is where ± presses stop being a
route and a track wins.

The bounded control's STEP comes from `multipleOf` when the schema declares one, from
`type: "integer"`, or otherwise from the span (a 1-2-5 value near span/100). **It is never
inferred from how the bounds happen to look**: `cave.chamberRadius` has integer bounds
`[3, 8]` and admits 5.5 m, and `packages/core/src/field/cave.ts` says so at the declaration.

Core's generator schemas carry `multipleOf: 1` on exactly the params narrowed to integers,
and `furnace.unit` on the params whose unit is not already in their name — `"m"` on
`cave.chamberRadius` and `scatter.minSpacing`, `"cells"` on the hall's dimensions, where a
hall of width 8 is 4 m across. Both annotations are declarative: nothing in core reads
either, which is why `packages/core/src/field/generators.test.ts` asserts the `multipleOf`
half **behaviourally** — for every bounded numeric param, a fractional value must be refused
if and only if the schema claims `multipleOf: 1`. That gives the annotation teeth in both
directions, including the quiet one: a param omitting the annotation while the validator
rejects fractions shows up as a slider producing values the generator refuses.

## The kind→renderer registry

`packages/editor/src/frontend/inspector/registry.tsx` is a
`Partial<Record<FieldKind, FieldRenderer>>` mapping each kind to its React component:

| Kind | Renderer |
| --- | --- |
| `number` | `NumberField` — unbounded numeric input with drag-scrub |
| `slider` | `SliderField` — range + scrubby label + exact text input, all quantized by `snapToStep`; renders `furnace.unit` |
| `stepper` | `StepperField` — −/exact/+ over a short integer range; renders `furnace.unit` |
| `string` | `StringField` — text input |
| `boolean` | `BooleanField` — checkbox |
| `enum` | `EnumField` — Radix `Select`, commits the schema MEMBER (`lib/enum-options.ts`) |
| `segmented` | `SegmentedField` — commits the MEMBER through the shared `Segmented` control (`packages/editor/src/frontend/components/ui/segmented.tsx`), which is the `role="radiogroup"` of buttons with the roving tabindex |
| `vec2` / `vec3` / `vec4` | `makeVecField(n)` — N-component number row |
| `color` | `ColorField` — RGBA color picker |
| `quat` | `QuatField` — Euler XYZ degree inputs (converted via `lib/euler.ts`) |
| `object` | `ObjectField` — nested properties |

`fallbackRenderer` is `DefaultField` — displays the value as JSON, read-only. The inspector
degrades, never blanks.

**Every kind in `FURNACE_KINDS` is unreached today**, because nothing sets `furnace.kind`
(above): `vec2`, `vec3`, `vec4`, `color` and `quat` are five kinds across three of the rows
in that table, and every field the one consumer renders resolves by SHAPE or by JSON type.
They are kept because they are the inspector's own vocabulary rather than a borrowed concept.

## `<SchemaForm>` — drafts, validation, the echo guard

`SchemaForm.tsx` iterates `schema.properties`, resolves each field's kind, looks up (or falls
back to) the renderer, and renders it wrapped in a **`RowErrorBoundary`** — a React class
error boundary that catches per-row render errors and displays them inline without crashing
the whole form. It manages the working draft (`useState`) and re-seeds it when the committed
`value` reference changes (the `seed` ref guard); re-seeding is keyed on IDENTITY, not on a
deep compare. Props are
`{ schema, value: unknown, onPreview, onCommit, onCancel, onInvalid? }` — a pure callback
contract, no internal fetch and no mutation of its own.

**Field-level validation (D-25).** Before writing a draft, the form runs
`validateNumber(fieldSchema, value)` (`lib/validate.ts`: bounds + `multipleOf`). A refused
draft is **not written and not previewed** — the worker never evaluates a ghost the generator
would throw on — and the reason renders in that row with `role="alert"`. Refusals are held
per-path (an unrelated row's edit must not clear one whose bad text is still on screen), but
only the FIRST offending field in schema order leaves the component, through `onInvalid`. One
slot, not a bag: a consumer holding a list is one render away from printing a
bottom-of-form dump, which is the pattern D-25 exists to retire. `SessionCard` turns that slot
into the commit verb's disabled reason and retracts it on unmount.

**Row wrappers** (`fields/common.tsx`). `FieldRow` wraps its control in a `<label>`;
`FieldGroupRow` uses a `<div>` and is what a row with SEVERAL controls (stepper, segmented)
uses. A `<label>` labels exactly one control, so wrapping a group makes every member answer to
the row caption instead of its own name, and a `<label>` with no `for` activates its first
labelable descendant — clicking the "Chambers" caption steps the value down.

**The echo guard** (`lib/echo-guard.ts`) is what stops an incoming push clobbering a
half-typed number. `shouldReseed(focusWithin)` is a pure predicate; `SchemaForm` tracks
whether any input inside it is focused (`onFocusCapture` / `onBlurCapture`) and gates the
re-seed on it, so a value arriving while the user is editing waits for the blur. Being a
predicate rather than an inline condition is what makes it unit-testable.

**The drag-scrub** (`lib/scrub.ts`) is `scrubValue(start, dxPixels, sensitivity, fine)`.
`NumberField` and `SliderField`'s label capture the pointer, record the start value, call
`scrubValue` with the accumulated `dx` on each move and `onCommit` on release. ⇧ during the
drag applies `FINE_FACTOR`. Pointer Events rather than mouse events and no pointer-lock —
Safari-safe by construction, and the capture matters because this form floats over a canvas
that orbits on pointermove, and the two are DOM siblings.

**The form serves ONE target.** `value` is singular; there is no multi-select fan and no
mixed state. What survives from the multi-target era on its own merit: omitted fields seed
from the schema's `default` rather than showing `0`; and two "no member matches" branches,
kept because a value matching no enum member is also what a STALE param looks like —
`EnumField`'s placeholder and `SegmentedField`'s `null`. (The `Checkbox` primitive keeps its
indeterminate glyph regardless: Radix's `CheckedState` is tri-state whatever the caller
passes.) `ColorField` commits on the input's native **`change`** event rather than on blur —
Safari only blurs `<input type=color>` when focus moves to a focusable element, so a blur
commit landed only if the user's next click happened to be one; React's `onChange` maps to
the continuous `input` event and drives the live preview instead.

## Labels, numbers, and the label column

Field and section labels are **humanized**
(`packages/editor/src/frontend/lib/humanize.ts` — `humanizeLabel` turns `castShadow` into
"Cast Shadow"), applied in `FieldRow`, the object-group header and every bounded control's own
caption.

Numeric DISPLAY is rounded on the data surface: `inspector/lib/format.ts`'s `roundForDisplay`
strips IEEE-754 noise (`1.2000000000000002` → `1.2`) in `NumberField` and `SliderField` —
**full precision stays in the value**, and because the rounded number is ALSO the dirty-check
baseline (`lib/commit-guard.ts`'s `commitIfChanged`), a focus-and-blur with no edit never
commits a truncation. Vec and quat rows show x/y/z(/w) axis chips; `QuatField` renders Euler
XYZ degrees.

Every row's caption sits in ONE app-wide label column — `--spacing-label-col` in
`packages/editor/src/frontend/styles.css`. A per-surface width is how two forms in one cockpit
come to disagree about where their values start.

**Euler / quat duplication** (`lib/euler.ts`). The `quatToEulerDeg` / `eulerDegToQuat` math is
hand-rolled in the inspector because the frontend cannot value-import `@furnace/core`
([bundling](bundling.md)). The conversion matches `core/transform`'s `quat.fromEuler`
(intrinsic XYZ) and is pinned to core's convention by
`packages/editor/tests/inspector-helpers.test.ts`. It is the only remaining frontend
duplication of core logic in this module.

## The one consumer — the session card

`packages/editor/src/frontend/components/shell/SessionCard.tsx` (D-13) is the editor's
properties surface and this module's only caller. Its state is decided by two host facts alone —
is there a session, is an entity selected — and by nothing it remembers:

| State | Subject | ⏎ / Esc |
| --- | --- | --- |
| **CREATE** | a `stamp` session; there is no entity yet, so it is about a REGION | commit / discard |
| **REST** | an entity is selected, nothing is armed; values come off the committed RECORD and no ghost previews | *no verbs at all* |
| **RECONFIGURE** | a `reconfigure` session (a MOVE is one, flagged); values come off the SESSION and the ghost previews live | apply / revert — **drop** / revert for a move |

**Two sources, one selector.** Rest reads the record, reconfigure reads the session, the card
PICKS and never merges them — which is the whole answer to how they stay in agreement: they do
not have to, because only one is on screen at a time. A card that blended them would show a
number no surface is about to build.

**The promotion** is the subtlest thing here. In REST, the first control the user COMMITS through
opens a reconfigure carrying that edit, and four rules hold it together:

- **a TOUCH is a commit and never a preview.** Every text field previews per keystroke, so
  promoting on preview would open, cancel and re-open a session per character — on "1" while the
  user typed "12".
- **the touch that promoted is parked** as a `PendingTouch` and pushed against the SESSION's own
  seed and policy, because the merge policy in particular is not recoverable from the record.
- **it paints ONCE**, which took two mechanisms: opening the entity publishes the session
  synchronously so the touch and its arrival land in one React batch, and the parked touch is
  applied from a **layout** effect, because a passive one runs after paint and the value that
  would flicker is the number the user just typed.
- **a REFUSED promotion drops its touch.** Opening an entity is runtime-quiet on an unknown id, a
  frozen or baked entity and a retired generator, and a surviving edit would land on whatever
  session opened next.

The card **owns no lifecycle verb** (D-14): freeze, bake and delete are the entity ROW's, because
they change what an entity IS rather than what it holds ([tools](tools.md)). The seed row is
gated on core's `usesSeed` — a hall never reads its seed, so a field and a re-roll for it are two
controls that do nothing. A frozen or baked record renders read-only params instead of a form,
because opening it refuses and live controls would be a form whose every edit reported a refusal.
The four leaves in `shell/session-card/` are presentational and hold no host knowledge; the file
itself keeps the selector, the promotion, and the two funnels every control writes through.

**Its open state is DRIVEN, and keyed on the SUBJECT.** A sibling component renders `null` rather
than an effect inside the card, because the palette layer unmounts a closed palette's body and
the thing that opens a palette cannot live inside it. Keying on the subject rather than on the
open flag is the whole "is this annoying?" answer: closing the card with its × is a statement
about the thing you were looking at, so the same subject pushed again leaves it closed while a
DIFFERENT subject re-opens it. Geometry and collapse stay the user's and stay persisted; `open`
is neither ([chrome](chrome.md)).

**A refusal reported up from `<SchemaForm>` disables the commit verb and names the offending
field — and it OUTRANKS the preview-settled gate**, because a refused param never previewed.
The card turns that one slot into the verb's disabled reason and retracts it on unmount.

**Core's generators validate params setup-loud from inside the preview worker**, so an off-grid
value that slipped past the form comes back as a thrown string one round trip later. That is why
the step is declared rather than guessed (above) — the two must not disagree.

One boundary cast lives here and nowhere else: a generator's `paramSchema`, typed
`Record<string, unknown>` in core so the chrome need not value-import it, becomes a
`JsonSchemaNode` at this call site.

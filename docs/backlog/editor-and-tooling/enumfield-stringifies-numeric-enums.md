---
summary: the editor's enum controls now commit the schema MEMBER, but core's stamp `rotation` is still spelled `["0","90","180","270"]` to survive them — unwinding that is a persisted-data change to `GeneratorEntity.params` and every `oplog.json` on disk
---

# EnumField stringifies enum members and never coerces back — numeric enums are dead on arrival

`EnumField` renders a JSON-Schema `enum` through a Radix `Select`, whose option values are
strings: it builds options as `(schema.enum ?? []).map(String)` and commits with
`onValueChange={(v) => onCommit(values.map(() => v))}`, where `v` is the option STRING.
Nothing downstream converts it back to the member's original type — `StampInspector`'s
`apply` is a bare `as Record<string, unknown>` boundary cast straight into the stamp
session's params, and from there into `evaluate`. Every sibling field parses its string
back to the schema's type before committing — `NumberField`, `VecField` and `QuatField`
via `Number(...)`, `ColorField` via `parseInt(h.slice(…), 16) / 255` — and the enum path
is the only one that does not.

Consequence: a schema property declared as `{ enum: [0, 90, 180, 270] }` round-trips out of
the inspector as the string `"90"`. A generator that validates its enum by identity against
the numeric members rejects it setup-loud, so the control is unusable in the very UI it
exists for — while every core test passes, because core never goes through the form.

This is why F3a's stamp `rotation` is spelled as a STRING enum
(`["0", "90", "180", "270"]`) in `packages/core/src/field/generators.ts` rather than the
numbers the geometry actually wants. The string spelling also keeps ONE spelling of the
value in persisted `GeneratorEntity.params` (and in `oplog.json`) instead of two — `90`
from an API caller, `"90"` from the form — which a later migration or equality check would
otherwise have to reconcile. That made string-vs-lenient-parser the right call at the time,
but it is a workaround living in core for an editor-side gap.

The fix is in `EnumField`: carry the schema's original member alongside its string label
and commit the member, not the label. That is a small change but it needs its own test, and
it touches a shared inspector primitive used by every enum in the editor (the hall's
`pillars`, the cave's `theme`, the stamp `rotation` below), so it wants a deliberate pass
rather than a drive-by.
Once it lands, `rotation` can become a numeric enum and the coercion note in the
`ROTATIONS` TSDoc can go.

**RESOLVED EDITOR-SIDE 2026-07-31 (F4.5b Task 11); the CORE half is still open.** The field
half shipped: `inspector/lib/enum-options.ts` carries each member beside its label and
transports it by INDEX, and both enum controls (`EnumField`'s Select and the new
`SegmentedField`) commit the member. `StampInspector` was deleted at Task 10; the boundary
cast now lives in `SessionCard.tsx` and is unchanged (it casts the params RECORD, not the
member).

*Coverage, corrected against the tests themselves (2026-08-01) — the sentence this replaces
said `enum-field.test.tsx` pins the COMMIT, and it does not.* That file pins the pure
mapping (`enumOptions` carries the member; `memberAt("1")` is the number `90` with
`typeof === "number"`; the transport is the INDEX so `[1, "1"]` stays distinguishable) and
`EnumField`'s DISPLAY binding. The end-to-end COMMIT is pinned through the other control —
`segmented-field.test.tsx`, "picking a segment COMMITS the schema member, not its label",
asserting `toBe(90)` and `typeof === "number"` after a real click — which consumes the same
`lib/enum-options.ts`. What stays uncovered, and is disclosed in the test file's own header:
`EnumField`'s wiring of `memberAt` into `onValueChange`, because a Radix `Select` item
cannot be clicked under happy-dom (probed — the portaled content never mounts). A
browser-driven gate is what closes that.

What has NOT changed is core: stamp `rotation` is still `["0", "90", "180", "270"]` and the
`ROTATIONS` TSDoc still records the dependency. That migration is a persisted-data change —
`GeneratorEntity.params` and every `oplog.json` on disk hold the string spelling — so it
needs a read-both-accept-one lenient parser or a migration, which is a deliberate pass and
was explicitly out of Task 11's scope.

**Trigger to revisit:** a core pass that is already touching generator param persistence, or
the next schema that wants a numeric enum in CORE (the editor no longer blocks one).

**Reference:** `packages/editor/src/frontend/inspector/lib/enum-options.ts` (the mapping),
`fields/EnumField.tsx` + `fields/SegmentedField.tsx` (both commit the member),
`packages/editor/tests/inspector/enum-field.test.tsx`, `packages/core/src/field/generators.ts`
(`ROTATIONS` TSDoc — the remaining half).

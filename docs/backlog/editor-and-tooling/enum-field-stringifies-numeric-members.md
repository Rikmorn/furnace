# EnumField stringifies enum members and never coerces back — numeric enums are dead on arrival

`EnumField` renders a JSON-Schema `enum` through a Radix `Select`, whose option values are
strings: it builds options as `(schema.enum ?? []).map(String)` and commits with
`onValueChange={(v) => onCommit(values.map(() => v))}`, where `v` is the option STRING.
Nothing downstream converts it back to the member's original type — `StampInspector`'s
`apply` is a bare `as Record<string, unknown>` boundary cast straight into the stamp
session's params, and from there into `evaluate`. Its sibling fields (`NumberField`,
`VecField`, `QuatField`, `ColorField`) all parse with `Number(...)`; the enum path is the
only one that does not.

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
it touches a shared inspector primitive used by every enum in the editor (today: the hall's
`pillars`, plus scene-format enums), so it wants a deliberate pass rather than a drive-by.
Once it lands, `rotation` can become a numeric enum and the coercion note in the
`ROTATIONS` TSDoc can go.

**Trigger to revisit:** the next schema that wants a numeric enum, or the F4 inspector pass.

**Reference:** `packages/editor/src/frontend/inspector/fields/EnumField.tsx` (the `.map(String)`
options and the `onValueChange` commit), `packages/editor/src/frontend/components/field/StampInspector.tsx`
(the `apply` boundary cast), `packages/core/src/field/generators.ts` (`ROTATIONS` TSDoc records
the dependency).

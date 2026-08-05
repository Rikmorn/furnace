import { BooleanField } from "./fields/BooleanField.tsx";
import { ColorField } from "./fields/ColorField.tsx";
import { DefaultField } from "./fields/DefaultField.tsx";
import { EnumField } from "./fields/EnumField.tsx";
import { NumberField } from "./fields/NumberField.tsx";
import { ObjectField } from "./fields/ObjectField.tsx";
import { QuatField } from "./fields/QuatField.tsx";
import { SegmentedField } from "./fields/SegmentedField.tsx";
import { SliderField } from "./fields/SliderField.tsx";
import { StepperField } from "./fields/StepperField.tsx";
import { StringField } from "./fields/StringField.tsx";
import { makeVecField } from "./fields/VecField.tsx";
import type { FieldKind, FieldRenderer } from "./types.ts";

export const registry: Partial<Record<FieldKind, FieldRenderer>> = {
	number: NumberField,
	slider: SliderField,
	stepper: StepperField,
	string: StringField,
	boolean: BooleanField,
	enum: EnumField,
	segmented: SegmentedField,
	vec2: makeVecField(2),
	vec3: makeVecField(3),
	vec4: makeVecField(4),
	color: ColorField,
	quat: QuatField,
	// `resource` and `ref` render READ-ONLY (DefaultField prints the value as JSON in a
	// muted <pre>) rather than as pickers, and that is honest rather than a stub: the
	// pickers that used to sit here read their option lists off an `InspectorOptions`
	// context that has had NO provider anywhere in `src/` since the scene-editing surface
	// was deleted, so they always offered an EMPTY list. A control that can never offer a
	// choice is worse than a legible value. The KINDS stay in the union because a schema
	// may still name them, but since the scene module was deleted (T2) NO schema in the
	// repo does — the `t.resource`/`t.ref` helpers that emitted them went with it.
	resource: DefaultField,
	ref: DefaultField,
	object: ObjectField,
};
export const fallbackRenderer: FieldRenderer = DefaultField;

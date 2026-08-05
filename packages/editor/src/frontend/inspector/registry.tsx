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
	object: ObjectField,
};
export const fallbackRenderer: FieldRenderer = DefaultField;

import { BooleanField } from "./fields/BooleanField.tsx";
import { ColorField } from "./fields/ColorField.tsx";
import { DefaultField } from "./fields/DefaultField.tsx";
import { EntityRefField } from "./fields/EntityRefField.tsx";
import { EnumField } from "./fields/EnumField.tsx";
import { NumberField } from "./fields/NumberField.tsx";
import { ObjectField } from "./fields/ObjectField.tsx";
import { QuatField } from "./fields/QuatField.tsx";
import { ResourceRefField } from "./fields/ResourceRefField.tsx";
import { StringField } from "./fields/StringField.tsx";
import { makeVecField } from "./fields/VecField.tsx";
import type { FieldKind, FieldRenderer } from "./types.ts";

export const registry: Partial<Record<FieldKind, FieldRenderer>> = {
	number: NumberField,
	string: StringField,
	boolean: BooleanField,
	enum: EnumField,
	vec2: makeVecField(2),
	vec3: makeVecField(3),
	vec4: makeVecField(4),
	color: ColorField,
	quat: QuatField,
	resource: ResourceRefField,
	ref: EntityRefField,
	object: ObjectField,
};
export const fallbackRenderer: FieldRenderer = DefaultField;

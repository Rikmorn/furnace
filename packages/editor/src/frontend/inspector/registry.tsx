import { BooleanField } from "./fields/BooleanField.tsx";
import { DefaultField } from "./fields/DefaultField.tsx";
import { EnumField } from "./fields/EnumField.tsx";
import { NumberField } from "./fields/NumberField.tsx";
import { StringField } from "./fields/StringField.tsx";
import type { FieldKind, FieldRenderer } from "./types.ts";

export const registry: Partial<Record<FieldKind, FieldRenderer>> = {
  number: NumberField,
  string: StringField,
  boolean: BooleanField,
  enum: EnumField,
};
export const fallbackRenderer: FieldRenderer = DefaultField;

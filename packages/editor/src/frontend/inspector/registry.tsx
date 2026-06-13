import { DefaultField } from "./fields/DefaultField.tsx";
import type { FieldKind, FieldRenderer } from "./types.ts";

// Populated as field renderers land (Tasks 12–13). Missing kinds fall back to
// DefaultField via the SchemaForm lookup, so the inspector always renders.
export const registry: Partial<Record<FieldKind, FieldRenderer>> = {};
export const fallbackRenderer: FieldRenderer = DefaultField;

import { resolveKind } from "../kind.ts";
import { getAtPath, setAtPath } from "../lib/paths.ts";
import { fallbackRenderer, registry } from "../registry.tsx";
import type { FieldProps, JsonSchemaNode } from "../types.ts";

export function ObjectField({ schema, values, onPreview, onCommit, onCancel, path }: FieldProps) {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchemaNode>;
  return (
    <fieldset className="rounded border border-neutral-800 px-2 py-1">
      <legend className="px-1 text-xs text-neutral-500">{path.split(".").at(-1)}</legend>
      {Object.entries(properties).map(([key, fieldSchema]) => {
        const kind = resolveKind(fieldSchema);
        const Renderer = registry[kind] ?? fallbackRenderer;
        const childValues = values.map((v) => getAtPath(v, key));
        const fan = (next: unknown[], cb: (n: unknown[]) => void) =>
          cb(values.map((v, i) => setAtPath(v, key, next[i])));
        return (
          <Renderer
            key={key}
            schema={fieldSchema}
            values={childValues}
            path={`${path}.${key}`}
            onPreview={(next) => fan(next, onPreview)}
            onCommit={(next) => fan(next, onCommit)}
            onCancel={onCancel}
          />
        );
      })}
    </fieldset>
  );
}

import { useId } from "react";
import { resolveKind } from "../kind.ts";
import { getAtPath, setAtPath } from "../lib/paths.ts";
import { fallbackRenderer, registry } from "../registry.tsx";
import type { FieldProps, JsonSchemaNode } from "../types.ts";

export function ObjectField({ schema, values, onPreview, onCommit, onCancel, path }: FieldProps) {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchemaNode>;
  // Programmatic group↔label association (restored Task 11): role="group" +
  // aria-labelledby ties the label to its fields for assistive tech — WITHOUT the
  // <fieldset>/<legend> boxed-card look Task 8 removed. The visual stays flat.
  const labelId = useId();
  return (
    // Flattened (Task 8 sub-change 2): a nested object is an indented, labeled group —
    // a thin left rule as a nesting guide, NOT a bordered/rounded card (the critique's
    // named-ban "nested-cards" structure).
    <div role="group" aria-labelledby={labelId} className="border-l border-border/60 pl-2">
      <p id={labelId} className="py-0.5 text-xs text-muted-foreground">
        {path.split(".").at(-1)}
      </p>
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
    </div>
  );
}

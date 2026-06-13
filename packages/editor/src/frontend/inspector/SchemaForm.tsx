import { Component, type ErrorInfo, type ReactNode, useRef, useState } from "react";
import { resolveKind } from "./kind.ts";
import { getAtPath, setAtPath } from "./lib/paths.ts";
import { fallbackRenderer, registry } from "./registry.tsx";
import type { JsonSchemaNode } from "./types.ts";

class RowErrorBoundary extends Component<
  { path: string; children: ReactNode },
  { error?: Error }
> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[inspector] field "${this.props.path}" threw:`, error, info.componentStack);
  }
  override render() {
    if (this.state.error)
      return (
        <p className="py-1 font-mono text-xs text-red-400">
          {this.props.path}: {this.state.error.message}
        </p>
      );
    return this.props.children;
  }
}

export type SchemaFormProps = {
  schema: JsonSchemaNode; // an object schema (component / settings / resource params)
  values: unknown[]; // N target params objects (one per selected entity)
  onPreview: (next: unknown[]) => void;
  onCommit: (next: unknown[]) => void;
  onCancel: () => void;
};

/** Render an object schema's properties as editable rows. Tracks N working drafts. */
export function SchemaForm({ schema, values, onPreview, onCommit, onCancel }: SchemaFormProps) {
  // Drafts are the live edited copies; re-seed when the committed values change.
  const [drafts, setDrafts] = useState<unknown[]>(values);
  const seed = useRef(values);
  if (seed.current !== values) {
    seed.current = values;
    if (drafts !== values) setDrafts(values);
  }

  const properties = schema.properties ?? {};
  return (
    <div className="flex flex-col gap-1">
      {Object.entries(properties).map(([key, fieldSchema]) => {
        const kind = resolveKind(fieldSchema);
        const Renderer = registry[kind] ?? fallbackRenderer;
        const fieldValues = drafts.map((d) => getAtPath(d, key));
        return (
          <RowErrorBoundary key={key} path={key}>
            <Renderer
              schema={fieldSchema}
              values={fieldValues}
              path={key}
              onPreview={(next) => {
                const updated = drafts.map((d, i) => setAtPath(d, key, next[i]));
                setDrafts(updated);
                onPreview(updated);
              }}
              onCommit={(next) => {
                const updated = drafts.map((d, i) => setAtPath(d, key, next[i]));
                setDrafts(updated);
                onCommit(updated);
              }}
              onCancel={() => {
                setDrafts(values);
                onCancel();
              }}
            />
          </RowErrorBoundary>
        );
      })}
    </div>
  );
}

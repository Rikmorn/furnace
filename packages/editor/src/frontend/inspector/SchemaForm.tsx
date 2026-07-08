import { Component, type ErrorInfo, type ReactNode, useRef, useState } from "react";
import { shouldReseed } from "./lib/echo-guard.ts";
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
        <p className="py-1 font-mono text-xs text-destructive">
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
  // Echo-guard: track whether any input inside this form currently has focus.
  // While focused, incoming session-updated re-seeds are deferred so an external
  // edit mid-interaction does not clobber the in-progress draft.
  const focusWithin = useRef(false);

  if (seed.current !== values) {
    // Always record that a new value arrived so we know to reseed on blur.
    seed.current = values;
    // Only re-seed immediately when no input is active (shouldReseed returns true).
    if (drafts !== values && shouldReseed(focusWithin.current)) setDrafts(values);
  }

  const properties = schema.properties ?? {};
  return (
    <div
      className="flex flex-col gap-1"
      onFocusCapture={() => {
        focusWithin.current = true;
      }}
      onBlurCapture={(e) => {
        // Only clear the flag when focus leaves the form entirely (not when moving
        // between inputs within the form).
        // Boundary cast: relatedTarget is EventTarget | null; DOM guarantees it is
        // a Node when non-null, which is what contains() requires.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          focusWithin.current = false;
          // A session-updated arrived while focused and was deferred — reseed now
          // so the field shows the latest committed value now that editing is done.
          if (drafts !== values) setDrafts(values);
        }
      }}
    >
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

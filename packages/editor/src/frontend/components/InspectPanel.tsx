import { useState } from "react";
import { cn } from "../lib/cn.ts";
import { SchemaForm } from "../inspector/index.tsx";
import { commonComponents } from "../inspector/lib/common-components.ts";
import {
  InspectorOptionsContext,
  type InspectorOptions,
} from "../inspector/options.ts";
import type { JsonSchemaNode } from "../inspector/types.ts";
import { splitResourceEntry } from "../inspector/lib/resource-kind.ts";
import { useEditor } from "./editor-context.ts";
import { JsonView } from "./JsonView.tsx";

export function InspectPanel() {
  const { state, hostRef, actions } = useEditor();
  const [tab, setTab] = useState<"entity" | "schemas">("entity");

  const reflection = hostRef.current?.introspect();
  const doc = state.doc;
  const selectedEntities =
    doc?.entities.filter((e) => state.selectedEntities.includes(e.id)) ?? [];

  const options: InspectorOptions = {
    resourceIds: (table) =>
      Object.keys(
        (doc?.resources as Record<string, Record<string, unknown>> | undefined)?.[
          table
        ] ?? {},
      ),
    entityIds: () => doc?.entities.map((e) => e.id) ?? [],
  };

  const componentSchema = (name: string): JsonSchemaNode | undefined =>
    // Boundary cast: introspect() returns core's JSON-schema (Record<string,unknown>); the
    // inspector consumes the structurally-equivalent frontend-local JsonSchemaNode.
    reflection?.components[name] as JsonSchemaNode | undefined;

  return (
    <InspectorOptionsContext.Provider value={options}>
      <div className="flex h-full flex-col">
        <div className="flex gap-1 border-b border-border p-1">
          {(["entity", "schemas"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                "rounded px-2 py-1 text-xs",
                tab === t ? "bg-muted" : "text-muted-foreground",
              )}
              onClick={() => setTab(t)}
            >
              {t === "entity" ? "Inspect" : "Schemas"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {state.error && (
            <p className="mb-2 whitespace-pre-wrap font-mono text-xs text-destructive">
              {state.error}
            </p>
          )}
          {tab === "entity" && (
            <div className="flex flex-col gap-4">
              <EntityInspector
                selected={selectedEntities}
                componentSchema={componentSchema}
                // Boundary cast: introspect() returns core's JSON-schema (Record<string,unknown>); the
                // inspector consumes the structurally-equivalent frontend-local JsonSchemaNode.
                settingsSchema={reflection?.settings as JsonSchemaNode | undefined}
                // Boundary cast: doc.settings is typed as unknown from the JSON session doc;
                // the settings form expects a plain object shape.
                settingsValue={(doc?.settings ?? {}) as Record<string, unknown>}
                actions={actions}
              />
              {doc && reflection && (
                <ResourcesInspector
                  resources={doc.resources}
                  reflection={reflection}
                  actions={actions}
                />
              )}
            </div>
          )}
          {tab === "schemas" &&
            (reflection ? (
              <JsonView label="registry" value={reflection} />
            ) : (
              <p className="text-sm text-muted-foreground">engine not loaded</p>
            ))}
        </div>
      </div>
    </InspectorOptionsContext.Provider>
  );
}

function ResourcesInspector({
  resources,
  reflection,
  actions,
}: {
  resources: { [table: string]: Record<string, unknown> | undefined } | undefined;
  reflection: { resources: Record<string, Record<string, JsonSchemaNode>> };
  actions: ReturnType<typeof useEditor>["actions"];
}) {
  const tables = Object.entries(resources ?? {}).filter(
    ([, entries]) => entries && Object.keys(entries).length > 0,
  );
  if (tables.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold text-foreground">resources</h3>
      <div className="flex flex-col gap-2">
        {tables.map(([table, entries]) =>
          Object.entries(entries ?? {}).map(([id, entry]) => {
            const { kind, params } = splitResourceEntry(
              table,
              entry as Record<string, unknown>,
            );
            const schema = reflection.resources[table]?.[kind];
            if (!schema) return null;
            return (
              <div key={`${table}:${id}`} className="rounded border border-border p-1">
                <p className="text-xs text-muted-foreground">
                  {table}/{id} <span className="text-muted-foreground/60">({kind})</span>
                </p>
                <SchemaForm
                  schema={schema}
                  values={[params]}
                  onPreview={() => {
                    /* resources are not live-previewed in 5A (spec §4) */
                  }}
                  onCommit={(next) =>
                    void actions.commitResource(table, id, {
                      kind,
                      ...(next[0] as Record<string, unknown>),
                    })
                  }
                  onCancel={() => {
                    /* reverts on the next refresh */
                  }}
                />
              </div>
            );
          }),
        )}
      </div>
    </section>
  );
}

function EntityInspector({
  selected,
  componentSchema,
  settingsSchema,
  settingsValue,
  actions,
}: {
  selected: { id: string; components: Record<string, unknown> }[];
  componentSchema: (name: string) => JsonSchemaNode | undefined;
  settingsSchema: JsonSchemaNode | undefined;
  settingsValue: Record<string, unknown>;
  actions: ReturnType<typeof useEditor>["actions"];
}) {
  if (selected.length === 0)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">select an entity</p>
        {settingsSchema && (
          <section>
            <h3 className="mb-1 text-xs font-semibold text-foreground">settings</h3>
            <SchemaForm
              schema={settingsSchema}
              values={[settingsValue]}
              onPreview={(next) => actions.previewSettings(next[0])}
              onCommit={(next) => void actions.commitSettings(next[0])}
              onCancel={() => {
                // M5A gap: no revertSettings action — a previewed settings change persists in the
                // engine until the next refresh (components revert via revertEntity; settings don't). 5B.
              }}
            />
          </section>
        )}
      </div>
    );

  const names = commonComponents(selected);
  const ids = selected.map((e) => e.id);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {ids.length === 1 ? ids[0] : `${ids.length} selected`}
      </p>
      {names.map((name) => {
        const schema = componentSchema(name);
        if (!schema) return null;
        return (
          <section key={name}>
            <h3 className="mb-1 text-xs font-semibold text-foreground">{name}</h3>
            <SchemaForm
              schema={schema}
              values={selected.map((e) => e.components[name] ?? {})}
              // Boundary cast: SchemaForm emits unknown[] drafts; each is this component's params object.
              onPreview={(next) =>
                selected.forEach((e, i) =>
                  actions.previewEntity(e.id, name, next[i] as Record<string, unknown>),
                )
              }
              onCommit={(next) =>
                void actions.commitComponents(
                  selected.map((e, i) => ({
                    entity: e.id,
                    component: name,
                    params: next[i] as Record<string, unknown>,
                  })),
                )
              }
              onCancel={() => selected.forEach((e) => actions.revertEntity(e.id))}
            />
          </section>
        );
      })}
    </div>
  );
}

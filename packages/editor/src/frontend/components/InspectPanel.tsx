import { useState } from "react";
import { cn } from "../lib/cn.ts";
import { humanizeLabel } from "../lib/humanize.ts";
import { SchemaForm } from "../inspector/index.tsx";
import { commonComponents } from "../inspector/lib/common-components.ts";
import { referencedResourceKeys } from "../inspector/lib/resource-refs.ts";
import { splitResourceEntry } from "../inspector/lib/resource-kind.ts";
import {
  InspectorOptionsContext,
  type InspectorOptions,
} from "../inspector/options.ts";
import type { JsonSchemaNode } from "../inspector/types.ts";
import { SETTINGS_SELECTION } from "../lib/selection.ts";
import { CollapsibleSection } from "./CollapsibleSection.tsx";
import { useEditor } from "./editor-context.ts";
import { JsonView } from "./JsonView.tsx";

/** Read/write helpers for a section's persisted open-state (keyed `<kind>:<id>`). */
type Collapse = {
  isOpen: (key: string, dflt: boolean) => boolean;
  setOpen: (key: string, open: boolean) => void;
};

export function InspectPanel() {
  const { state, hostRef, actions, store } = useEditor();
  const [tab, setTab] = useState<"entity" | "schemas">("entity");

  const reflection = hostRef.current?.introspect();
  const doc = state.doc;
  const selectedEntities =
    doc?.entities.filter((e) => state.selectedEntities.includes(e.id)) ?? [];
  const settingsSelected = state.selectedEntities.includes(SETTINGS_SELECTION);

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

  // Section open-state persistence: read the record once per render; a toggle
  // read-modify-writes it. Defaults apply when the store holds no entry (or is absent).
  const collapseState: Record<string, boolean> =
    store?.get("inspectorCollapse") ?? {};
  const collapse: Collapse = {
    isOpen: (key, dflt) => collapseState[key] ?? dflt,
    setOpen: (key, open) => {
      if (!store) return;
      store.set("inspectorCollapse", {
        ...(store.get("inspectorCollapse") ?? {}),
        [key]: open,
      });
    },
  };

  // Resources shown in the panel: filtered to the ids the selection (transitively)
  // references, or ALL when no entity is selected (keeps the panel scannable at the
  // single-world-doc scale — a bake carries dozens of materials).
  const referenced =
    reflection && doc && selectedEntities.length > 0
      ? referencedResourceKeys(selectedEntities, reflection, doc.resources)
      : undefined;

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
            <div className="flex flex-col gap-3">
              {settingsSelected ? (
                <SettingsInspector
                  settingsSchema={
                    reflection?.settings as JsonSchemaNode | undefined
                  }
                  // Boundary cast: doc.settings is unknown from the JSON session doc; the
                  // settings form expects a plain object shape.
                  settingsValue={(doc?.settings ?? {}) as Record<string, unknown>}
                  actions={actions}
                  collapse={collapse}
                />
              ) : selectedEntities.length > 0 ? (
                <EntityInspector
                  selected={selectedEntities}
                  componentSchema={componentSchema}
                  actions={actions}
                  collapse={collapse}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing selected. Pick an entity, or “World” for scene settings.
                </p>
              )}
              {doc && reflection && (
                <ResourcesInspector
                  resources={doc.resources}
                  reflection={reflection}
                  actions={actions}
                  referenced={referenced}
                  collapse={collapse}
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
  referenced,
  collapse,
}: {
  resources: { [table: string]: Record<string, unknown> | undefined } | undefined;
  reflection: { resources: Record<string, Record<string, JsonSchemaNode>> };
  actions: ReturnType<typeof useEditor>["actions"];
  /** When set, only entries whose `table:id` is in the set are shown; else show all. */
  referenced: Set<string> | undefined;
  collapse: Collapse;
}) {
  const rows = Object.entries(resources ?? {}).flatMap(([table, entries]) =>
    Object.keys(entries ?? {})
      .filter((id) => !referenced || referenced.has(`${table}:${id}`))
      // Boundary cast: entries is a Record; each value is a resource entry object.
      .map((id) => ({ table, id, entry: (entries as Record<string, unknown>)[id] })),
  );
  if (rows.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold text-foreground">Resources</h3>
      <div className="flex flex-col gap-0.5">
        {rows.map(({ table, id, entry }) => {
          const { kind, params } = splitResourceEntry(
            table,
            entry as Record<string, unknown>,
          );
          const schema = reflection.resources[table]?.[kind];
          if (!schema) return null;
          const key = `resource:${table}:${id}`;
          return (
            <CollapsibleSection
              key={key}
              // Resources default COLLAPSED — they're reference context, not the focus.
              defaultOpen={collapse.isOpen(key, false)}
              onOpenChange={(open) => collapse.setOpen(key, open)}
              title={
                <span className="font-normal">
                  <span className="font-mono">
                    {table}/{id}
                  </span>{" "}
                  <span className="text-muted-foreground/60">({kind})</span>
                </span>
              }
            >
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
            </CollapsibleSection>
          );
        })}
      </div>
    </section>
  );
}

function SettingsInspector({
  settingsSchema,
  settingsValue,
  actions,
  collapse,
}: {
  settingsSchema: JsonSchemaNode | undefined;
  settingsValue: Record<string, unknown>;
  actions: ReturnType<typeof useEditor>["actions"];
  collapse: Collapse;
}) {
  if (!settingsSchema)
    return <p className="text-sm text-muted-foreground">no settings schema</p>;
  const key = "settings:root"; // matches the Collapse `<kind>:<id>` key contract

  return (
    <CollapsibleSection
      title="Settings"
      defaultOpen={collapse.isOpen(key, true)}
      onOpenChange={(open) => collapse.setOpen(key, open)}
    >
      <SchemaForm
        schema={settingsSchema}
        values={[settingsValue]}
        onPreview={(next) => actions.previewSettings(next[0])}
        onCommit={(next) => void actions.commitSettings(next[0])}
        onCancel={() => {
          // M5A gap: no revertSettings action — a previewed settings change persists in the
          // engine until the next refresh (components revert via revertEntity; settings don't).
        }}
      />
    </CollapsibleSection>
  );
}

function EntityInspector({
  selected,
  componentSchema,
  actions,
  collapse,
}: {
  selected: { id: string; components: Record<string, unknown> }[];
  componentSchema: (name: string) => JsonSchemaNode | undefined;
  actions: ReturnType<typeof useEditor>["actions"];
  collapse: Collapse;
}) {
  const names = commonComponents(selected);
  const ids = selected.map((e) => e.id);
  return (
    <div className="flex flex-col gap-0.5">
      <p className="font-mono text-xs text-muted-foreground">
        {ids.length === 1 ? ids[0] : `${ids.length} selected`}
      </p>
      {names.map((name) => {
        const schema = componentSchema(name);
        if (!schema) return null;
        const key = `component:${name}`;
        return (
          <CollapsibleSection
            key={name}
            title={humanizeLabel(name)}
            // Components default OPEN — they're the focus of a selection.
            defaultOpen={collapse.isOpen(key, true)}
            onOpenChange={(open) => collapse.setOpen(key, open)}
          >
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
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

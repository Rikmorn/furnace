import { useState } from "react";
import { cn } from "../lib/cn.ts";
import { useEditor } from "./editor-context.ts";
import { JsonView } from "./JsonView.tsx";

export function InspectPanel() {
  const { state, hostRef } = useEditor();
  const [tab, setTab] = useState<"entity" | "schemas">("entity");
  const entity = state.doc?.entities.find((e) => state.selectedEntities.includes(e.id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-neutral-800 p-1">
        {(["entity", "schemas"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={cn(
              "rounded px-2 py-1 text-xs",
              tab === t ? "bg-neutral-800" : "text-neutral-500",
            )}
            onClick={() => setTab(t)}
          >
            {t === "entity" ? "Inspect" : "Schemas"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {state.error && (
          <p className="mb-2 whitespace-pre-wrap font-mono text-xs text-red-400">
            {state.error}
          </p>
        )}
        {tab === "entity" &&
          (entity ? (
            <JsonView label={entity.id} value={entity.components} />
          ) : (
            <p className="text-sm text-neutral-500">select an entity</p>
          ))}
        {tab === "schemas" &&
          (hostRef.current ? (
            <JsonView label="registry" value={hostRef.current.introspect()} />
          ) : (
            <p className="text-sm text-neutral-500">engine not loaded</p>
          ))}
      </div>
    </div>
  );
}

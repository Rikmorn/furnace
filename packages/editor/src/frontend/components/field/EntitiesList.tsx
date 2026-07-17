// The committed-entities list (F2b Task 15): one row per generator entity in
// log order, fed by the panel's host.listEntities() clones. Clicking a row
// shows its amber-dim region box (host.highlightEntity) plus an inline
// READ-ONLY params <dl>; clicking again collapses both. Read-only on purpose —
// editing committed stamps (reconfigure) arrives in F3, and the note row says
// so. The section-open callback is one of the panel's entity-refresh triggers
// (the ⌘Z catch-up; see FieldPanel's refresh-strategy note).
import type { GeneratorEntity } from "@furnace/core/field"; // type-only: erased
import { Fragment, useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { CollapsibleSection } from "../CollapsibleSection.tsx";

/** `opSpan` is [firstOpId, lastOpId] inclusive (commitGenerator). */
const opCount = (e: GeneratorEntity): number => e.opSpan[1] - e.opSpan[0] + 1;

/** Params are schema-driven primitives (number/boolean/enum string); the
 *  object branch is a robustness fallback, not an expected shape. */
const formatParam = (v: unknown): string =>
  typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

export function EntitiesList(props: {
  entities: GeneratorEntity[];
  onHighlight: (id: number | null) => void;
  /** Fired when the section opens — the panel re-reads listEntities. */
  onOpen: () => void;
}) {
  const { entities, onHighlight } = props;
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // A refresh can remove the expanded entity (⌘Z undoes the whole commit):
  // drop the expansion + the highlight box so neither outlives its row.
  useEffect(() => {
    if (
      expandedId !== null &&
      !entities.some((e) => e.entityId === expandedId)
    ) {
      setExpandedId(null);
      onHighlight(null);
    }
  }, [entities, expandedId, onHighlight]);

  return (
    <CollapsibleSection
      title={`Entities (${entities.length})`}
      // Reference context, not the focus — closed by default (the InspectPanel
      // resources idiom). Open-state is per-mount on purpose: no persistence.
      defaultOpen={false}
      onOpenChange={(open) => {
        if (open) props.onOpen();
      }}
    >
      <div className="flex flex-col gap-0.5">
        {entities.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            no committed stamps yet
          </p>
        )}
        {entities.map((e) => {
          const expanded = e.entityId === expandedId;
          return (
            <div key={e.entityId}>
              <button
                type="button"
                aria-expanded={expanded}
                title="show this stamp's region in the viewport"
                onClick={() => {
                  const next = expanded ? null : e.entityId;
                  setExpandedId(next);
                  onHighlight(next);
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50",
                  expanded && "bg-muted",
                )}
              >
                <span aria-hidden="true">▦</span>
                <span className="min-w-0 flex-1 truncate font-mono">
                  {e.generator} · seed {e.seed} · {opCount(e)} ops
                </span>
              </button>
              {expanded && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 px-6 py-1 text-xs text-muted-foreground">
                  {Object.entries(e.params).map(([k, v]) => (
                    <Fragment key={k}>
                      <dt className="font-mono">{k}</dt>
                      <dd className="tabular-nums">{formatParam(v)}</dd>
                    </Fragment>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
        <p className="px-1 text-xs text-muted-foreground/60">
          editing committed stamps arrives in F3
        </p>
      </div>
    </CollapsibleSection>
  );
}

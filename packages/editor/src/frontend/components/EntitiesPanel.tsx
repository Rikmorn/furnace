import { cn } from "../lib/cn.ts";
import { clickMode } from "../lib/selection.ts";
import { useEditor } from "./editor-context.ts";

export function EntitiesPanel() {
  const { state, dispatch } = useEditor();
  if (!state.doc)
    return <p className="p-3 text-sm text-muted-foreground">no scene loaded</p>;
  return (
    <ul className="p-2">
      {state.doc.entities.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            className={cn(
              "w-full rounded px-2 py-1 text-left text-sm hover:bg-muted",
              state.selectedEntities.includes(e.id) &&
                "bg-primary/20 text-primary",
            )}
            onClick={(ev) =>
              dispatch({ type: "select-entity", id: e.id, mode: clickMode(ev) })
            }
          >
            {e.id}
          </button>
        </li>
      ))}
    </ul>
  );
}

import { cn } from "../lib/cn.ts";
import { useEditor } from "./editor-context.ts";

export function EntitiesPanel() {
  const { state, dispatch } = useEditor();
  if (!state.doc)
    return <p className="p-3 text-sm text-neutral-500">no scene loaded</p>;
  return (
    <ul className="p-2">
      {state.doc.entities.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            className={cn(
              "w-full rounded px-2 py-1 text-left text-sm hover:bg-neutral-800",
              state.selectedEntity === e.id && "bg-neutral-800 text-emerald-300",
            )}
            onClick={() => dispatch({ type: "select-entity", id: e.id })}
          >
            {e.id}
          </button>
        </li>
      ))}
    </ul>
  );
}

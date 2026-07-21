import { cn } from "../lib/cn.ts";
import { clickMode, SETTINGS_SELECTION } from "../lib/selection.ts";
import { useEditor } from "./editor-context.ts";

export function EntitiesPanel() {
	const { state, dispatch } = useEditor();
	if (!state.doc)
		return <p className="p-3 text-sm text-muted-foreground">no scene loaded</p>;
	const rowCls = (selected: boolean) =>
		cn(
			"w-full rounded px-2 py-1 text-left text-sm transition-colors duration-150 ease-out hover:bg-muted",
			selected && "bg-primary/20 text-primary",
		);
	const worldSelected = state.selectedEntities.includes(SETTINGS_SELECTION);
	return (
		<ul className="p-2">
			{/* Pinned World row: a virtual single-select of the settings sentinel, visually set
          apart from the entity list by a divider + medium weight. */}
			<li className="mb-1 border-b border-border pb-1">
				<button
					type="button"
					aria-pressed={worldSelected}
					className={cn(rowCls(worldSelected), "font-medium")}
					onClick={() =>
						dispatch({
							type: "select-entity",
							id: SETTINGS_SELECTION,
							mode: "replace",
						})
					}
				>
					World
				</button>
			</li>
			{state.doc.entities.map((e) => (
				<li key={e.id}>
					<button
						type="button"
						aria-pressed={state.selectedEntities.includes(e.id)}
						className={cn(
							rowCls(state.selectedEntities.includes(e.id)),
							"font-mono",
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

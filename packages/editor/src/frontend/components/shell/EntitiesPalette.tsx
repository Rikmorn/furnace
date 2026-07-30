// The entities palette: the committed generator entities, and the drift report that
// describes what the last reconfigure disturbed among them. The FIRST organ to leave
// FieldPanel (F4.5a Task 10) — the panel is a control stack, and a list of what the
// world already contains is reference, not control.
//
// It reads its two seams out of the shell's host-state provider (single-slot
// discipline: FieldPanel must not re-subscribe to either) and reaches the host for its
// VERBS the way every other shell surface does — `fieldHostRef` off EditorContext,
// exactly as ShellChrome's ⌘Z does. The verbs are fire-and-forget; nothing here holds
// host state, so there is no action provider to justify.
//
// Bake keeps its confirmation HERE rather than in EntitiesList, for the reason the
// panel kept it: a list that can sever a recipe on its own click has no seam left to
// put a confirmation in.
//
// MIGRATION (until F4.5b): row DELETE (the mock's 🗑) is NOT wired, and cannot be —
// the host has no entity-delete verb at all (swept this task: `openEntity`,
// `setEntityFrozen`, `bakeEntity` and undo are the entire entity-mutating surface).
// Freeze, bake and open ship now; F4.5b owns adding the verb and the row that calls it.
import { useEffect } from "react";
import { useFieldEntities } from "../../hooks/useFieldHostState.tsx";
import { useEditor } from "../editor-context.ts";
import { DriftReport } from "../field/DriftReport.tsx";
import { EntitiesList } from "../field/EntitiesList.tsx";

export function EntitiesPalette() {
	const { fieldHostRef, openConfirm } = useEditor();
	const { entities, drift } = useFieldEntities();

	// Drop any entity-highlight box when this palette goes away. The host outlives it
	// (App owns the host) and has no highlight subscription seam, so a closed or
	// re-opened palette — whose row expansion state resets with it — would otherwise
	// stand next to an amber box no row claims. Collapsing does NOT trip this: a
	// collapsed palette stays mounted behind `hidden`, which is deliberate (its state
	// survives the round trip) and means the box survives with the row that owns it.
	useEffect(
		() => () => fieldHostRef.current?.highlightEntity(null),
		[fieldHostRef],
	);

	// Bake is the ONE irreversible field verb (it severs the recipe), so it goes through
	// the App-owned confirm — the same prompt the destructive world actions use, which
	// also suppresses the global keybindings while it is open.
	const requestBake = (id: number): void => {
		openConfirm({
			title: `Bake stamp #${id}?`,
			message:
				"Baking severs the recipe permanently: this stamp can never be reconfigured again, and its ops become plain history. Only ⌘Z reverses it, and only until the undo stack is discarded or the world is saved and reloaded.",
			confirmLabel: "Bake",
			destructive: true,
			onConfirm: () => fieldHostRef.current?.bakeEntity(id),
		});
	};

	return (
		<div className="flex flex-col text-sm">
			<div className="px-2 py-1">
				<EntitiesList
					entities={entities}
					onHighlight={(id) => fieldHostRef.current?.highlightEntity(id)}
					// Open starts a RECONFIGURE session on the host, which pushes it down
					// the stamp seam — so the staged form appears in the controls palette,
					// where the stamp inspector lives, without this palette knowing that
					// surface exists. The host is the seam; there is no chrome coupling.
					onReconfigure={(id) => fieldHostRef.current?.openEntity(id)}
					onFreeze={(id, frozen) =>
						fieldHostRef.current?.setEntityFrozen(id, frozen)
					}
					onBake={requestBake}
				/>
			</div>
			{/* Renders (DriftReport → null when empty) only while findings exist, beside
          the entities it describes. Owns its own border, so a clean apply shows no
          empty section. */}
			<DriftReport
				findings={drift ?? []}
				onFrame={(f) => fieldHostRef.current?.frameChunks(f.chunks)}
				onDismiss={() => fieldHostRef.current?.dismissDrift()}
			/>
		</div>
	);
}

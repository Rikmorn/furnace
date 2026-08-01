// The entities palette: the committed generator entities, and the drift report that
// describes what the last reconfigure disturbed among them. The FIRST organ to leave
// FieldPanel (F4.5a Task 10) — the panel is a control stack, and a list of what the
// world already contains is reference, not control. Since F4.5b Task 4 it is also the
// LAYERS panel (D-14): the rows carry the full entity verb set and are one half of the
// bidirectional selection sync with the viewport.
//
// The Δ badges do NOT intersect anything here: the host owns both the findings'
// chunk keys and the entity footprints, so it answers "which rows does this report
// touch?" at push time and the provider hands the answer down as a set. This file
// reads it; it does not compute it.
//
// It reads its three seams out of the shell's host-state provider (single-slot
// discipline: no surface below that provider may re-subscribe to anything it owns,
// which since F4.5b Task 12 is all twelve seams the chrome reads) and reaches the host for its
// VERBS the way every other shell surface does — `fieldHostRef` off EditorContext,
// exactly as ShellChrome's ⌘Z does. The verbs are fire-and-forget; nothing here holds
// host state, so there is no action provider to justify.
//
// Bake and DELETE keep their confirmations HERE rather than in EntitiesList, for the
// reason the panel kept bake's: a list that can sever a recipe — or remove a stamp —
// on its own click has no seam left to put a confirmation in.
import { useRef } from "react";
import {
	useFieldEntities,
	useFieldEntitySelection,
} from "../../hooks/useFieldHostState.tsx";
import { useEditor } from "../editor-context.ts";
import { DriftReport } from "../field/DriftReport.tsx";
import { EntitiesList } from "../field/EntitiesList.tsx";

export function EntitiesPalette() {
	const { state, fieldHostRef, openConfirm } = useEditor();
	const { entities, drift, driftedIds } = useFieldEntities();
	const { selectedEntityId } = useFieldEntitySelection();
	const driftSection = useRef<HTMLDivElement | null>(null);

	// Before the engine bundle lands there is no host, so the provider has subscribed to
	// nothing and `entities` is empty for a reason that is not "this world has no
	// stamps". Rendering the list anyway would put "Entities (0)" on screen as a claim
	// about the world — the same gate the FieldPanel control stack held from F1 until it
	// dissolved, which this list used to sit behind. Same sentence as the other palettes
	// deliberately: it is one editor booting, not five.
	if (state.status !== "ready") {
		return (
			<p className="p-3 text-sm text-muted-foreground">
				the field waits for the engine bundle…
			</p>
		);
	}

	// Bake severs the recipe; delete removes the stamp and its ops. Both go through the
	// App-owned confirm — the same prompt the destructive world actions use, which also
	// suppresses the global keybindings while it is open.
	//
	// They are NOT the same kind of irreversible, and the two messages say so: bake is
	// permanent in the log (only ⌘Z reverses it, and only until the stack is discarded),
	// while a delete is one ordinary undo step away — its warning is about SCOPE (how
	// many ops go with the stamp), not about permanence.
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

	const requestDelete = (id: number): void => {
		const entity = entities.find((e) => e.entityId === id);
		// The op count is the whole point of naming it: a row reads "3 ops" but a
		// scatter reads "1 ops" and takes every prop it placed with it, so the
		// number is the honest measure of what is about to go.
		const ops =
			entity === undefined ? 0 : entity.opSpan[1] - entity.opSpan[0] + 1;
		openConfirm({
			title: `Delete stamp #${id}?`,
			message: `Removes ${entity?.generator ?? "this stamp"} #${id} and the ${ops} op${ops === 1 ? "" : "s"} it committed. Edits made after it are replayed onto what is left, so a dig that cut through this stamp survives as a dig into whatever was underneath. ⌘Z puts it back.`,
			confirmLabel: "Delete",
			destructive: true,
			onConfirm: () => fieldHostRef.current?.deleteEntity(id),
		});
	};

	return (
		<div className="flex flex-col text-sm">
			<div className="px-2 py-1">
				<EntitiesList
					entities={entities}
					selectedId={selectedEntityId}
					driftedIds={driftedIds}
					// The host is the seam for BOTH directions: this write comes straight
					// back down `subscribeEntitySelection` as the id the rows style
					// themselves from, so the palette never holds a second copy of it.
					onSelect={(id) => fieldHostRef.current?.selectEntity(id)}
					onShowDrift={() =>
						driftSection.current?.scrollIntoView({ block: "nearest" })
					}
					// Open starts a RECONFIGURE session on the host, which pushes it down
					// the stamp seam — so the staged form appears in the SESSION CARD, a
					// palette of its own, without this palette knowing that surface exists.
					// The host is the seam; there is no chrome coupling. (Since F4.5b Task 10
					// the row CLICK beside this button reaches the same card through
					// `selectEntity`, which is why retiring Open is the first item on this
					// row's composition pass — see EntitiesList's header.)
					onReconfigure={(id) => fieldHostRef.current?.openEntity(id)}
					onFreeze={(id, frozen) =>
						fieldHostRef.current?.setEntityFrozen(id, frozen)
					}
					onDelete={requestDelete}
					onBake={requestBake}
				/>
			</div>
			{/* Renders (DriftReport → null when empty) only while findings exist, beside
          the entities it describes. Owns its own border, so a clean apply shows no
          empty section. The wrapper exists for the Δ badges to scroll to. */}
			<div ref={driftSection}>
				<DriftReport
					findings={drift?.findings ?? []}
					onFrame={(f) => fieldHostRef.current?.frameChunks(f.chunks)}
					onDismiss={() => fieldHostRef.current?.dismissDrift()}
				/>
			</div>
		</div>
	);
}

// Where the action registry's world comes from: this provider reads every state context
// the actions name, builds the {@link ActionCtx} they are handed, and owns the ONE window
// keydown listener that dispatches them.
//
// It is a PROVIDER rather than a hook the shell calls, and that is load-bearing for
// render cost. Assembling the ctx means reading the stats mirror, the world state, the
// view state and the workspace arrangement — values that move on every op and every drag
// frame. Doing that inside `ShellChrome` would re-render the component that BUILDS the
// palette bodies (`content={{ controls: <FieldPanel />, … }}`), rebuilding those elements
// per pointermove and dragging a form-heavy subtree along with them — the exact trap
// `useWorkspace.tsx`'s header names. Here, `children` arrive already built from the
// parent, so a re-render of this component reaches only the actual context CONSUMERS.
//
// There are THREE of those. Two are inside surfaces that unmount when closed, and both
// deliberately: the burger's `RegistryGroup` (Radix mounts menu content only while open)
// and `ShortcutsBody` inside the overlay's `DialogContent` (the Portal renders nothing
// while closed). Read one level higher in either and a closed menu or a closed dialog
// would rebuild its rows on every stats push — and at pointer rate during a grab, since
// the session is a ctx dep.
//
// The third is `ToolRail` (F4.5b Task 8), and it is ALWAYS mounted — the one consumer that
// pays this cost continuously. That was taken deliberately rather than by omission: the
// rail renders four buttons whose armed/disabled state is a function of `gesture`, `tool`,
// `session` and `generators`, i.e. of the ctx, and the alternative is publishing a second
// narrower context beside this one for a four-button column. Its own header records the
// tradeoff. The status bar's `KeymapLine` is NOT a consumer: it reads the two narrow
// contexts it needs (`useFieldTool`, `useFieldStamp`) and stays off this one.
//
// The two ends of an action live in different places on purpose. What an action DOES is
// in `lib/actions.ts` (pure, testable without React); what it can SEE is assembled here.
import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { FieldHost, FieldTool } from "../../viewport-host/index.ts"; // type-only: erased
import { useEditor } from "../components/editor-context.ts";
import type { ActionCtx } from "../lib/actions.ts";
import { brushArming } from "../lib/field-brush.ts";
import { useCatalog } from "./useCatalogs.tsx";
import {
	useFieldEntities,
	useFieldEntitySelection,
	useFieldHostState,
	useFieldSelection,
	useFieldStamp,
	useFieldTool,
} from "./useFieldHostState.tsx";
import { useGlobalKeybindings } from "./useGlobalKeybindings.ts";
import { useViewActions, useViewState } from "./useView.tsx";
import { useWorkspaceActions, useWorkspaceState } from "./useWorkspace.tsx";
import { useWorldActions, useWorldState } from "./useWorld.tsx";

const ActionContext = createContext<ActionCtx | null>(null);

/** The world the actions act on; throws outside the provider. Re-renders its caller
 *  whenever ANY of it moves — which is most frames while the user is working — so read it
 *  only where actions are actually rendered (the burger menu, the keymap line). */
export function useActionContext(): ActionCtx {
	const value = useContext(ActionContext);
	if (!value)
		throw new Error("useActionContext outside <ActionContextProvider>");
	return value;
}

export function ActionContextProvider({
	host,
	children,
}: {
	/** The live host, as a PROP rather than read off `fieldHostRef` during render: the
	 *  shell already has it (ShellChrome takes it as a prop too), and reading a ref while
	 *  rendering is a rule with exactly one documented exemption in this codebase — one
	 *  this component does not need. */
	host: FieldHost | null;
	children: ReactNode;
}) {
	const { openConfirm, confirmRef } = useEditor();
	const { stats } = useFieldHostState();
	const { tool, gesture, setGesture, setTool } = useFieldTool();
	const { stamp } = useFieldStamp();
	const { selection } = useFieldSelection();
	const { entities } = useFieldEntities();
	const { selectedEntityId } = useFieldEntitySelection();
	const world = useWorldState();
	const worldActions = useWorldActions();
	const view = useViewState();
	const viewActions = useViewActions();
	const { hidden } = useWorkspaceState();
	const workspaceActions = useWorkspaceActions();
	const { table } = useCatalog();

	// The registry's staged generators — id and name only, which is all the `S` family
	// needs. A SNAPSHOT read once at engine-ready, unlike the field panel's, which re-reads
	// when the entity catalog lands: the catalog fills an `archetypeId` param's picker
	// options, and no id or name moves with it.
	const [generators, setGenerators] = useState<
		readonly { id: string; name: string }[]
	>([]);
	useEffect(() => {
		if (host === null) return;
		setGenerators(
			host.listGenerators().map((g) => ({ id: g.id, name: g.name })),
		);
	}, [host]);

	/** Which generator `S` opens. Chrome state with no host mirror — the host has no
	 *  concept of an armed stamp, because `startStamp` opens a session outright. */
	const [stampCursor, setStampCursor] = useState<string | null>(null);

	// Arming a brush EFFECT, for the `B` family. The two rules it obeys — paint's clamp
	// to an organic class, and which gestures a brush pick disarms — come from
	// `brushArming`, which the tool palette's own button reads too: a second copy of
	// either here is how a key and a button would come to mean different things.
	const armBrush = useCallback(
		(effect: FieldTool["effect"]): void => {
			const arm = brushArming({
				effect,
				materialId: tool.materialId,
				gesture,
				classes: table.classes,
			});
			setTool({ ...tool, effect, materialId: arm.materialId });
			if (arm.disarmGesture) setGesture(null);
		},
		[tool, table, gesture, setGesture, setTool],
	);

	const run = useMemo<ActionCtx["run"]>(
		() => ({
			world: worldActions,
			view: viewActions,
			workspace: workspaceActions,
			openConfirm,
			setGesture,
			armBrush,
			setStampCursor,
		}),
		[
			worldActions,
			viewActions,
			workspaceActions,
			openConfirm,
			setGesture,
			armBrush,
		],
	);

	const ctx = useMemo<ActionCtx>(
		() => ({
			host,
			gesture,
			tool,
			session: stamp,
			// Resolved HERE rather than carried as an id, so every action reads the same
			// record the palette row shows. `find` over a list of tens, rebuilt only when
			// the list or the id moves.
			selectedEntity:
				selectedEntityId === null
					? null
					: (entities.find((e) => e.entityId === selectedEntityId) ?? null),
			selection,
			stats,
			world: { name: world.name, dirty: world.dirty, busy: world.busy },
			view,
			workspace: { hidden },
			generators,
			stampCursor,
			// MIGRATION (until F4.5b): named undo/redo. Both are null, so `edit.undo` and
			// `edit.redo` render the bare verb and say only WHETHER there is something to
			// step, never WHAT. Naming the op ("Undo dig") needs the log's TAIL, which no
			// host seam exposes today — Task 12 adds it and fills these two, and every
			// surface that renders a label picks it up for nothing. (This marker moved
			// here from `BurgerMenu.tsx` with the labels themselves.)
			history: { undoLabel: null, redoLabel: null },
			run,
		}),
		[
			host,
			gesture,
			tool,
			stamp,
			selectedEntityId,
			entities,
			selection,
			stats,
			world.name,
			world.dirty,
			world.busy,
			view,
			hidden,
			generators,
			stampCursor,
			run,
		],
	);

	// The LATEST ctx, for the window listener. The listener binds ONCE and reads through
	// this ref, which is what makes every dispatch see the state as it is at the keypress
	// rather than as it was when the listener was last bound. Written in an effect (after
	// commit) rather than during render: a render React discards must not be able to leave
	// its ctx behind as the one the next keypress acts on.
	const ctxRef = useRef(ctx);
	useEffect(() => {
		ctxRef.current = ctx;
	});

	useGlobalKeybindings(ctxRef, confirmRef);

	return (
		<ActionContext.Provider value={ctx}>{children}</ActionContext.Provider>
	);
}

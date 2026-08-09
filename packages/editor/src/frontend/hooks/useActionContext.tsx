// Where the action registry's world comes from: this provider reads every state context
// the actions name, builds the {@link ActionCtx} they are handed, and owns the ONE window
// keydown listener that dispatches them.
//
// It is a PROVIDER rather than a hook the shell calls, and that is load-bearing for
// render cost. Assembling the ctx means reading the stats mirror, the world state, the
// view state and the workspace arrangement — values that move on every op and every drag
// frame. Doing that inside `ShellChrome` would re-render the component that BUILDS the
// palette bodies (`content={{ entities: <EntitiesPalette />, … }}`), rebuilding those elements
// per pointermove and dragging a form-heavy subtree along with them — the exact trap
// `useWorkspace.tsx`'s header names. Here, `children` arrive already built from the
// parent, so a re-render of this component reaches only the actual context CONSUMERS.
//
// There are SIX of those, and only ONE of them is always mounted — which is the whole
// point of where each `useActionContext()` call sits.
//
// Four are inside surfaces that unmount when closed, all deliberately: the burger's
// `RegistryGroup` (Radix mounts menu content only while open), `ShortcutsBody` inside the
// overlay's `DialogContent` (the Portal renders nothing while closed), the status bar's
// selection-chip popover body (same Portal mechanism), and `CommandBody` inside the ⌘K
// palette's dialog (same again — and the hungriest of the four, since it resolves a label
// and a gate verdict for the WHOLE table). Read one level higher in any of them and a
// closed menu, dialog or popover would rebuild its rows on every stats push — and at
// pointer rate during a grab, since the session is a ctx dep.
//
// The fifth is `TopBar`'s `BakeButton`, a leaf for the same reason: it is a single control
// whose enabled state is a ctx read, and reading the ctx in `TopBarStrip` instead would
// re-render the whole strip at that rate.
//
// The sixth is `ToolRail` (F4.5b Task 8), and it is ALWAYS mounted — the one consumer that
// pays this cost continuously. That was taken deliberately rather than by omission: the
// rail renders four buttons whose armed/disabled state is a function of `gesture`, `tool`,
// `session` and `generators`, i.e. of the ctx, and the alternative is publishing a second
// narrower context beside this one for a four-button column. Its own header records the
// tradeoff. The status bar's `KeymapLine` is NOT a consumer either: it latches the two
// narrow seams it needs (`useFieldTool`, `useFieldStamp`) and stays off this one.
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
import type { FieldHost, FieldTool } from "../../field-host/index.ts"; // type-only: erased
import { brushArming } from "../../shared/field-brush.ts";
import { useEditor } from "../components/editor-context.ts";
import type { ActionCtx } from "../lib/actions.ts";
import { sessionState } from "../lib/session-answerers.ts";
import { useCatalog } from "./useCatalogs.tsx";
import {
	useFieldEntities,
	useFieldEntitySelection,
	useFieldHistory,
	useFieldHostState,
	useFieldSelection,
	useFieldStamp,
	useFieldTool,
} from "./useFieldHostState.tsx";
import { useGlobalKeybindings } from "./useGlobalKeybindings.ts";
import { usePaletteSummon } from "./usePaletteStack.tsx";
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
	openCommandPalette,
	openShortcuts,
	children,
}: {
	/** The live host, as a PROP rather than read off `fieldHostRef` during render: the
	 *  shell already has it (ShellChrome takes it as a prop too), and reading a ref while
	 *  rendering is a rule with exactly one documented exemption in this codebase — one
	 *  this component does not need. */
	host: FieldHost | null;
	/** Raise the ⌘K palette. A PROP rather than state owned here, because the surface it
	 *  opens is mounted by the shell: an action's `run` must be expressible from the ctx,
	 *  and this is the funnel that makes "open a modal the shell owns" expressible without
	 *  putting a `setState` into the pure table. */
	openCommandPalette: () => void;
	/** Raise the keyboard-shortcut overlay — a PROP for `openCommandPalette`'s reason
	 *  exactly: the shell mounts the dialog, so this is the funnel that makes "open a modal
	 *  the shell owns" expressible from the pure table.
	 *
	 *  It used to be `BurgerMenu`'s own `useState`, which is what made `?` unbindable: a key
	 *  is dispatched by the window listener below, and the registry's `run(ctx)` has no way
	 *  to reach a flag inside a component that is not even mounted while the menu is shut. */
	openShortcuts: () => void;
	children: ReactNode;
}) {
	const { openConfirm, confirmRef, claimLostRef, sessionStateRef } =
		useEditor();
	const { stats } = useFieldHostState();
	const { tool, gesture, pendingStamp, setGesture, setTool } = useFieldTool();
	const { stamp } = useFieldStamp();
	const { selection } = useFieldSelection();
	const { entities } = useFieldEntities();
	const { selectedEntityId } = useFieldEntitySelection();
	const { history } = useFieldHistory();
	const world = useWorldState();
	const worldActions = useWorldActions();
	const view = useViewState();
	const viewActions = useViewActions();
	const { hidden } = useWorkspaceState();
	const workspaceActions = useWorkspaceActions();
	const { table } = useCatalog();
	const summonPalette = usePaletteSummon();

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

	/** Which generator `S` opens. Chrome state with no host mirror, and it stays that way
	 *  now that the host DOES have an armed-stamp state: `pendingStamp` is the generator
	 *  a `startStamp` actually armed, while this is the one the key is POINTED at and
	 *  ⇧S moves without opening anything. The two are different questions, and the arm
	 *  carries its own id precisely so a later cursor move cannot rename it. */
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
			// Names `effect` — this IS the deliberate pick, so under a held ⇧/⌃ the base
			// adopts it and the release lands here rather than on what was armed before.
			setTool({ effect, materialId: arm.materialId });
			// The second clause is the pending stamp's: `setGesture` is also what cancels
			// the arm host-side, and `brushArming` reports no disarm when there is no
			// gesture to drop — so arming a brush from UNDER a pending stamp (gesture
			// already `null`) would leave the stamp armed and the next click drawing its
			// region for a brush the user had just picked.
			if (arm.disarmGesture || pendingStamp !== null) setGesture(null);
		},
		[tool, table, gesture, pendingStamp, setGesture, setTool],
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
			summonPalette,
			openCommandPalette,
			openShortcuts,
		}),
		[
			worldActions,
			viewActions,
			workspaceActions,
			openConfirm,
			setGesture,
			armBrush,
			summonPalette,
			openCommandPalette,
			openShortcuts,
		],
	);

	const ctx = useMemo<ActionCtx>(
		() => ({
			host,
			// The modal truth, as a CALL — read at the instant the gate asks, never at render.
			// That is not a ref read during render: what the closure captures is the ref OBJECT
			// (stable for the provider's life), and `.current` is touched only when a dispatcher
			// invokes it. A boolean here would be a snapshot of something that goes up and down
			// between renders, which is the bug `host.isLooking()` already exists to avoid.
			isConfirmOpen: () => confirmRef.current !== null,
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
			// `busy` is the registry's question, not the bar's: every action that reads it
			// asks "is a world verb running", never which one. Projected here rather than
			// carried through as the word, so the three `enabled` clauses stay a boolean
			// test and only the surface that SHOWS the verb has to know its name.
			world: { name: world.name, dirty: world.dirty, busy: world.job !== null },
			view,
			workspace: { hidden },
			generators,
			stampCursor,
			pendingStamp,
			// The TOP of each stack, which the history seam publishes as the LAST element
			// (its own ordering contract). `null` when the side is empty — which is also the
			// state the action is DISABLED in, so the bare-verb fallback is never what a user
			// acts on.
			//
			// Read off the labels rather than off `stats.undoDepth`: the depth says whether
			// there is a step, the label says WHAT it is, and only one seam carries the second.
			history: {
				undoLabel: history.undo.at(-1) ?? null,
				redoLabel: history.redo.at(-1) ?? null,
			},
			run,
		}),
		[
			host,
			confirmRef,
			gesture,
			tool,
			stamp,
			selectedEntityId,
			entities,
			selection,
			stats,
			world.name,
			world.dirty,
			world.job,
			view,
			hidden,
			generators,
			stampCursor,
			pendingStamp,
			history,
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

	// The backchannel's reader (T4b), filled here because this is where the ctx is BUILT.
	// The alternative was a null-rendering component under the provider calling
	// `useActionContext()` — a seventh always-mounted consumer, re-rendering on every stats
	// push to write one ref.
	//
	// WHAT THIS COSTS, stated rather than waved at: the effect's deps include `ctx`, whose
	// memo takes `stats`, which the host publishes per rAF — so on a watched host this is a
	// cleanup, a setup and two closure allocations per frame. That is real, and it is
	// strictly less than the alternative, which pays all of that PLUS a React render of an
	// extra component. (An earlier version of this comment said "costs nothing", which is
	// the class of runtime claim that should not be made without a measurement.)
	//
	// It CAPTURES `ctx` and `history` rather than reading through `ctxRef`, and the dep list
	// is what makes that safe: the closure is replaced whenever either moves. `ctxRef` exists
	// for the window listener, which binds ONCE and therefore cannot capture anything; this
	// effect is free to, and a captured value is one fewer indirection to keep honest.
	//
	// THE CAMERA IS NOT CAPTURED: it is polled off the host at answer time, and the argument
	// for that lives at `FieldHost.cameraPose` rather than being re-derived here. What
	// belongs HERE is only the consequence for this file — the ctx did not grow a member and
	// this provider took no subscription, so nothing in this subtree re-renders for a pose.
	//
	// The cleanup nulls the reader, which is what makes an unmounted shell answer
	// `{ ready: false }` rather than project a ctx nothing is rendering from. It also runs
	// between every pair of commits, and that is unobservable: React flushes a cleanup and
	// its replacement in one synchronous pass, and the only reader is an event handler that
	// cannot interleave with it.
	useEffect(() => {
		sessionStateRef.current = () => sessionState({ ctx, history });
		return () => {
			sessionStateRef.current = null;
		};
	}, [ctx, history, sessionStateRef]);

	useGlobalKeybindings(ctxRef, confirmRef, claimLostRef);

	return (
		<ActionContext.Provider value={ctx}>{children}</ActionContext.Provider>
	);
}

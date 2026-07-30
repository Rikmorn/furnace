// The world the editor is editing: which one it is, whether it has unsaved edits, and
// every verb that changes either. It is SHELL state, not panel state — the world chip
// reads it, ⌘S drives it, the drawer lists against it — which is exactly why it lives
// here and not in FieldPanel: a control stack that owns the save verb cannot be
// dissolved into palettes, and closing the palette holding it would take ⌘S with it.
//
// It sits UNDER `FieldHostStateProvider` because the dirty bit is derived from the
// stats that provider already owns. `subscribeStats` is a single slot — a second
// subscription here would silently steal the status bar's.
//
// Split into STATE and ACTIONS contexts, the useWorkspace pattern and for the same
// reason: the component that installs the global keybindings needs the verbs and
// nothing else, so it must be able to read them without re-rendering (and rebuilding
// the palette bodies) every time a world is named or goes dirty.
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
import { useEditor } from "../components/editor-context.ts";
import { api } from "../lib/api.ts";
import { WORLD_NAME_RULE } from "../lib/generation.ts";
import { errorMessage } from "../lib/humanize.ts";
import { notify } from "../lib/notify-store.ts";
import {
	loadWorldInto,
	rememberWorld,
	saveWorld,
} from "../lib/world-actions.ts";
import { useFieldHostState } from "./useFieldHostState.tsx";

/** How the drawer was summoned. `browse` is the list; `save-as` is the same list with
 *  the name form already open, which is what an untitled ⌘S turns into — D-21's "name
 *  it at first save" rather than a modal prompt bolted onto the chord. */
export type DrawerMode = "browse" | "save-as";

export type WorldState = {
	/** The world on disk this session is editing, or null for an untitled scratch —
	 *  never prefilled (the W3/W4 gate-clobber lesson: a stale default silently
	 *  overwrites the game's world on the first Save). */
	name: string | null;
	/** Edits since the last save point. Derived from the host's op COUNT changing, which
	 *  is cheap and honest in the direction that matters (an edit always sets it) and
	 *  deliberately imprecise in the other: undoing back to the saved state leaves it
	 *  set. v0 — a content hash is the fix if that ever bites. */
	dirty: boolean;
	/** Non-null while the drawer is open, carrying how it was summoned. */
	drawer: DrawerMode | null;
	/** A world write or read is in flight. In-flight is said AT the controls (they
	 *  disable) rather than in a toast — D-19's mechanism for a long job is a progress
	 *  chip with a cooperative cancel (F4.5c), and a toast slot spent on "saving…" is a
	 *  slot the OUTCOME then can't have. */
	busy: boolean;
};

export type WorldActions = {
	/** ⌘S. A named world writes; an untitled one opens the drawer to be named first. */
	save: () => void;
	/** Write under a NEW name and adopt it (the drawer's name form). */
	saveAs: (name: string) => void;
	/** Save + point worlds/index.json at it: the world the game loads. */
	bake: () => void;
	/** Replace the host's world with a saved one. */
	open: (name: string) => void;
	/** Discard to untitled solid rock. */
	reset: () => void;
	/** Point worlds/index.json at an EXISTING world, behind a confirm that says so. */
	makeDefault: (name: string) => void;
	rename: (from: string, to: string) => void;
	duplicate: (from: string, to: string) => void;
	/** Delete a world directory, behind a confirm. Refused by the daemon for the
	 *  current default. */
	remove: (name: string) => void;
	openDrawer: (mode: DrawerMode) => void;
	closeDrawer: () => void;
};

const WorldStateContext = createContext<WorldState | null>(null);
const WorldActionsContext = createContext<WorldActions | null>(null);

/** Read the live world state; throws outside the provider. */
export function useWorldState(): WorldState {
	const value = useContext(WorldStateContext);
	if (!value) throw new Error("useWorldState outside <WorldProvider>");
	return value;
}

/** Read the world verbs; throws outside the provider. Stable except when the current
 *  world's NAME changes (the verbs close over it), so a consumer that reads only this
 *  is off the per-edit render path. */
export function useWorldActions(): WorldActions {
	const value = useContext(WorldActionsContext);
	if (!value) throw new Error("useWorldActions outside <WorldProvider>");
	return value;
}

export function WorldProvider({ children }: { children: ReactNode }) {
	const { fieldHostRef, openConfirm, store, bakeBusyRef } = useEditor();
	const { stats } = useFieldHostState();
	const [name, setName] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [drawer, setDrawer] = useState<DrawerMode | null>(null);
	const [busy, setBusy] = useState(false);

	// The op count the last stats push carried. `null` means the baseline is being
	// re-established — a load or a New just replaced the world, and the count the chrome
	// will next see belongs to the NEW one, so adopting it must not read as an edit.
	const seenOps = useRef<number | null>(null);
	// The op count AT the last save point. The dirty flag alone answers "is there
	// anything to lose"; the discard confirm has to say HOW MUCH, and a number the user
	// can weigh is the difference between a prompt they read and one they click through.
	const savedOps = useRef(0);

	useEffect(() => {
		if (!stats) return;
		const ops = stats.totalOps;
		if (seenOps.current === null) {
			// First push after a world swap: this count IS the new world's save point.
			savedOps.current = ops;
		} else if (ops !== seenOps.current) {
			setDirty(true);
		}
		seenOps.current = ops;
	}, [stats]);

	/** After a world swap: the next stats push re-seeds the baseline instead of marking
	 *  an edit. The window between the swap and that push is one frame — an edit landing
	 *  inside it is adopted as the baseline and misses ONE dirty flip, corrected by the
	 *  edit after it. */
	const rebaseline = useCallback((): void => {
		seenOps.current = null;
		setDirty(false);
	}, []);

	// The re-entrancy guard for the three long verbs. `busy` is what the CONTROLS read
	// (they disable), but ⌘S has no disabled state to wear — held down it would start a
	// second upload over the first, each with its own cleanDir pass over the same
	// directory. A ref rather than the state, so the verbs can read it without being
	// rebuilt (and going stale) on every flip.
	const inFlight = useRef(false);

	const actions = useMemo<WorldActions>(() => {
		/** How far the session has drifted from its save point, as a COUNT of ops. A
		 *  distance, not a signed direction: undoing below the save point is divergence
		 *  too, and "3 ops" is the honest size of it either way. */
		const unsavedOps = (): number =>
			Math.abs((seenOps.current ?? 0) - savedOps.current);

		/** Run `proceed`, asking first when there is something to lose (charter §7,
		 *  confirm-destructive). A CLEAN session confirms nothing — a prompt that fires on
		 *  every New is one people learn to dismiss without reading, which is how the
		 *  prompts that matter stop working too.
		 *
		 *  The zero-op wording is the documented hole in the dirty bit showing through:
		 *  undoing back to exactly the saved state leaves the flag set with no distance to
		 *  report, so the message drops the number rather than claiming "0 unsaved ops". */
		const confirmDiscard = (
			title: string,
			confirmLabel: string,
			proceed: () => void,
		): void => {
			if (!dirty) {
				proceed();
				return;
			}
			const n = unsavedOps();
			const amount =
				n > 0 ? `${n} unsaved op${n === 1 ? "" : "s"}` : "unsaved edits";
			openConfirm({
				title,
				message: `This session has ${amount} since its last save point. They are discarded, and the field's undo history goes with them.`,
				confirmLabel,
				destructive: true,
				onConfirm: proceed,
			});
		};

		/** One place to say what a daemon verb did. The world verbs are short calls whose
		 *  only visible result is the drawer refreshing off `worlds-changed`, so without a
		 *  line each they read as clicks that did nothing. */
		const runVerb = async (
			describe: string,
			done: string,
			call: () => Promise<unknown>,
		): Promise<boolean> => {
			try {
				await call();
				notify.success(done);
				return true;
			} catch (err) {
				notify.error(`${describe} failed: ${errorMessage(err)}`);
				return false;
			}
		};

		const write = async (
			target: string,
			makeDefault: boolean,
			confirmedTracked = false,
		): Promise<void> => {
			const host = fieldHostRef.current;
			if (!host || inFlight.current) return;
			inFlight.current = true;
			setBusy(true);
			// The SSE bundle-outdated guard reads this: a hard reload mid-write would kill
			// the upload. App owns the reload; the ref is how this reaches it.
			bakeBusyRef.current = true;
			try {
				const outcome = await saveWorld(
					{ api, host },
					{ name: target, makeDefault, confirmedTracked },
				);
				if (outcome.status === "needs-tracked-confirm") {
					openConfirm({
						title: `Overwrite the tracked world "${target}"?`,
						message: `This rewrites worlds/${target}/** — tracked files the game loads. Whatever is committed there is replaced by the world in the editor right now.`,
						confirmLabel: "Overwrite",
						destructive: true,
						onConfirm: () => void write(target, makeDefault, true),
					});
					return;
				}
				if (outcome.status === "invalid-name") {
					notify.error(
						`"${target}" is not a valid world name — ${WORLD_NAME_RULE}`,
					);
					return;
				}
				if (outcome.status !== "saved") return;
				setName(target);
				// The new save point: the count the host last reported. A save changes no
				// ops, so `seenOps` is still current — it is the number the next discard
				// prompt measures against.
				savedOps.current = seenOps.current ?? 0;
				setDirty(false);
				rememberWorld(store, target);
				// A save-as was asked for FROM the drawer, and it has now been answered —
				// leaving the list up over the canvas would make the user dismiss it to see
				// what they just saved. A no-op for the ⌘S path, where nothing is open.
				setDrawer(null);
			} finally {
				inFlight.current = false;
				setBusy(false);
				bakeBusyRef.current = false;
			}
		};

		const open = async (target: string): Promise<void> => {
			const host = fieldHostRef.current;
			if (!host || inFlight.current) return;
			inFlight.current = true;
			setBusy(true);
			try {
				const outcome = await loadWorldInto({ api, host }, { name: target });
				if (outcome.status !== "loaded") return;
				setName(target);
				rebaseline();
				rememberWorld(store, target);
				setDrawer(null);
			} finally {
				inFlight.current = false;
				setBusy(false);
			}
		};

		return {
			save: () => {
				// An untitled world has nowhere to go: naming it IS the save (D-21), and the
				// drawer is where a name is typed beside the rule it has to satisfy.
				if (name === null) setDrawer("save-as");
				else void write(name, false);
			},
			saveAs: (target) => void write(target, false),
			bake: () => {
				// Backstop only — every control that offers Bake is disabled while untitled,
				// with the reason on it.
				if (name === null) notify.error("name the world first (⌘S)");
				else void write(name, true);
			},
			// Both world SWAPS go through the discard gate: they replace the host's
			// world outright, and the op log — the editor's only undo — goes with it.
			// Nothing else in the world verb set destroys unsaved work (a save writes
			// it, a rename/duplicate/delete moves other directories around).
			open: (target) =>
				confirmDiscard(
					`Open "${target}" and discard this session?`,
					"Discard and open",
					() => void open(target),
				),
			reset: () =>
				confirmDiscard("Start a new world?", "Discard", () => {
					fieldHostRef.current?.newWorld();
					setName(null);
					rebaseline();
					setDrawer(null);
					notify.info("new world — all solid rock");
				}),
			makeDefault: (target) =>
				openConfirm({
					title: `Make "${target}" the game's world?`,
					message: `The game will load ${target} instead of whatever worlds/index.json names today. This rewrites worlds/index.json.`,
					confirmLabel: "Make default",
					onConfirm: () => {
						void runVerb("make default", `the game now loads ${target}`, () =>
							api.worldMakeDefault(target),
						);
					},
				}),
			rename: (from, to) => {
				void (async () => {
					const ok = await runVerb("rename", `renamed ${from} → ${to}`, () =>
						api.worldRename(from, to),
					);
					// The session follows its own world across a rename; another world's
					// rename leaves it alone.
					if (ok && name === from) setName(to);
				})();
			},
			duplicate: (from, to) => {
				void runVerb("duplicate", `copied ${from} → ${to}`, () =>
					api.worldDuplicate(from, to),
				);
			},
			remove: (target) =>
				openConfirm({
					title: `Delete "${target}"?`,
					message: `This removes worlds/${target}/ and everything in it. It cannot be undone from the editor.`,
					confirmLabel: "Delete",
					destructive: true,
					onConfirm: () => {
						void (async () => {
							const ok = await runVerb("delete", `deleted ${target}`, () =>
								api.worldDelete(target),
							);
							// The world in the host outlives its directory — the session keeps
							// every edit, it just has nowhere on disk to go back to, so it
							// becomes untitled rather than pointing at a path that is gone.
							if (ok && name === target) setName(null);
						})();
					},
				}),
			openDrawer: setDrawer,
			closeDrawer: () => setDrawer(null),
		};
		// `dirty` is a real input, not noise: `confirmDiscard` reads it to decide whether
		// to prompt at all, and a stale capture would either skip the prompt on a dirty
		// session (silent data loss) or raise it on a clean one. It flips at most twice per
		// save cycle, so rebuilding the verbs on it costs nothing.
	}, [name, dirty, fieldHostRef, openConfirm, store, bakeBusyRef, rebaseline]);

	const value = useMemo<WorldState>(
		() => ({ name, dirty, drawer, busy }),
		[name, dirty, drawer, busy],
	);

	return (
		<WorldActionsContext.Provider value={actions}>
			<WorldStateContext.Provider value={value}>
				{children}
			</WorldStateContext.Provider>
		</WorldActionsContext.Provider>
	);
}

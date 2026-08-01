// The world the editor is editing: which one it is, whether it has unsaved edits, and
// every verb that changes either. It is SHELL state, not panel state — the world chip
// reads it, ⌘S drives it, the drawer lists against it — which is exactly why it lives
// here and not in the dissolved FieldPanel control stack: a stack that owns the save verb
// cannot itself be dissolved into palettes, and closing the palette holding it would have
// taken ⌘S with it.
//
// It sits UNDER `FieldHostStateProvider` because the dirty bit is derived from the
// stats that provider already owns. `subscribeStats` is a single slot — a second
// subscription here would silently steal the status bar's.
//
// Split into STATE and ACTIONS contexts, the useWorkspace pattern. Be precise about what
// that buys, because the obvious claim is wrong: the verbs close over `name` and `dirty`,
// so they DO rebuild when either changes, and a consumer of the actions context re-renders
// then too. What the split isolates is the rest of the state — `drawer` and `job` — which
// churn on a different order of magnitude: every summon, every dismiss, and twice per save.
// ShellChrome (which builds the palette bodies, and so re-renders every palette whenever
// it re-renders) reads verbs only, and is therefore off all of that.
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
	worldToRestore,
} from "../lib/world-actions.ts";
import { useCatalog } from "./useCatalogs.tsx";
import { useFieldHostState } from "./useFieldHostState.tsx";

/** How the drawer was summoned. `browse` is the list; `save-as` is the same list with
 *  the name form already open, which is what an untitled ⌘S turns into — D-21's "name
 *  it at first save" rather than a modal prompt bolted onto the chord. */
export type DrawerMode = "browse" | "save-as";

/** Which long world verb is in flight — the WORD the status bar shows, not a second flag
 *  beside a boolean. One field says both "is one running" and "which", because two would
 *  need a rule for what a `true` with no name means.
 *
 *  Three rather than two: `saving` and `baking` are the same code path (`write`, with and
 *  without `makeDefault`) and the same wait, but they are not the same promise — a bake
 *  also repoints `worlds/index.json` at the world, i.e. changes what the GAME loads, and a
 *  user who pressed Bake is owed that word rather than the milder one. */
export type WorldJob = "saving" | "baking" | "opening";

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
	/** The world write or read in flight, or `null`. Said in TWO places and neither is a
	 *  toast: at the controls (they disable) and on the status bar (D-19's progress chip,
	 *  which is what this word is for). A toast slot spent on "saving…" is a slot the
	 *  OUTCOME then can't have.
	 *
	 *  There is no cancel to go with it, and that is D-F4.5-19's own second clause — "the
	 *  job polls; no cancel theater". Nothing here can poll: see `write`. */
	job: WorldJob | null;
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

/** Read the world verbs; throws outside the provider. Rebuilt when `name` or `dirty`
 *  changes — both are real inputs (the verbs write to the named world; `confirmDiscard`
 *  reads the flag), so a stale capture would be a correctness bug, not a saved render.
 *  What a reader of this context does NOT pick up is `drawer` and `job`, which move far
 *  more often: every drawer summon and dismiss, and twice per save. */
export function useWorldActions(): WorldActions {
	const value = useContext(WorldActionsContext);
	if (!value) throw new Error("useWorldActions outside <WorldProvider>");
	return value;
}

export function WorldProvider({ children }: { children: ReactNode }) {
	const { fieldHostRef, openConfirm, store, bakeBusyRef } = useEditor();
	const { stats } = useFieldHostState();
	const { catalogSettled } = useCatalog();
	const [name, setName] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [drawer, setDrawer] = useState<DrawerMode | null>(null);
	const [job, setJob] = useState<WorldJob | null>(null);

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

	// The re-entrancy guard for the three long verbs. `job` is what the CONTROLS and the
	// status bar read, but ⌘S has no disabled state to wear — held down it would start a
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
		 *  line each they read as clicks that did nothing.
		 *
		 *  Deliberately NOT serialised against each other or against a write: rename,
		 *  duplicate, delete and make-default can interleave. Accepted posture — this is a
		 *  single-user tool driving a local daemon, where the interleaving takes two hands on
		 *  one keyboard, and each verb is one atomic fs call the daemon either performs or
		 *  refuses. A queue here would be machinery for a race nobody can run. */
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

		/** THE long job, and the one D-F4.5-19's "cooperative cancel" was written for. It
		 *  does not get one, and the reason is mechanical rather than a matter of taste —
		 *  recorded here because this is where the ✕ would have to be wired.
		 *
		 *  Phase 1 is `bakeFieldWorld` inside `exportArtifact`, a non-`async` function in
		 *  `packages/core` with no `await` anywhere in its per-chunk loop. A flag polled
		 *  there could be set and never read: no event, no rAF and no paint happens between
		 *  the loop's first chunk and its last, because the whole thing runs to completion
		 *  on the main thread. Making it pollable means changing a signature inside core.
		 *  Phase 2 is one or two `fetch` POSTs with no `AbortSignal` in sight, and the
		 *  daemon `rmSync`s the world directory before rewriting it — so an abort lands in
		 *  the same state as a failure, which `world-actions.ts` deliberately refuses to
		 *  characterise ("by here the first call may have cleanDir'd the directory and
		 *  written part of it"). A ✕ over that is theatre.
		 *
		 *  Re-check if either premise moves: an async or chunk-yielding `bakeFieldWorld`,
		 *  or an `AbortSignal` on the api client with a daemon that writes atomically.
		 *
		 *  The job is announced BEFORE the first `await`, and that ordering is what makes
		 *  the chip worth anything: `saveWorld` awaits `world.list` before it reaches the
		 *  synchronous bake, so React commits and paints this word while the main thread is
		 *  still free. Reverse those two and the chip would appear only after the freeze it
		 *  exists to explain. */
		const write = async (
			target: string,
			makeDefault: boolean,
			confirmedTracked = false,
		): Promise<void> => {
			const host = fieldHostRef.current;
			if (!host || inFlight.current) return;
			inFlight.current = true;
			setJob(makeDefault ? "baking" : "saving");
			// The SSE bundle-outdated guard reads this: a hard reload mid-write would kill
			// the upload. App owns the reload; the ref is how this reaches it.
			bakeBusyRef.current = true;
			// Snapshotted BEFORE the write, and that ordering is the whole correctness of the
			// dirty bit across a save. The upload is an AWAIT — a round trip to check tracked
			// status, then one or two uploads — and the user can keep digging through all of
			// it. Reading the count AFTERWARDS folds those ops into the save point: the chip
			// goes clean, and the discard gate then throws them away without asking, which is
			// the one outcome this whole mechanism exists to prevent.
			//
			// Conservative in the safe direction, deliberately. `exportArtifact` runs inside
			// `saveWorld`, one round trip after this line, so an op landing in that window IS
			// on disk yet still counts as unsaved. The cost is a dirty dot a second ⌘S clears;
			// the opposite error costs the user their work.
			const opsAtWrite = seenOps.current ?? 0;
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
				// The save point is what was WRITTEN, not where the session has got to. Anything
				// the user dug while the upload was in flight is still unsaved, and the flag has
				// to say so — a blanket `setDirty(false)` here is exactly the silent adoption the
				// snapshot above exists to stop.
				savedOps.current = opsAtWrite;
				setDirty((seenOps.current ?? 0) !== opsAtWrite);
				rememberWorld(store, target);
				// A save-as was asked for FROM the drawer, and it has now been answered —
				// leaving the list up over the canvas would make the user dismiss it to see
				// what they just saved. A no-op for the ⌘S path, where nothing is open.
				setDrawer(null);
			} finally {
				inFlight.current = false;
				setJob(null);
				bakeBusyRef.current = false;
			}
		};

		/** The other long job, and uncancellable for a simpler reason than `write`'s: it is
		 *  a single `fetch` with no `AbortSignal`, and it ends in `loadWorld`, which
		 *  replaces the host's world outright. There is no half-way state to return to. */
		const open = async (target: string): Promise<void> => {
			const host = fieldHostRef.current;
			if (!host || inFlight.current) return;
			inFlight.current = true;
			setJob("opening");
			try {
				const outcome = await loadWorldInto({ api, host }, { name: target });
				if (outcome.status !== "loaded") return;
				setName(target);
				rebaseline();
				rememberWorld(store, target);
				setDrawer(null);
			} finally {
				inFlight.current = false;
				setJob(null);
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
							// And it is DIRTY by that same fact: content that exists nowhere on
							// disk is the definition of unsaved, whatever the op count says. The
							// save point went with the directory, so the next New or Open has to
							// ask before discarding it.
							if (ok && name === target) {
								setName(null);
								setDirty(true);
							}
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

	// THE BOOT RESTORE. `lastWorld` is written on every save and every open; this is the
	// one thing that reads it back, and the posture is the desktop app's — reopen what you
	// were in, without asking.
	//
	// It fires ONCE per boot (`restored`, the useView/useWorkspace one-shot ref) and only
	// into a session with nothing to lose: untitled AND unedited. Both halves are reachable
	// before this runs, because the store arrives from an async `project.get` and the
	// catalog settles on its own schedule — so the user can dig, or name a world, first.
	// Live intent beats what was on disk, and the restore is then DROPPED rather than
	// confirmed: an unrequested prompt at boot asking whether to discard work the user did
	// seconds ago is a worse answer than leaving them where they are.
	//
	// Gated on `catalogSettled`, which is the STRONGER gate rather than a stand-in for
	// engine-ready. A v2 world remeshes against the material table it was baked with, so a
	// load racing the catalog fetch is the grey-world bug the drawer's own Load gate exists
	// to prevent — and at boot that race is certain, not rare. It covers engine-ready in
	// passing: CatalogProvider does not start the fetch until `state.status === "ready"`
	// with the host assigned, so a settled catalog means both have happened. (`open`
	// refuses without a host regardless — that is the backstop, not the gate.) It is also
	// why the shell mounts CatalogProvider ABOVE this provider.
	const restored = useRef(false);
	useEffect(() => {
		if (!catalogSettled || !store || restored.current) return;
		restored.current = true;
		// `name !== null` is the save-as that landed before `project.get` resolved: the blob
		// still names the PREVIOUS session's world, and adopting it would swap the world out
		// from under one the user has just named.
		if (name !== null || dirty) return;
		const opsAtDecision = seenOps.current ?? 0;
		void (async () => {
			const target = await worldToRestore({ api }, store);
			if (target === null) return;
			// Re-read across the round trip. The `dirty` above is this render's value and the
			// verbs closed over the same one, so an op landing while `world.list` was in
			// flight is invisible to both — the live count is the only witness.
			if ((seenOps.current ?? 0) !== opsAtDecision) return;
			// The ORDINARY verb, never a second load path: `busy`, the toast and the
			// rebaseline are the ones a user-driven Open produces, by construction. Its
			// discard confirm cannot fire from here — a clean session proceeds straight
			// through.
			actions.open(target);
		})();
	}, [catalogSettled, store, name, dirty, actions]);

	const value = useMemo<WorldState>(
		() => ({ name, dirty, drawer, job }),
		[name, dirty, drawer, job],
	);

	return (
		<WorldActionsContext.Provider value={actions}>
			<WorldStateContext.Provider value={value}>
				{children}
			</WorldStateContext.Provider>
		</WorldActionsContext.Provider>
	);
}

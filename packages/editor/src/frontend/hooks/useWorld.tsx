// The world the editor is editing: which one it is, whether it has unsaved edits, and
// every verb that changes either. It is SHELL state, not panel state — the world chip
// reads it, ⌘S drives it, the drawer lists against it — which is exactly why it lives
// here and not in the dissolved FieldPanel control stack: a stack that owns the save verb
// cannot itself be dissolved into palettes, and closing the palette holding it would have
// taken ⌘S with it.
//
// It sits UNDER `FieldHostStateProvider` because the dirty bit is derived from the stats
// seam, which it reads through `useFieldHostState` — its own latch on that seam, beside
// the status bar's, which is what multicast makes ordinary (see that file's header).
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
import {
	ACTION_OK,
	type ActionResult,
	failed,
	refused,
} from "../../action-registry/index.ts";
import { useEditor } from "../components/editor-context.ts";
import { sayResult } from "../lib/actions.ts";
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

/** Which long world verb is in flight, or `null`. One field says both "is one running"
 *  and "which", because two would need a rule for what a `true` with no name means.
 *
 *  Named for the VERB, not for what a readout calls it while it runs: these are state
 *  tags, and the label belongs to whatever surface is doing the labelling (today the
 *  status bar's `JOB_LABELS`). A tag spelled "saving" would be a UI string living in
 *  state, which is the coupling that table exists to break.
 *
 *  Three rather than two: `save` and `bake` are the same code path (`write`, with and
 *  without `makeDefault`) and the same wait, but they are not the same promise — a bake
 *  also repoints `worlds/index.json` at the world, i.e. changes what the GAME loads, and a
 *  user who pressed Bake is owed that word rather than the milder one. */
export type WorldJob = "save" | "bake" | "open";

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
	/** ⌘S. A named world writes; an untitled one opens the drawer to be named first.
	 *
	 *  THE THREE WRITE VERBS ANSWER, since foundations T3b2 Task 4, and the other eight
	 *  below do not — an asymmetry with a reason rather than a half-finished migration.
	 *  These three are what `world.save` / `world.saveAs` / `world.bake` dispatch INTO, and
	 *  an action has to be able to say whether it did the thing. They were fired into the
	 *  void (`void write(...)`), which made a rejection out of the upload an unhandled
	 *  promise rejection and left a caller unable to tell a save from a refusal.
	 *
	 *  THE OTHER EIGHT DO NOT, and the reason is that no action needs their VERDICT — not
	 *  that no action reaches them, which is what this said until the T3b2 review measured
	 *  it. Four actions do reach three of them: `world.new` → `reset`, `world.open` and an
	 *  input-less `world.saveAs` → `openDrawer`, `world.makeDefault` → `makeDefault`. Every
	 *  one of those completes its dispatch by RAISING A SURFACE — a confirm, the drawer —
	 *  and `ok` is the honest answer to "was it raised". What the user then does with the
	 *  surface is a second dispatch. The remaining five have no action caller at all, and
	 *  each already reports on its own channel (`runVerb`'s toast). */
	save: () => Promise<ActionResult>;
	/** Write under a NEW name and adopt it (the drawer's name form, and `world.saveAs`
	 *  when a caller names the copy). */
	saveAs: (name: string) => Promise<ActionResult>;
	/** Save + point worlds/index.json at it: the world the game loads. */
	bake: () => Promise<ActionResult>;
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

/** What a boot with nothing to reopen AND nothing already dug says, once. Both halves of
 *  that condition are load-bearing and the second is the subtle one: a session can read
 *  CLEAN while plainly not being empty, because the first stats push after a world swap
 *  seeds the baseline rather than marking an edit — so `dirty` alone would hand this line
 *  to someone mid-dig. See the decision site in the boot effect below.
 *
 *  The editor comes up on solid rock with no world named and no control pressed, which is
 *  indistinguishable from a broken one until something says so — this is D-21's "new =
 *  untitled scratch, name at first save" spelled as the two moves that get a user out of
 *  it, in the order they happen.
 *
 *  "dig into the rock" names an INTENTION, not a gesture, and that is deliberate: a fresh
 *  host boots with the `pointer` gesture armed, so LMB selects rather than strokes
 *  (`field-host/field-host.ts` — "`pointer` is the DEFAULT one, so this branch — not
 *  the stroke below — is what a fresh host does with its first click"). Digging needs the
 *  Dig brush armed first, which drops the gesture. A "drag to dig" here would name a
 *  gesture that, at the exact moment this fires, does something else. */
const FIRST_RUN_HINT = "new world — dig into the rock, then ⌘S to save";

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
	const { fieldHostRef, openConfirm, store, bakeBusyRef, setAuthoredWorld } =
		useEditor();
	const { stats } = useFieldHostState();
	const { catalogSettled } = useCatalog();
	const [name, setName] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [drawer, setDrawer] = useState<DrawerMode | null>(null);
	const [job, setJob] = useState<WorldJob | null>(null);

	// The session claim is asserted at App level, ABOVE this provider, and it claims under
	// the world this session is authoring — so every change of `name` has to travel up. A
	// call rather than a lift of the state: `name` is the axis this whole provider is built
	// around, and moving it to App would take every world verb with it.
	//
	// EVERY change, including the one back to `null` that New performs, and including the
	// first: the claim value-guards its own key, so a mount that reports the untitled
	// scratch it is already on posts nothing.
	useEffect(() => {
		setAuthoredWorld(name);
	}, [name, setAuthoredWorld]);

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
		): Promise<ActionResult> => {
			const host = fieldHostRef.current;
			// Two refusals in one guard and they are different sentences on purpose: "the
			// engine is not up" and "one is already running" are the two states a caller
			// retries differently. One `if (!host || inFlight.current) return;` before T3b2
			// Task 4, and NAMED here because a verb that answers cannot answer `ok` for
			// something it did not do.
			//
			// A DELIBERATE BEHAVIOUR DELTA, and BOTH halves are reachable — each is pinned by
			// a case that would have failed before the change (`world-boot-restore.test.ts`
			// §(e), and the pre-engine save-as in `world-drawer.test.tsx`). Neither is the
			// path it first looks like, so both are written down:
			//
			//   NO HOST is NOT a pre-engine ⌘S. `save`/`bake` only reach here with
			//   `name !== null`, and `name` is set only inside `write`/`open` — both of which
			//   already had a host, which `App.tsx` assigns once and never nulls. So
			//   `name !== null && host === null` cannot happen and a pre-engine ⌘S takes the
			//   `setDrawer("save-as")` branch. `saveAs` is the way in: it takes the name from
			//   the FORM and has no such precondition, `App.tsx` renders the shell
			//   unconditionally, and `busy` is false pre-engine so Save is live. ⌘S → type a
			//   name → Save, before the bundle lands.
			//
			//   IN FLIGHT is the window `inFlight` exists for, named in its own docblock
			//   above: `job` is React state and every control reads it, but a HELD ⌘S repeats
			//   faster than a commit, and the ref is what covers the gap the state cannot.
			//
			// Both used to do nothing and say nothing — the failure mode W-1 spent a whole
			// round closing everywhere else.
			if (!host) return refused("the engine is not up yet", "inert");
			if (inFlight.current)
				return refused("a world write is already running", "inert");
			inFlight.current = true;
			setJob(makeDefault ? "bake" : "save");
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
						// `.then(sayResult)` like every other caller of a world verb: no sentence
						// is lost today (all three of `write`'s own refusals are unreachable on a
						// re-entry that already got past them once, and a `failed` was already
						// said by `world-actions.ts`), but this is the one call site that would
						// otherwise break "one funnel, and it says the verdict once" — and it is
						// the site most likely to grow a refusal later.
						onConfirm: () =>
							void write(target, makeDefault, true).then(sayResult),
					});
					// The confirm was RAISED, which is what this dispatch was for. What the user
					// then answers is a second dispatch (`onConfirm` re-enters here), not this
					// one's verdict — and awaiting a human decision would leak the promise on
					// every cancel.
					return ACTION_OK;
				}
				if (outcome.status === "invalid-name")
					// THE ONE SENTENCE THAT MOVED. It was a `notify.error` on this line; it is now
					// the action's verdict, said once by the dispatch funnel (`sayResult`, which
					// uses `notify.error` so the toast is the same one it always was). This is the
					// only failure in `write` that `write` itself decides — every other one below
					// belongs to `world-actions.ts`, which composes and says its own.
					return refused(
						`"${target}" is not a valid world name — ${WORLD_NAME_RULE}`,
						"inert",
					);
				// `saveWorld` has ALREADY said this on its own channel ("bake failed: ENOSPC",
				// "save refused — could not check whether worlds/x is tracked …"). Surfaced
				// rather than re-said: the funnel stays quiet on a `failed`, and the message
				// travels to a caller who is not looking at the screen.
				if (outcome.status === "failed") return failed(outcome.message);
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
				return ACTION_OK;
			} finally {
				inFlight.current = false;
				setJob(null);
				bakeBusyRef.current = false;
			}
		};

		/** The other long job, and uncancellable for a simpler reason than `write`'s: it is
		 *  a single `fetch` with no `AbortSignal`, and it ends in `loadWorld`, which
		 *  replaces the host's world outright. There is no half-way state to return to.
		 *
		 *  Re-check if the api client gains an `AbortSignal`: unlike `write`, an aborted
		 *  read leaves NOTHING half-done — the session simply stays on the world it was
		 *  already in — so this is the one of the three that a cancel could honestly serve
		 *  the day the seam exists. */
		const open = async (target: string): Promise<void> => {
			const host = fieldHostRef.current;
			if (!host || inFlight.current) return;
			inFlight.current = true;
			setJob("open");
			try {
				const outcome = await loadWorldInto({ api, host }, { name: target });
				if (outcome.status !== "loaded") return;
				// FRAME WHAT WAS JUST OPENED (F4.5 holistic gate, ruling 5). Open used to
				// leave the camera exactly where it already was, which on a fresh session is
				// a 6 m orbit about the origin — outside anything a saved world contains, so
				// the first thing a user saw after opening was nothing at all.
				//
				// GUARDED, because a user who has arranged this camera must not have it taken
				// off them. The guard is a latch on the host ("has any aim verb run") rather
				// than a comparison against the boot pose — see `cameraAimedByHand`, and note
				// `frameWorld` deliberately does not set it, so opening A and then B frames
				// both while one orbit in between stops both.
				//
				// HERE and not inside `host.loadWorld`, which was the first attempt: that
				// method is a data primitive and is also every headless suite's fixture
				// loader, so framing from there re-aimed nine GPU and analyzer tests' rays.
				// `Open` is the verb the ruling names, and this is where `Open` lives.
				if (!host.cameraAimedByHand()) host.frameWorld();
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
				// drawer is where a name is typed beside the rule it has to satisfy. Opening
				// it IS the save verb succeeding at what it can do here — the write that
				// follows is a second dispatch.
				if (name === null) {
					setDrawer("save-as");
					return Promise.resolve(ACTION_OK);
				}
				return write(name, false);
			},
			saveAs: (target) => write(target, false),
			bake: () => {
				// Backstop only — every control that offers Bake is disabled while untitled,
				// with the reason on it. The sentence was a `notify.error` here; it is now the
				// verdict, said once by the dispatch funnel.
				if (name === null)
					return Promise.resolve(refused("name the world first (⌘S)", "inert"));
				return write(name, true);
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
			// DELIBERATELY NOT `destructive: true`, unlike delete and overwrite-a-tracked-world.
			// This rewrites one line of worlds/index.json and destroys nothing: every world on
			// disk is still there afterwards, and the verb's own inverse is running it again on
			// the previous default. The red button is reserved for the operations that lose
			// data, so that when it appears it still means something.
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

	// THE BOOT RESTORE, and its other outcome — the first-run hint. `lastWorld` is written
	// on every save and every open; this is the one thing that reads it back, and the
	// posture is the desktop app's — reopen what you were in, without asking. When there
	// is nothing to reopen, the session that stays is a brand-new one, and this is where
	// it gets told so (see `FIRST_RUN_HINT` below).
	//
	// One effect for both, so the `restored` one-shot latches both: "once per boot" is the
	// whole difficulty of a hint, and a second effect would need its own copy of every
	// condition this one already settles. Boot-scoped means BOOT — a reload posts it
	// again (there is no persisted "seen it" flag, and a hint that can never come back is
	// a hint nobody can find on purpose), while a New world mid-session posts nothing,
	// because the one-shot is already spent.
	//
	// Both outcomes wait on the STORE, which is the one thing the hint gives up by riding
	// here: a `project.get` that never resolves leaves persistence off, and a boot with no
	// store cannot tell "no world to reopen" from "not yet". Neither answer is worth
	// guessing at.
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
			// Re-read across the round trip. The `dirty` above is this render's value and the
			// verbs closed over the same one, so an op landing while `world.list` was in
			// flight is invisible to both — the live count is the only witness.
			if ((seenOps.current ?? 0) !== opsAtDecision) return;
			if (target === null) {
				// Nothing to reopen and nothing dug: a FIRST RUN, and the one moment worth a
				// toast slot for saying what this editor is for. Posted from HERE rather than
				// from an effect of its own because this is the instant all three facts are
				// settled together — the catalog gate above, the session's own emptiness, and
				// the restore having declined. A hint racing ahead of this line would be
				// contradicted by the world that arrives a moment later.
				//
				// `opsAtDecision` rather than the `stats` object: this effect does not depend
				// on stats, so reading them from the closure would give the count as it was
				// when the effect last ran. It is also the guard `dirty` cannot supply — the
				// FIRST push after a swap seeds the baseline rather than marking an edit, so a
				// session can read clean while plainly not being empty.
				if (opsAtDecision === 0) notify.info(FIRST_RUN_HINT);
				return;
			}
			// The ORDINARY verb, never a second load path: the `job` tag, the toast and the
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

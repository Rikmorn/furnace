// The shell's status bar: 28 px, opaque, fixed height — the other half of the canvas
// cell's inset budget (see TopBar).
//
// It carries four things: the viewport keymap (left), the engine/error report, the ⚠
// chip that summons the message log, and the live host chips (right). The chips come
// from `useFieldHostState`, NOT from an own subscription — subscribeStats is a single
// slot and a second subscriber would silently steal the first's callback.
import { TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import type {
	FieldTool,
	StampSession,
	ViewportGesture,
} from "../../../viewport-host/index.ts"; // type-only: erased
import {
	useFieldHostState,
	useFieldStamp,
	useFieldTool,
} from "../../hooks/useFieldHostState.tsx";
import { usePaletteRaise } from "../../hooks/usePaletteStack.tsx";
import { useWorkspaceActions } from "../../hooks/useWorkspace.tsx";
import { notify } from "../../lib/notify-store.ts";
import type { EditorState } from "../../lib/state.ts";
import { useEditor } from "../editor-context.ts";

function engineLabel(state: EditorState): string {
	if (state.status === "engine-error") return "engine: BUILD FAILED";
	if (state.status === "no-webgpu") return "engine: no WebGPU";
	if (state.status === "booting") return "engine: starting…";
	return "engine: ok";
}

/** One line per armed state — what the keys do RIGHT NOW. It answers the question a modal
 *  editor makes people ask constantly ("what does clicking do in this mode?") at the
 *  moment they ask it, which the static line it replaces could not.
 *
 *  Enumerated here rather than derived from the action table, and deliberately so: the
 *  registry knows what a key RUNS, not which four of two dozen bindings matter in a given
 *  mode — and the canvas-owned keys (`[`/`]`, ⇧, ⌃, the arrows) are half of what belongs
 *  on this line and are not in the table at all.
 *
 *  Keycaps are written the way the rest of the editor writes them — ⌘ ⇧ ⌃ ⌥ ⏎ ⌫ and
 *  `Esc`, matching the overlay and the menu. Two spellings of one key is drift that reads
 *  as two different keys, and it is part of how this line's old static clause got away
 *  with naming three keys the host does not bind.
 *
 *  Exported for its test: these strings ARE the claim, and asserting them through the DOM
 *  would be asserting the same thing twice. */
export function armedKeymap(
	tool: FieldTool,
	gesture: ViewportGesture | null,
	session: StampSession | null,
): string {
	// A live session owns the interaction — the family keys refuse while it stands, so
	// what is left to say is how it ENDS. A move adds the one verb only a move has.
	if (session !== null)
		return session.moving === true
			? "drag ghost move · R rotate ¼ · ⏎ drop · Esc revert"
			: "← → ↑ ↓ nudge · R rotate ¼ · ⏎ apply · Esc discard";
	if (gesture === "pointer") return "LMB select · G grab · F frame · ⌫ delete";
	if (gesture === "box") return "click ×2 spans a region · Esc clears";
	if (gesture === "material")
		return "LMB floods the clicked material · Esc clears";
	if (gesture === "void") return "LMB floods an air pocket · Esc clears";
	if (gesture === "segment")
		return "click ×2 sweeps the brush · [ ] radius · Esc drops the point";
	// The brush itself, with the armed effect NAMED: it is what LMB is about to do, and
	// the four read very differently. Joined from parts rather than interpolated, so an
	// effect with no live modifiers ends at the radius instead of a dangling separator.
	return [
		`LMB ${tool.effect}`,
		"[ ] radius",
		...modifierParts(tool.effect),
	].join(" · ");
}

/** Which momentary/sticky overrides are LIVE under `effect`, derived rather than stated.
 *
 *  A static clause was wrong three ways at once, and none of them was catchable by a test
 *  that pinned the string: `deriveMomentary` swaps dig↔fill SYMMETRICALLY, so under fill
 *  ⌃ gives *dig*, not fill; under paint and smooth ⌃ passes through entirely and
 *  `tool.swapEffect` is disabled, so both "⌃ fill" and "X swap" named dead keys; and
 *  "⇧ smooth" under smooth names a no-op. Verified against `field-host.ts`'s
 *  `deriveMomentary` and the registry's own `enabled`. */
function modifierParts(effect: FieldTool["effect"]): string[] {
	const parts: string[] = [];
	// ⇧ derives smooth from whatever is armed — nothing to say when it already is.
	if (effect !== "smooth") parts.push("⇧ smooth");
	// ⌃ is the momentary half of the swap `X` makes sticky, and both are live only on the
	// two carving effects. The swap is SYMMETRIC, so each names what it would give.
	if (effect === "dig") parts.push("⌃ fill", "X swap");
	if (effect === "fill") parts.push("⌃ dig", "X swap");
	return parts;
}

/** The keymap line, in its own component so only IT re-renders: the session context pushes
 *  a clone on every nudge and every preview — pointer rate while a move is live — and the
 *  chips and the error line beside it have nothing to do with that. */
function KeymapLine() {
	const { tool, gesture } = useFieldTool();
	const { stamp } = useFieldStamp();
	return (
		<span className="whitespace-nowrap">
			{armedKeymap(tool, gesture, stamp)}
		</span>
	);
}

/** The one clickable chip in this slice (D-19's stats-chip popovers are F4.5c). It
 *  appears only while errors are UNREAD: a badge that never clears is a badge people
 *  stop seeing, and the log stays reachable from the View menu once it has. */
function ErrorChip() {
	const { unreadErrors } = useSyncExternalStore(
		notify.subscribe,
		notify.getSnapshot,
	);
	const { setOpen, setCollapsed, setHidden } = useWorkspaceActions();
	const raise = usePaletteRaise();
	if (unreadErrors === 0) return null;
	return (
		<button
			type="button"
			// SUMMONS rather than toggles: opening the log is what marks it read, which
			// takes this chip away — so there is never a second click here to close with.
			// The palette's own × and the View menu are the way back.
			//
			// All FOUR verbs, because `open` alone does not mean "readable" and the other
			// three states persist or outlive the click: a palette closed while collapsed
			// comes back collapsed (the arrangement survives closing, by design), the ⌘\
			// latch covers the whole layer, and the DEPTH is the one the log shares its
			// default corner with the entities palette on. Any one of them left out leaves
			// the summoned log unreadable — which, since being read is what clears this
			// chip, is a click that can never succeed, on a chip that never goes away.
			//
			// `raise` is UNCONDITIONAL rather than riding the open transition: the log is
			// very often already open and merely buried (that is precisely the state this
			// chip appears in — the log marks nothing read while it is not on top), and in
			// that case there is no transition for the layer's safety net to catch.
			onClick={() => {
				setOpen("log", true);
				setCollapsed("log", false);
				setHidden(false);
				raise("log");
			}}
			aria-label={`${unreadErrors} unread ${unreadErrors === 1 ? "error" : "errors"} — open the message log`}
			className="flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-px text-destructive-text tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
		>
			<TriangleAlert className="h-3 w-3" />
			{unreadErrors}
		</button>
	);
}

export function StatusBar({ viewportError }: { viewportError: string | null }) {
	const { state } = useEditor();
	const { stats } = useFieldHostState();
	const error = state.error ?? viewportError;

	return (
		<footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-xs text-muted-foreground">
			<KeymapLine />
			{/* `title` is not decoration: an esbuild diagnostic is far wider than the bar
          and `truncate` clips it, so without the hover the only readers who get the
          whole message are the ones using the live region below. */}
			{error && (
				<span className="truncate text-destructive-text" title={error}>
					{error}
				</span>
			)}
			<div className="flex-1" />
			<ErrorChip />
			{stats && (
				<span className="flex items-center gap-3 tabular-nums">
					<span>{stats.totalOps} ops</span>
					{/* The advisor's one-liner: `analyzerPending` counts PASSES owed (0–2), not
              chunks, so the chip says only that it is behind. Absent at 0 — an idle
              advisor is the normal state and has nothing to report. */}
					{stats.analyzerPending > 0 && (
						<span title="the walkability advisor is catching up with your edits">
							analyzer ●
						</span>
					)}
					<span>undo {stats.undoDepth}</span>
				</span>
			)}
			<span className="whitespace-nowrap">{engineLabel(state)}</span>
			{/* Robust announcement: ONE persistent, visually-hidden live region that always
          exists in the a11y tree (`sr-only` clips it without display:none/contents, so
          VoiceOver/Safari can't strip its role). Its text changing is what announces —
          decoupled from the conditional visible span above. */}
			<div className="sr-only" aria-live="polite">
				{error ?? ""}
			</div>
		</footer>
	);
}

// The shell's status bar: 28 px, opaque, fixed height — the other half of the canvas
// cell's inset budget (see TopBar).
//
// It carries four things: the viewport keymap (left), the engine/error report, the ⚠
// chip that summons the message log, and the live host chips (right). The chips come
// from `useFieldHostState`, NOT from an own subscription — subscribeStats is a single
// slot and a second subscriber would silently steal the first's callback.
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type {
	FieldTool,
	PendingStamp,
	StampSession,
	ViewportGesture,
} from "../../../viewport-host/index.ts"; // type-only: erased
import {
	useFieldHostState,
	useFieldStamp,
	useFieldTool,
} from "../../hooks/useFieldHostState.tsx";
import { usePaletteSummon } from "../../hooks/usePaletteStack.tsx";
import { cn } from "../../lib/cn.ts";
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
	pendingStamp: PendingStamp | null,
): string {
	// A live session owns the interaction — the family keys refuse while it stands, so
	// what is left to say is how it ENDS. A move adds the one verb only a move has.
	if (session !== null)
		return session.moving === true
			? "drag ghost move · R rotate ¼ · ⏎ drop · Esc revert"
			: "← → ↑ ↓ nudge · R rotate ¼ · ⏎ apply · Esc discard";
	// A pending stamp SHADOWS the armed gesture: LMB is drawing that stamp's region,
	// whatever the gesture slot still says underneath (usually `pointer`, the arm most
	// stamps are picked from). It is checked before `gesture` for exactly that reason —
	// and it NAMES the generator, because "a region" alone leaves the user to remember
	// which stamp they pressed.
	//
	// "click ×2", NOT "drag": the mechanism is the box gesture's, and it takes two
	// separate presses — `onPointerUp` has no region branch at all, so a press-drag-
	// release anchors at the PRESS and throws the release away, making the user's next
	// click anywhere corner two. The box line three cases below says "click ×2" for the
	// same mechanism; one mechanism with two verbs on one status line, with the wrong
	// verb on the flow D-F4.5-7 exists to make discoverable, is worse than either.
	if (pendingStamp !== null)
		return `click ×2 to span a region for ${pendingStamp.name} · Esc cancels`;
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
	const { tool, gesture, pendingStamp } = useFieldTool();
	const { stamp } = useFieldStamp();
	return (
		<span className="whitespace-nowrap">
			{armedKeymap(tool, gesture, stamp, pendingStamp)}
		</span>
	);
}

/** The unread-error chip. It appears only while errors are UNREAD: a badge that never
 *  clears is a badge people stop seeing, and the log stays reachable from the View menu
 *  once it has. */
function ErrorChip() {
	const { unreadErrors } = useSyncExternalStore(
		notify.subscribe,
		notify.getSnapshot,
	);
	const summon = usePaletteSummon();
	if (unreadErrors === 0) return null;
	return (
		<ChipButton
			// SUMMONS rather than toggles: opening the log is what marks it read, which
			// takes this chip away — so there is never a second click here to close with.
			// The palette's own × and the View menu are the way back. What "summon" has to
			// do, and why all four writes are needed, lives in `usePaletteSummon`.
			onClick={() => summon("log")}
			label={`${unreadErrors} unread ${unreadErrors === 1 ? "error" : "errors"} — open the message log`}
			className="text-destructive-text"
		>
			<TriangleAlert className="h-3 w-3" />
			{unreadErrors}
		</ChipButton>
	);
}

/** A clickable status chip — the shared shell for the two the bar now has (D-19's
 *  stats-chip popovers are F4.5c). Its own component so the two cannot drift apart
 *  visually, which on a 28 px bar is the difference between "these are both buttons" and
 *  "one of these is text". */
function ChipButton({
	onClick,
	label,
	className,
	children,
}: {
	onClick: () => void;
	/** The accessible name — the chips are one glyph and one number, so the sentence
	 *  cannot be the visible text. */
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			className={cn(
				"flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-px tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				className,
			)}
		>
			{children}
		</button>
	);
}

export function StatusBar({ viewportError }: { viewportError: string | null }) {
	const { state } = useEditor();
	const { stats } = useFieldHostState();
	const summon = usePaletteSummon();
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
					{/* The `undo N` readout is a BUTTON (D-11): the depth answers "can I go
			              back?", and the thing that answers "back to what?" is the History
			              palette — so the number is the way to it. Unlike the ⚠ chip it is
			              always present, including at 0, because a history you have not
			              started is still the surface a first-time user should be able to
			              find. */}
					<ChipButton
						onClick={() => summon("history")}
						label={`${stats.undoDepth} undo step${stats.undoDepth === 1 ? "" : "s"} — open the History palette`}
					>
						undo {stats.undoDepth}
					</ChipButton>
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

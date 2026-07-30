// The message log: every toast the editor has raised this session, after the toast
// itself has gone (D-19). It is the answer to "what did that red thing say?" and the
// reason a toast is allowed to fade at all.
//
// A PALETTE, not a modal: it registers in the palette store like any other, so drag,
// collapse, close and the persisted arrangement all come for free. It ships closed and
// is summoned from the status bar's ⚠ chip or the View menu.
//
// Being a palette is also the trap this file has to handle: a palette body stays
// MOUNTED while it is invisible (collapsed behind the `hidden` attribute, and the whole
// layer likewise under the ⌘\ latch), so "this component is rendering" does NOT mean
// "the user can read this". See SeenMarker.

import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWorkspaceState } from "../../hooks/useWorkspace.tsx";
import { cn } from "../../lib/cn.ts";
import {
	type NotifyMessage,
	type NotifySeverity,
	notify,
} from "../../lib/notify-store.ts";
import { Button } from "../ui/button.tsx";

/** The severity dot + its tone. Same reasoning as the toast: an ICON rather than a bare
 *  coloured dot, so the severity survives a colour-blind reader, and error text uses
 *  `--destructive-text` (D-23) rather than the fill. */
const TONE: Record<NotifySeverity, { Icon: LucideIcon; text: string }> = {
	info: { Icon: Info, text: "text-muted-foreground" },
	success: { Icon: CircleCheck, text: "text-success" },
	error: { Icon: CircleAlert, text: "text-destructive-text" },
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long ago, coarsely. `now` is a parameter rather than a `Date.now()` call so this
 *  is a pure function a test can pin, and so the whole list agrees on one instant. */
export function relTime(at: number, now: number): string {
	const ago = Math.max(0, now - at);
	if (ago < MINUTE_MS) return "just now";
	if (ago < HOUR_MS) return `${Math.floor(ago / MINUTE_MS)}m ago`;
	if (ago < DAY_MS) return `${Math.floor(ago / HOUR_MS)}h ago`;
	return `${Math.floor(ago / DAY_MS)}d ago`;
}

/** How often the relative times are re-derived. Without it "just now" stays "just now"
 *  for as long as nothing else re-renders the palette — a timestamp that lies is worse
 *  than no timestamp. Half a minute is the coarsest tick that keeps every string in
 *  this vocabulary correct to its own resolution. */
const RETICK_MS = 30_000;

function Row({ message, now }: { message: NotifyMessage; now: number }) {
	const tone = TONE[message.severity];
	return (
		<li className="flex items-start gap-2 border-border/50 border-b px-2 py-1.5 last:border-b-0">
			<span className={cn("shrink-0 pt-px", tone.text)}>
				<tone.Icon className="h-3 w-3" />
			</span>
			<span className="min-w-0 flex-1 break-words text-foreground">
				{message.text}
			</span>
			{/* Relative for scanning, absolute on hover for the one time it matters. */}
			<time
				dateTime={new Date(message.at).toISOString()}
				title={new Date(message.at).toLocaleString()}
				className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground"
			>
				{relTime(message.at, now)}
			</time>
		</li>
	);
}

/** Marks the log read while it is genuinely ON SCREEN, and renders nothing.
 *
 *  The gate is the whole point. Marking on render alone was wrong in two ways, both
 *  reachable without the user choosing anything: a log palette left OPEN but rolled up
 *  to its rail chip still renders (it hides behind the `hidden` attribute so its state
 *  survives), and so does every palette while the ⌘\ latch is on. In both cases an
 *  arriving error was marked read and the ⚠ chip never lit — the latch case being the
 *  worse one, since ⌘\ means "I want the canvas unobstructed", not "I am reading the
 *  log", and a chip that never appears cannot be the click that un-latches it.
 *
 *  Its OWN component, not a hook in the palette below, because `useWorkspaceState`
 *  re-renders its consumer on every drag frame (see useWorkspace's header): keeping the
 *  subscription in a component that returns null is what stops a 200-row list from
 *  re-rendering at pointer rate whenever any palette is dragged.
 *
 *  No dependency array on purpose: it must re-run both when visibility changes (this
 *  component's own state) and when a message arrives while visible (its parent
 *  re-renders, which re-renders this). `markSeen` is a no-op that does not notify when
 *  the newest id has not moved, so re-running it freely cannot loop. */
function SeenMarker() {
	const { palettes, hidden } = useWorkspaceState();
	const geom = palettes.log;
	const visible = !hidden && geom.open && !geom.collapsed;
	useEffect(() => {
		if (visible) notify.markSeen();
	});
	return null;
}

export function LogPalette() {
	const { log, overflow } = useSyncExternalStore(
		notify.subscribe,
		notify.getSnapshot,
	);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), RETICK_MS);
		return () => clearInterval(timer);
	}, []);

	return (
		<div className="flex flex-col text-xs">
			{/* Renders nothing; it is the "these have been read" side effect, gated on the
			    palette actually being visible. */}
			<SeenMarker />
			<div className="flex items-center gap-2 border-border border-b px-2 py-1 text-muted-foreground">
				<span className="flex-1 tabular-nums">
					{log.length === 0 ? "no messages" : `${log.length} messages`}
					{/* Named rather than hidden: the cap dropped these from the SCREEN, and a
					    log that silently held things the user never saw would be the same
					    failure the toast stack is trying not to be. Both numbers describe THIS
					    list (the store derives the count from the surviving entries), so the
					    second can never exceed the first. */}
					{overflow > 0 && ` · ${overflow} not shown as toasts`}
				</span>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-5 px-1.5 text-xs"
					disabled={log.length === 0}
					onClick={() => notify.clear()}
				>
					Clear
				</Button>
			</div>
			{log.length === 0 ? (
				<p className="px-2 py-3 text-muted-foreground">
					Saves, bakes and refusals land here.
				</p>
			) : (
				// Newest first, as the store keeps it: the last thing that happened is the
				// thing being looked for. Capped height so a 200-entry log scrolls inside
				// the palette rather than growing it to the full height of the cell.
				<ul className="max-h-64 overflow-y-auto">
					{log.map((message) => (
						<Row key={message.id} message={message} now={now} />
					))}
				</ul>
			)}
		</div>
	);
}

// The message log: every toast the editor has raised this session, after the toast
// itself has gone (D-19). It is the answer to "what did that red thing say?" and the
// reason a toast is allowed to fade at all.
//
// A PALETTE, not a modal: it registers in the palette store like any other, so drag,
// collapse, close and the persisted arrangement all come for free. It ships closed and
// is summoned from the status bar's ⚠ chip or the View menu.
//
// Being a palette is also the trap this file has to handle: a palette body stays
// MOUNTED while it is invisible (collapsed behind the `hidden` attribute, the whole layer
// likewise under the ⌘\ latch, or simply BURIED under another palette), so "this
// component is rendering" does NOT mean "the user can read this" — and being read is what
// clears the ⚠ chip. See VisibilityProbe.

import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePaletteOrder } from "../../hooks/usePaletteStack.tsx";
import { useWorkspaceState } from "../../hooks/useWorkspace.tsx";
import { cn } from "../../lib/cn.ts";
import { relTime } from "../../lib/humanize.ts";
import {
	type NotifyMessage,
	type NotifySeverity,
	notify,
} from "../../lib/notify-store.ts";
import { PALETTE_IDS } from "../../lib/palette-store.ts";
import { ActionTip } from "../tips.tsx";
import { Button } from "../ui/button.tsx";

/** The severity dot + its tone. Same reasoning as the toast: an ICON rather than a bare
 *  coloured dot, so the severity survives a colour-blind reader, and error text uses
 *  `--destructive-text` (D-23) rather than the fill. */
const TONE: Record<NotifySeverity, { Icon: LucideIcon; text: string }> = {
	info: { Icon: Info, text: "text-muted-foreground" },
	success: { Icon: CircleCheck, text: "text-success" },
	// Amber, and the same triangle the toast row uses.
	// MIGRATION (until F4.5c Task 13): D-23 adds `--warning-text` there and this becomes
	// `text-warning-text`. `--warning` is a fill colour, which is fine for the icon tint
	// this actually is — the rename keeps the two severities' tokens parallel.
	warn: { Icon: TriangleAlert, text: "text-warning" },
	error: { Icon: CircleAlert, text: "text-destructive-text" },
};

/** How often the relative times are re-derived WHILE THE LOG IS VISIBLE. Without it
 *  "just now" stays "just now" for as long as nothing else re-renders the palette — a
 *  timestamp that lies is worse than no timestamp. Half a minute is the coarsest tick
 *  that keeps every string in `relTime`'s vocabulary correct to its own resolution. */
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

/** Reports whether the log palette is genuinely ON SCREEN, and renders nothing.
 *
 *  This distinction is the whole point of the component. A palette body keeps RENDERING
 *  while it is invisible — rolled up to its rail chip it hides behind the `hidden`
 *  attribute (so its state survives the round trip), the ⌘\ latch does the same to the
 *  entire layer, and — the fourth way, and the one that cost real signal — it can simply
 *  be BURIED under another palette. So "I am rendering" is not "the user can read me",
 *  and two behaviours below depend on the difference: marking messages read, and ticking
 *  the clock that keeps their timestamps honest.
 *
 *  The depth term is not symmetry with the other three. Without it: summon the log, click
 *  the entities palette it shares a default corner with, and every refusal from then on
 *  is marked READ behind an opaque box — the ⚠ chip never lights again, and the editor
 *  silently stops reporting failures. That is strictly worse than the stacking glitch it
 *  looks like, because the notification channel is what tells the user anything went
 *  wrong at all.
 *
 *  The error direction is chosen, and it is the safe one. This UNDER-marks: a log that is
 *  visible but not topmost (peeking out beside the palette over it, perfectly readable)
 *  keeps its messages unread and leaves the chip lit. That resolves itself the moment the
 *  user clicks the log — which raises it — and a chip that lingers one click too long is
 *  a far cheaper failure than one that goes dark over errors nobody saw. Unread is never
 *  silently marked read.
 *
 *  Its OWN component, rather than a `useWorkspaceState` call in the palette below,
 *  because that hook re-renders its consumer on every drag frame (see useWorkspace's
 *  header). Keeping the subscription in a leaf that returns `null` — and lifting only
 *  the BOOLEAN, which changes rarely — is what stops a 200-row list from re-rendering at
 *  pointer rate whenever any palette is dragged. */
function VisibilityProbe({
	onChange,
}: {
	onChange: (visible: boolean) => void;
}) {
	const { palettes, hidden } = useWorkspaceState();
	const order = usePaletteOrder();
	const geom = palettes.log;
	// Everything that could be DRAWN OVER the log: open, not rolled up to a chip, and
	// free-floating rather than welded to an edge (a docked palette is somewhere the log
	// is not). The log's own default corner is the entities palette's, so this set is
	// non-empty in the shipped arrangement — which is the whole reason the term exists.
	const occluders = PALETTE_IDS.filter(
		(id) =>
			id !== "log" &&
			palettes[id].open &&
			!palettes[id].collapsed &&
			palettes[id].edge === null,
	);
	const topmost = occluders.every(
		(id) => order.indexOf(id) < order.indexOf("log"),
	);
	const visible = !hidden && geom.open && !geom.collapsed && topmost;
	useEffect(() => {
		onChange(visible);
	}, [visible, onChange]);
	return null;
}

export function LogPalette() {
	const { log, overflow } = useSyncExternalStore(
		notify.subscribe,
		notify.getSnapshot,
	);
	const [now, setNow] = useState(() => Date.now());
	const [visible, setVisible] = useState(false);

	// Only while it can be read: a collapsed or latched-away log has no timestamps on
	// screen to keep honest, and re-rendering the whole list every 30 s for nobody is
	// exactly the kind of cost that hides until a session has run for an hour.
	useEffect(() => {
		if (!visible) return;
		// Immediately, not only on the first tick: the palette may have been invisible
		// for an hour, so its "just now" is stale the moment it comes back.
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), RETICK_MS);
		return () => clearInterval(timer);
	}, [visible]);

	// While the log is visible nothing in it is unread — which is what takes the ⚠ chip
	// back down. No dependency array on purpose: it must run when visibility changes AND
	// when a message arrives while visible (a store push re-renders this component).
	// `markSeen` does not notify when the newest id has not moved, so this cannot loop.
	useEffect(() => {
		if (visible) notify.markSeen();
	});

	return (
		<div className="flex flex-col text-xs">
			{/* Renders nothing; it is the palette's answer to "can the user see me?". */}
			<VisibilityProbe onChange={setVisible} />
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
				{/* It takes the toasts too — `clear` is the whole store, not just this list —
				    and a verb that removes something off-screen has to say so. A tooltip
				    rather than a `title` (D-25) so the warning reaches a keyboard user; the
				    empty-log case is disabled and so reaches nobody, which is the one state
				    where there is nothing to warn about. */}
				<ActionTip hint="discard the log and any toasts still on screen">
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
				</ActionTip>
			</div>
			{log.length === 0 ? (
				<p className="px-2 py-3 text-muted-foreground">
					Saves, bakes and refusals land here.
				</p>
			) : (
				// Newest first, as the store keeps it: the last thing that happened is the
				// thing being looked for. Capped height so a 200-entry log scrolls inside
				// the palette rather than growing it to the full height of the cell.
				//
				// NO ROVING HERE, and that is a ruling rather than an omission (F4.5c Task 9,
				// D-26). Roving tabindex exists to collapse many CONTROLS into one tab stop;
				// a log row is static text with no verb on it, and making each one a focusable
				// "option" would take a list a screen reader can already read straight through
				// and turn it into a widget the user has to arrow through — worse than what it
				// replaced. The three lists that DID get the treatment all carry buttons per
				// row; this one carries none.
				//
				// What it lacked instead is the thing a scroll box with no focusable content
				// always lacks: any way to scroll it from the keyboard (WCAG 2.1.1 — Chrome
				// and Safari will not focus such a container, so ↑/↓ reach it never). One tab
				// stop on the SCROLLER fixes that, and the browser's own arrow handling does
				// the rest — no key code here at all.
				<ul
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a tab stop on a non-interactive element is the POINT here — it is the only keyboard route to a scroll box that holds no focusable content. The list keeps its list semantics; nothing claims to be a widget.
					tabIndex={0}
					aria-label="message log"
					className="max-h-64 overflow-y-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					{log.map((message) => (
						<Row key={message.id} message={message} now={now} />
					))}
				</ul>
			)}
		</div>
	);
}

// The message log: every toast the editor has raised this session, after the toast
// itself has gone (D-19). It is the answer to "what did that red thing say?" and the
// reason a toast is allowed to fade at all.
//
// A PALETTE, not a modal: it registers in the palette store like any other, so drag,
// collapse, close and the persisted arrangement all come for free. It ships closed and
// is summoned from the status bar's ⚠ chip or the View menu.

import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
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

	// While the log is on screen, nothing in it is unread — which is what takes the ⚠
	// chip back down. Runs on every render on purpose (a new message arriving while the
	// palette is open is also read): `markSeen` is a no-op that does NOT notify when the
	// newest id has not moved, so this cannot loop.
	useEffect(() => {
		notify.markSeen();
	});

	return (
		<div className="flex flex-col text-xs">
			<div className="flex items-center gap-2 border-border border-b px-2 py-1 text-muted-foreground">
				<span className="flex-1 tabular-nums">
					{log.length === 0 ? "no messages" : `${log.length} messages`}
					{/* Named rather than hidden: the cap dropped these from the SCREEN, and a
					    log that silently held things the user never saw would be the same
					    failure the toast stack is trying not to be. */}
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

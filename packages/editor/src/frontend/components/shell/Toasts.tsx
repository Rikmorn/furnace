// The toast stack: what the editor says about something that just happened, over the
// canvas rather than tucked into a line of chrome (D-19).
//
// PLACEMENT (D-1): an absolute layer inside the canvas cell, anchored bottom-right —
// the mock's `right: 12px; bottom: 40px`, which is 12 px above a 28 px status bar. Our
// status bar is a flex SIBLING of the cell rather than an overlay, so the same gap is
// `bottom-3` here: the cell already stops where the bar starts. Like every other
// floating surface it takes nothing from the canvas and cannot move it.
//
// It reads the store directly instead of taking props: the producers (the host's
// refusals, the toolbar's save/bake/load reports) are scattered across the tree and
// none of them is an ancestor of this component. A store with one subscriber per
// consumer is what keeps that from becoming prop-drilling through the shell.

import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "../../lib/cn.ts";
import {
	type NotifyMessage,
	type NotifySeverity,
	notify,
} from "../../lib/notify-store.ts";

/** Per-severity presentation. The error row uses `--destructive-text`, NOT
 *  `--destructive`: the latter is a fill colour and reads 3.55:1 as text on the popover
 *  surface, under the 4.5:1 floor (D-23). The border keeps the fill colour, where
 *  contrast is not a reading question.
 *
 *  Class strings are written out whole rather than composed (`border-${tone}`), because
 *  Tailwind's scanner reads source text: an interpolated name ships no rule at all. */
const TONE: Record<
	NotifySeverity,
	{ Icon: LucideIcon; box: string; text: string }
> = {
	info: {
		Icon: Info,
		box: "border-border",
		text: "text-foreground",
	},
	success: {
		Icon: CircleCheck,
		box: "border-success",
		text: "text-success",
	},
	error: {
		Icon: CircleAlert,
		box: "border-destructive",
		text: "text-destructive-text",
	},
};

function Toast({ message }: { message: NotifyMessage }) {
	const tone = TONE[message.severity];
	return (
		<div
			// An error INTERRUPTS (assertive), everything else waits its turn (polite).
			// The role is on the row rather than a wrapper so each message announces once,
			// as it mounts, instead of the whole stack re-announcing on every change.
			role={message.severity === "error" ? "alert" : "status"}
			// The tone lives on the box AND on the icon: colour alone must never be the
			// only carrier, so the icon SHAPE is the redundant channel (WCAG 1.4.1).
			className={cn(
				"pointer-events-auto flex w-[340px] items-start gap-2 rounded-md border bg-popover px-3 py-2 text-xs shadow-lg",
				tone.box,
			)}
		>
			<span className={cn("shrink-0 pt-px", tone.text)}>
				<tone.Icon className="h-3.5 w-3.5" />
			</span>
			<span className={cn("min-w-0 flex-1 break-words", tone.text)}>
				{message.text}
			</span>
			<button
				type="button"
				aria-label={`dismiss: ${message.text}`}
				onClick={() => notify.dismiss(message.id)}
				className="-mr-1 shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}

export function Toasts() {
	const { toasts } = useSyncExternalStore(notify.subscribe, notify.getSnapshot);
	if (toasts.length === 0) return null;
	return (
		// pointer-events-none on the column, -auto on each toast: an empty stack (and the
		// gaps between rows) must not eat a viewport drag that passes under it.
		<div className="pointer-events-none absolute right-3 bottom-3 flex flex-col items-end gap-2">
			{toasts.map((message) => (
				<Toast key={message.id} message={message} />
			))}
		</div>
	);
}

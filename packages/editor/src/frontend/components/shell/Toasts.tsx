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
//
// ANNOUNCEMENT is deliberately NOT the visible rows' job — see the two persistent live
// regions at the bottom of this file.

import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "../../lib/cn.ts";
import {
	type NotifyMessage,
	type NotifySeverity,
	notify,
} from "../../lib/notify-store.ts";

/** Per-severity presentation. The error row uses `--destructive-text`, NOT
 *  `--destructive`: the latter is a fill colour and reads 3.40:1 as text on `--popover`
 *  (3.55:1 on `--card`, where the status bar's copy sits) — both under the 4.5:1 floor,
 *  which is what D-23 splits the token for. The BORDER keeps the fill colour, where
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

/** How tall one toast's TEXT may grow before it scrolls inside itself. An esbuild
 *  diagnostic or a daemon stack trace is unbounded, and without this a single message
 *  can cover the viewport it is reporting on. */
const BODY_MAX_H = "max-h-24";

function Toast({
	message,
	onDismiss,
	dismissRef,
}: {
	message: NotifyMessage;
	onDismiss: (id: number) => void;
	/** The × button, published so the stack can move focus here when the toast beside
	 *  this one is dismissed out from under the keyboard. */
	dismissRef: (el: HTMLButtonElement | null) => void;
}) {
	const tone = TONE[message.severity];
	return (
		<li
			// The tone lives on the box AND on the icon: colour alone must never be the
			// only carrier, so the icon SHAPE is the redundant channel (WCAG 1.4.1). No
			// live-region role here — announcing is the persistent regions' job.
			className={cn(
				"pointer-events-auto flex w-[340px] items-start gap-2 rounded-md border bg-popover px-3 py-2 text-xs shadow-lg",
				tone.box,
			)}
		>
			<span className={cn("shrink-0 pt-px", tone.text)}>
				<tone.Icon className="h-3.5 w-3.5" />
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 overflow-y-auto break-words",
					BODY_MAX_H,
					tone.text,
				)}
			>
				{message.text}
			</span>
			<button
				ref={dismissRef}
				type="button"
				aria-label={`dismiss: ${message.text}`}
				onClick={() => onDismiss(message.id)}
				className="-mr-1 shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</li>
	);
}

export function Toasts() {
	const { toasts, log } = useSyncExternalStore(
		notify.subscribe,
		notify.getSnapshot,
	);
	const dismissRefs = useRef<Record<number, HTMLButtonElement | null>>({});
	/** Which toast's × takes focus after the next render (the PaletteLayer pattern).
	 *  Dismissing removes the very button that was activated, and without this focus
	 *  falls to <body> — so clearing a stack of three by keyboard means tabbing in from
	 *  the top of the document twice. */
	const focusAfter = useRef<number | null>(null);

	useLayoutEffect(() => {
		const id = focusAfter.current;
		if (id === null) return;
		focusAfter.current = null;
		dismissRefs.current[id]?.focus();
	});

	const dismiss = (id: number): void => {
		const index = toasts.findIndex((t) => t.id === id);
		// The toast that moves INTO this row, else the one above it. When neither exists
		// the stack is empty and there is deliberately nowhere to send focus: nothing in
		// the chrome is "where the user was", and stealing focus to the status bar would
		// be a bigger surprise than the browser's own reset.
		const neighbour = toasts[index + 1] ?? toasts[index - 1];
		focusAfter.current = neighbour?.id ?? null;
		notify.dismiss(id);
	};

	// The HOUSE announcement pattern (StatusBar's live region, same reasoning): TWO
	// persistent, visually-hidden regions that always exist in the accessibility tree,
	// whose TEXT CHANGING is what announces. Mounting a `role="alert"` row and its text
	// in the same commit — which is what a conditional toast row does — is exactly the
	// shape VoiceOver/Safari (our primary browser) is unreliable about, and a region
	// that unmounts whenever the stack empties can lose its role outright.
	//
	// Split by urgency, which is what the severity already means: a refusal interrupts,
	// a report waits for a pause. Fed from the LOG rather than the visible stack, so a
	// message the cap kept off screen is still announced, and so dismissing one (the
	// user acting, not the editor speaking) re-announces nothing.
	//
	// The regions persist; their CHILD is keyed by message id. Text alone would go silent
	// on the commonest case there is — the same refusal twice ("select a region first"
	// every time the user tries the gesture) changes no text and would announce once,
	// leaving the second attempt looking like it did nothing. A keyed child makes each
	// message a node ADDITION inside an already-live region, which is announced whether
	// or not the string differs.
	const spokenAssertively = log.find((m) => m.severity === "error");
	const spokenPolitely = log.find((m) => m.severity !== "error");

	return (
		<>
			{toasts.length > 0 && (
				// pointer-events-none on the column, -auto on each toast: the gaps between
				// rows must not eat a viewport drag that passes under them.
				<ol
					aria-label="notifications"
					className="pointer-events-none absolute right-3 bottom-3 flex flex-col items-end gap-2"
				>
					{toasts.map((message) => (
						<Toast
							key={message.id}
							message={message}
							onDismiss={dismiss}
							dismissRef={(el) => {
								// The null branch is the row unmounting: dropping the key rather
								// than storing null is what keeps this from growing one dead entry
								// per message for the life of the session.
								if (el === null) delete dismissRefs.current[message.id];
								else dismissRefs.current[message.id] = el;
							}}
						/>
					))}
				</ol>
			)}
			<div className="sr-only" aria-live="assertive">
				<span key={spokenAssertively?.id}>{spokenAssertively?.text ?? ""}</span>
			</div>
			<div className="sr-only" aria-live="polite">
				<span key={spokenPolitely?.id}>{spokenPolitely?.text ?? ""}</span>
			</div>
		</>
	);
}

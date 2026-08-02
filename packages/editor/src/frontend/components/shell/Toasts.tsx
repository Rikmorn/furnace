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
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
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
	warn: {
		// A TRIANGLE: the shape is what separates a warning from the error's circle
		// for a reader who cannot see the amber (WCAG 1.4.1).
		Icon: TriangleAlert,
		box: "border-warning",
		// NO `--warning-text` SIBLING, and the absence is measured rather than pending.
		// D-23 expected the amber to behave like `--destructive` — a fill pressed into
		// service as text, under the floor — and planned the split for F4.5c Task 13. The
		// contrast pin written first that task (`tests/design-tokens.test.ts`) refuted it:
		// `--warning` reads 5.40:1 on `--popover` and 5.63:1 on `--card`, both clear of
		// 4.5:1. A second token would have been a rename with nothing behind it.
		text: "text-warning",
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
	/** The two ways a reader can be IN the stack, tracked apart because either one alone
	 *  is reason enough to hold the countdown (see the handlers below). Refs, not state:
	 *  nothing on screen depends on them, and a re-render per pointer crossing would be a
	 *  pure cost paid on every mouse move across the corner of the canvas. */
	const hovering = useRef(false);
	const focusWithin = useRef(false);

	useLayoutEffect(() => {
		// An empty stack unmounts the <ol>, and it can do that while a latch is up: the
		// LAST toast dismissed by keyboard leaves focus nowhere (`focusAfter` is null),
		// and a removed element raises no focusout — the browser just drops focus to
		// <body>. A latch that survived would then suppress the resume for the NEXT stack,
		// which is a toast held on screen forever. Nothing can leave a stack that is not
		// there, so gone-from-the-screen is the honest reset.
		if (toasts.length === 0) {
			hovering.current = false;
			focusWithin.current = false;
		}
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
	// a report waits for a pause. The line falls between `error` and the other three —
	// a WARNING is polite, for the reason it fades: it describes a state, not a verb
	// that failed, and interrupting a screen reader over one would be the audible
	// version of the red badge this severity exists to take away. Fed from the LOG
	// rather than the visible stack, so a message the cap kept off screen is still
	// announced, and so dismissing one (the user acting, not the editor speaking)
	// re-announces nothing.
	//
	// The regions persist; their CHILD is keyed by message id. Text alone would go silent
	// on the commonest case there is — the same refusal twice ("selection found no
	// matching cells at the click point" every time the user retries the gesture)
	// changes no text and would announce once, leaving the second attempt looking like
	// it did nothing. A keyed child makes each message a node ADDITION inside an
	// already-live region, which is announced whether or not the string differs.
	const spokenAssertively = log.find((m) => m.severity === "error");
	const spokenPolitely = log.find((m) => m.severity !== "error");

	return (
		<>
			{toasts.length > 0 && (
				// pointer-events-none on the column, -auto on each toast: the gaps between
				// rows must not eat a viewport drag that passes under them.
				<ol
					aria-label="notifications"
					// The TTL stops while a reader is in the stack, and it is the STACK that
					// carries the handlers rather than each row: hovering one toast holds all
					// three, so working down a column is not a race against the rows not
					// reached yet (WCAG 2.2.1 — an auto-dismiss is a time limit on reading, and
					// this is the extension). The keyboard reaches the same container handlers
					// because React's onFocus/onBlur are backed by focusin/focusout, which
					// bubble where the DOM's own focus/blur do not.
					//
					// TWO conditions, ONE hold: pause when either arrives, resume only once
					// both are gone. A single latch would let either leaving un-hold the
					// stack while the other still applies — and the pairing is routine, not
					// exotic: dismissing a row by keyboard puts focus on its neighbour's ×
					// under a pointer that never moved, so a mouse that then wanders off would
					// expire the row out from under the focused element.
					//
					// Safe against the churn this layout fires by itself. The column is
					// pointer-events-none, so the GAP between two rows belongs to the canvas
					// behind it: sliding from one toast to the next raises a leave and then an
					// enter. Moving focus WITHIN the stack does the same (focusout then
					// focusin, one task apart, so keyboard-only churn costs nothing
					// measurable). Both are safe because the store holds each toast's
					// REMAINING time — a resume followed by a pause puts back what it took,
					// less the crossing itself.
					onMouseEnter={() => {
						hovering.current = true;
						notify.pause();
					}}
					onMouseLeave={() => {
						hovering.current = false;
						if (!focusWithin.current) notify.resume();
					}}
					onFocus={() => {
						focusWithin.current = true;
						notify.pause();
					}}
					onBlur={() => {
						focusWithin.current = false;
						if (!hovering.current) notify.resume();
					}}
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

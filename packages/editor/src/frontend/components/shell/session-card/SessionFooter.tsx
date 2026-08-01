import type { SessionVerbs } from "../../../lib/field-session.ts";
import { ReasonTip } from "../../tips.tsx";
import { Button } from "../../ui/button.tsx";

/**
 * The two verbs that end a session, and the one reason either of them can be refused.
 *
 * `blockedReason` is a STRING rather than a flag pair, and the caller composes it, because
 * the two refusals it can carry are not peers: "the ghost has not settled" is a wait, and
 * "Chamber Radius must be at most 8" is a thing to go fix. Both disable the same button,
 * so both have to arrive as the same argument or the button would need to rank them.
 */
export function SessionFooter({
	verbs,
	blockedReason,
	onConfirm,
	onDiscard,
}: {
	verbs: SessionVerbs;
	blockedReason: string | undefined;
	onConfirm: () => void;
	onDiscard: () => void;
}) {
	return (
		<div className="flex gap-2 border-t border-border px-3 py-2">
			{/* ReasonTip, not a bare title: a disabled Button's pointer-events-none would
			    swallow the tooltip explaining the gate. */}
			<ReasonTip reason={blockedReason} className="flex-1">
				<Button
					type="button"
					size="sm"
					className="w-full"
					disabled={blockedReason !== undefined}
					// The KEY is in the accessible name because the glyph is what the user
					// reads and "⏎" is not a word. The house pattern (EntitiesList's RowVerb):
					// the pictograph is decorative, the label is the name.
					//
					// So this deliberately does NOT mirror the glyph — "(Enter)" is the point.
					// The Esc button below reads "(Esc)" and its glyph now reads "Esc" too,
					// which makes the pair LOOK inconsistent; it is not. A screen reader can
					// say "Esc" and cannot say "⏎".
					aria-label={`${verbs.primary} (Enter)`}
					onClick={onConfirm}
				>
					<span aria-hidden="true">⏎</span> {verbs.primary}
				</Button>
			</ReasonTip>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				className="flex-1"
				aria-label={`${verbs.secondary} (Esc)`}
				// `cancelStamp`, not `escape`. The Esc LADDER's first rung is a half-drawn
				// box/segment corner, and one CAN stand beside a session (`selectionClick` is
				// not suspended by `suspendedByStamp`, only the stroke and the segment are) —
				// so routing this button through the ladder would sometimes drop an anchor and
				// leave the session standing under a button that says "revert". The KEY still
				// runs the ladder; this button does what it says.
				onClick={onDiscard}
			>
				<span aria-hidden="true">Esc</span> {verbs.secondary}
			</Button>
		</div>
	);
}

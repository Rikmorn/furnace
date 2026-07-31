// The session strip (mock frame 2): what the top bar says while a stamp / reconfigure /
// move session is live, in place of the tool strip.
//
// It answers the three questions the tool strip cannot while a session stands: WHAT is
// being edited, WHICH of the three session states it is in, and HOW it ends. The state tag
// is not decoration — `stamp`, `reconfigure` and `move` commit to different things (a new
// entity, a re-run of an existing one, a translation of one), and `⏎` means "commit",
// "apply" and "drop" respectively.
//
// The verbs here are READOUTS, not buttons, and since F4.5b Task 10 the reason is settled
// rather than provisional: the clickable pair lives on the SESSION CARD, which auto-opens
// on the very session this strip is describing (D-13). A bar 40 px tall and always visible
// names the two keys; the card competes for neither. The residual gap this comment used to
// disclose — a mouse-only user with the palettes hidden — is narrower now but real: ⌘\
// still hides the layer, and the card with it, leaving Esc/⏎ as the answer.
//
// ONE CLAUSE, WORDED FOR WHAT IS TRUE TODAY — and since F4.5b Task 9 both halves of D-7's
// suspension are true, so it says the stronger one. The BRUSH is suspended:
// `onPointerDown` swallows an LMB stroke while a session stands. ARMING is suspended too
// — `gateAction`'s `armsTool` clause refuses the family keys (X among them now, since the
// brush it swaps cannot stroke), and the tool rail refuses its buttons through the same
// gate. The clause names the brush because that is the one a user finds by trying it.
import type { StampSession } from "../../../viewport-host/index.ts"; // type-only: erased
// The name and the tag live in `lib/field-session.ts` since F4.5b Task 10: the session
// CARD is the second surface that says both, and this file's own header warned that a
// third spelling would be a third thing to keep in agreement.
import { sessionName, sessionStateTag } from "../../lib/field-session.ts";

export function SessionStrip({ session }: { session: StampSession }) {
	return (
		// A named REGION, not a live region. `role="status"` was wrong twice over: this
		// element is INSERTED when the session opens, and a live region that does not exist
		// before its content does announces unreliably across screen readers (the house
		// pattern is Toasts' — keep a permanent region, change its text). What this actually
		// is, is a labelled landmark a user can jump to and read on arrival. A real
		// `<section>` with an accessible name IS that role, so there is no `role` attribute
		// and no suppression: the element carries its own semantics.
		<section
			aria-label="live session"
			className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-xs"
		>
			<span className="flex shrink-0 items-center gap-2">
				<span className="font-mono text-foreground">
					{sessionName(session)}
				</span>
				<span className="font-semibold text-[10px] text-primary tracking-widest">
					{sessionStateTag(session)}
				</span>
			</span>
			<span className="flex items-center gap-3 text-muted-foreground">
				{/* ⏎ commits, applies or DROPS — three verbs, and `mode` + `moving` decide
				    which. The host maps them in `confirmSession`; this names the one that is
				    about to happen. */}
				<Verb keycap="⏎" verb={session.moving === true ? "drop" : "apply"} />
				<Verb keycap="Esc" verb="revert" />
				{/* R only where it can act. `rotateStamp` refuses with "<generator> has no
				    rotation" when `rotationOptions` is empty, and advertising a key whose only
				    response is a refusal is the discovery-by-refusal pattern D-7 retires. A
				    MOVE is the case decidable from here — it is a region translation — while
				    the per-generator rotation fact is not: `FieldGeneratorInfo` carries none.
				    So this hides where the key is CERTAINLY dead and stays where it is merely
				    possibly dead. Making it exact needs a `rotates` flag on
				    `FieldGeneratorInfo` (the `usesSeed` shape), which belongs with the card
				    that renders it in Task 10/11. */}
				{session.moving !== true && <Verb keycap="R" verb="rotate ¼" />}
			</span>
			<span className="truncate text-[10px] text-muted-foreground">
				the brush is suspended while this session is live
			</span>
		</section>
	);
}

function Verb({ keycap, verb }: { keycap: string; verb: string }) {
	return (
		<span className="flex shrink-0 items-center gap-1.5">
			<kbd className="rounded-sm border border-border border-b-2 bg-muted px-1 font-mono text-[10px]">
				{keycap}
			</kbd>
			{verb}
		</span>
	);
}

// The session strip (mock frame 2): what the top bar says while a stamp / reconfigure /
// move session is live, in place of the tool strip.
//
// It answers the three questions the tool strip cannot while a session stands: WHAT is
// being edited, WHICH of the three session states it is in, and HOW it ends. The state tag
// is not decoration — `stamp`, `reconfigure` and `move` commit to different things (a new
// entity, a re-run of an existing one, a translation of one), and `⏎` means "commit",
// "apply" and "drop" respectively.
//
// The verbs here are READOUTS, not buttons, and the honest version of why is narrower than
// the first draft claimed. The draft said the clickable pair is "on screen at the same
// time"; it is not reliably — the only Commit/Cancel buttons today live in `StampInspector`
// inside the `controls` palette, which the user can close and which ⌘\ hides wholesale. So
// this is a KEYMAP, deliberately, and the argument for it is that the session CARD (Task 10)
// is where the clickable pair belongs: a bar 40 px tall and always visible should name the
// two keys, not compete with the card for the verb. Until that card lands there is a real
// gap for a mouse-only user with the palettes hidden, and Esc/⏎ are the answer.
//
// ONE CLAUSE, WORDED FOR WHAT IS TRUE TODAY — and since F4.5b Task 9 both halves of D-7's
// suspension are true, so it says the stronger one. The BRUSH is suspended:
// `onPointerDown` swallows an LMB stroke while a session stands. ARMING is suspended too
// — `gateAction`'s `armsTool` clause refuses the family keys (X among them now, since the
// brush it swaps cannot stroke), and the tool rail refuses its buttons through the same
// gate. The clause names the brush because that is the one a user finds by trying it.
import type { StampSession } from "../../../viewport-host/index.ts"; // type-only: erased

/** The three session states, as the strip tags them. Read off `mode` + `moving` rather
 *  than stored, because those two fields ARE the state — a third spelling here is a third
 *  thing to keep in agreement with the card and the status bar's keymap line. */
function stateTag(session: StampSession): string {
	if (session.moving === true) return "MOVE";
	return session.mode === "reconfigure" ? "RECONFIGURE" : "STAMP";
}

/** What the session is about, in the ROWS' vocabulary: `hall #3` for a session that owns a
 *  committed entity, the bare generator id for one that has not created anything yet. The
 *  same spelling `entityName` gives the entities palette and the menu labels, so the strip
 *  and the row point at one object in one language. */
function sessionName(session: StampSession): string {
	return session.entityId === null
		? session.generator
		: `${session.generator} #${session.entityId}`;
}

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
					{stateTag(session)}
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

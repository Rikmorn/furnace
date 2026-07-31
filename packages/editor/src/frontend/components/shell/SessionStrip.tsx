// The session strip (mock frame 2): what the top bar says while a stamp / reconfigure /
// move session is live, in place of the tool strip.
//
// It answers the three questions the tool strip cannot while a session stands: WHAT is
// being edited, WHICH of the three session states it is in, and HOW it ends. The state tag
// is not decoration — `stamp`, `reconfigure` and `move` commit to different things (a new
// entity, a re-run of an existing one, a translation of one), and `⏎` means "commit",
// "apply" and "drop" respectively.
//
// The verbs here are READOUTS, not buttons, and that is a deliberate departure from the
// top bar's own ⌘\ precedent ("a keycap you cannot click is a worse version of a control
// that teaches its own shortcut"). The difference is that ⌘\ had no button anywhere, while
// these two have one on the session card that is on screen at the same time — a second
// pair in the bar would be two controls for one verb, six inches apart.
//
// ONE CLAUSE, WORDED FOR WHAT IS TRUE TODAY. The mock's line reads "brush suspended while
// session is live". The host does not suspend the BRUSH yet: `onPointerDown` has no
// session branch, so LMB still strokes under a live session (the documented divergence
// window). What IS suspended is ARMING — `gateAction`'s `armsTool` clause refuses the
// family keys, and the tool rail refuses its four buttons through the same gate. So the
// clause says arming. D-7's stroke half lands in Task 9/10; the wording strengthens then.
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
		<div
			role="status"
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
				<Verb keycap="⏎" verb={session.moving === true ? "drop" : "apply"} />
				<Verb keycap="Esc" verb="revert" />
				<Verb keycap="R" verb="rotate ¼" />
			</span>
			<span className="truncate text-[10px] text-muted-foreground">
				tool arming is locked while this session is live
			</span>
		</div>
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

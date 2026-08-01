// The world drawer (D-20/D-21): every world in the project — committed and scratch —
// in one list with honest badges, summoned from the world chip and gone the moment it
// is dismissed. TRANSIENT by construction (the UE Content-Drawer lifecycle): it costs
// no permanent real estate, so it can afford to say more per row than a sidebar could.
//
// A modal Dialog rather than a popover, and the reason is the list's job: every
// dangerous verb in the editor lives here (make-default, delete, save-over-tracked), so
// a stray click outside must not leave a half-typed rename hanging over the canvas. The
// dim layer is also what makes "which world does the game load" readable at a glance,
// which is the question the drawer exists to answer.
//
// It owns NO world state: the verbs come from `useWorldActions`, the confirms are the
// App-owned prompt, and the rows come from `world.list` refetched on every
// `worlds-changed` tick — never patched from a mutation's response, so a change made
// behind the editor's back (a git checkout, another editor) shows up the same way the
// editor's own do.
import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useCatalog } from "../../hooks/useCatalogs.tsx";
import { useWorldActions, useWorldState } from "../../hooks/useWorld.tsx";
import { api, type WorldRow } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { isValidWorldName, WORLD_NAME_RULE } from "../../lib/generation.ts";
import { errorMessage, relTime } from "../../lib/humanize.ts";
import { useEditor } from "../editor-context.ts";
import { ReasonTip } from "../tips.tsx";
import { Button } from "../ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { Input } from "../ui/input.tsx";

const LEGACY_REASON =
	"a v1 world: no oplog, so field.load can't read it into the editor";
/** The listbox and its rows carry ids so the filter field can name the row the keyboard
 *  cursor is on (`aria-activedescendant`). World names are regex-gated to
 *  `[a-z0-9_-]`, so they are safe to concatenate into an id. */
const LIST_ID = "world-drawer-list";
const rowId = (name: string): string => `world-drawer-row-${name}`;

const CATALOG_REASON =
	"waiting for the materials catalog — a world remeshes against the table it was baked with";

/** A form whose verb overwrites NOTHING — the default for {@link NameForm}'s `overwrites`,
 *  so "absent means nothing is replaced" is readable in the signature. Module-level so
 *  every form that omits the prop shares one identity. */
const NO_OVERWRITES: ReadonlySet<string> = new Set();

/** The inline name form the drawer uses for save-as, rename and duplicate. A form in
 *  place rather than a second dialog: the drawer is already modal, and stacking a prompt
 *  on top of it would put two focus traps and two Escape meanings on screen at once. */
function NameForm({
	label,
	initial,
	submitLabel,
	busy,
	overwrites = NO_OVERWRITES,
	onSubmit,
	onCancel,
}: {
	label: string;
	initial: string;
	submitLabel: string;
	/** A world write is in flight. The form stays OPEN and typeable — only its commit is
	 *  held, because the verb it would start is the one already running. Gated on the
	 *  handler as well as the button: ⏎ in the field submits without going near it. */
	busy: boolean;
	/** The names this form's submit would OVERWRITE. Named for the consequence rather than
	 *  for "names that are taken", because the consequence is what differs per verb: a
	 *  save-as REPLACES the world under the name, while `world.rename` and
	 *  `world.duplicate` are refused outright by the daemon (`already-exists`,
	 *  daemon/handlers.ts) — so those two must not pass a set here, or the line would
	 *  promise an overwrite the daemon will never perform. */
	overwrites?: ReadonlySet<string>;
	onSubmit: (name: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(initial);
	const valid = isValidWorldName(value);
	/** Typed something, and it breaks the rule. An empty field is not a failure — it is a
	 *  field nobody has answered yet. */
	const invalid = value !== "" && !valid;
	// EXACT, never case-folded. macOS's case-insensitive filesystem would fold "Cavern"
	// onto "cavern" and Linux would not (the daemon says so in world.rename, and this
	// daemon is portable) — so a case-only near-miss says nothing rather than claiming a
	// consequence that is true on one platform and false on the other.
	//
	// `valid &&` is what makes this exclusive with `invalid` STRUCTURALLY. Two copies of
	// one regex stand between the two states (this file's `isValidWorldName` and the
	// daemon's `WORLD_NAME_RE`, which `world.list` filters directory names through), and
	// without the guard the property would rest on those two never drifting.
	const overwrite = valid && overwrites.has(value);
	// One id for the whole slot, carried by BOTH branches: the field must describe
	// something in every state, and `aria-invalid` cannot stand in — it is FALSE in the
	// overwrite state, which is the destructive one.
	const hintId = useId();
	return (
		<form
			className="flex flex-wrap items-center gap-2 border-border border-b bg-muted/40 px-3 py-2"
			onSubmit={(e) => {
				e.preventDefault();
				if (valid && !busy) onSubmit(value);
			}}
		>
			<Input
				// The one autofocus in the drawer, and it is earned: this form exists only
				// because a verb ASKED for text. Landing anywhere else costs a tab on every
				// rename, and on the ⌘S-untitled path it would leave the chord's whole point
				// (name this world) one keystroke short.
				autoFocus
				type="text"
				value={value}
				aria-label={label}
				aria-invalid={invalid}
				// The cue below is the ONLY pre-commit warning a scratch world gets, and a
				// colour is not a warning. Deliberately `describedby` and NOT a live region:
				// this form is conditionally mounted, and SessionStrip.tsx documents that a
				// region inserted together with its content announces unreliably. The one
				// autofocus in the drawer lands here, so the description is read immediately.
				aria-describedby={hintId}
				onChange={(e) => setValue(e.target.value)}
				className={cn("h-7 w-44", invalid && "border-destructive")}
			/>
			{/* ONE line, three states, mutually exclusive by construction — D-25 puts the
			    validation AT the field, so there is nothing to dump at the bottom of the form.
			    The rule is STATED rather than revealed by failing it (D-21); failing it only
			    changes its COLOUR. The overwrite line replaces the rule instead of stacking on
			    it, and can only do so once the name is already valid — i.e. once the rule has
			    nothing left to say about it. */}
			{overwrite ? (
				// "replaces it", not "confirms": the tracked-overwrite confirm downstream fires
				// for TRACKED worlds only, so promising a dialog would be false for exactly the
				// scratch worlds this line is the sole warning for. It names the EFFECT, which
				// is what the drawer's other verb labels do.
				<span id={hintId} className="text-foreground text-xs">
					{`will overwrite "${value}" — ${submitLabel} replaces it`}
				</span>
			) : (
				<span
					id={hintId}
					className={cn(
						"text-xs",
						invalid ? "text-destructive-text" : "text-muted-foreground",
					)}
				>
					{WORLD_NAME_RULE}
				</span>
			)}
			<div className="flex-1" />
			<Button type="submit" size="sm" disabled={!valid || busy}>
				{submitLabel}
			</Button>
			<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
				Cancel
			</Button>
		</form>
	);
}

function Badge({
	children,
	tone,
}: {
	children: string;
	tone?: "default" | "tracked";
}) {
	return (
		<span
			className={cn(
				"whitespace-nowrap rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground",
				tone === "default" && "border-primary text-primary",
				tone === "tracked" && "border-success/50 text-success",
			)}
		>
			{children}
		</span>
	);
}

/** What a row's `tracked` tri-state says about it. `null` earns NO badge on purpose: it
 *  means the daemon could not tell (no git repo, or an indeterminate answer), and a
 *  guess in either direction is exactly the lie the tri-state exists to avoid. */
function TrackedBadge({ tracked }: { tracked: boolean | null }) {
	if (tracked === null) return null;
	return tracked ? (
		<Badge tone="tracked">tracked</Badge>
	) : (
		<Badge>scratch</Badge>
	);
}

function Row({
	world,
	current,
	selected,
	busy,
	catalogSettled,
	onOpen,
	onRename,
	onDuplicate,
}: {
	world: WorldRow;
	current: boolean;
	selected: boolean;
	busy: boolean;
	catalogSettled: boolean;
	onOpen: () => void;
	onRename: () => void;
	onDuplicate: () => void;
}) {
	const { makeDefault, remove } = useWorldActions();
	const legacy = world.kind === "legacy";
	const reason = legacy
		? LEGACY_REASON
		: catalogSettled
			? undefined
			: CATALOG_REASON;
	// Keep the keyboard cursor in view: ArrowUp/Down move a selection the user cannot
	// otherwise follow once the list scrolls inside its own box. Optional-called because
	// happy-dom implements no scrolling — a hard call would make every drawer test throw.
	const rowRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (selected) rowRef.current?.scrollIntoView?.({ block: "nearest" });
	}, [selected]);

	return (
		// `option` inside the list's `listbox`, not a <li>: the drawer HAS a keyboard cursor
		// (⏎ opens what it points at), and `aria-selected` is the only way that cursor
		// exists for a screen reader — a background tint announces nothing. A <div> rather
		// than a list element because the listbox roles REPLACE the list semantics; layering
		// them on <ul>/<li> gives an element two contradictory role sets.
		<div
			ref={rowRef}
			id={rowId(world.name)}
			role="option"
			aria-selected={selected}
			// Focusable but OUT of the tab order: focus stays in the filter field, which
			// names this row through `aria-activedescendant` — the standard virtual-cursor
			// pattern, and the one that lets a user type and steer with the same hand.
			tabIndex={-1}
			className={cn(
				"flex items-center gap-2 border-border/50 border-b px-3 py-1.5 last:border-b-0",
				selected && "bg-accent",
			)}
		>
			{/* min-w-0 + truncate: a long world name must ellipsize rather than shove the
			    badges and the row's verbs off the right edge of a fixed-width drawer. */}
			<span className="min-w-0 truncate font-mono text-[13px]">
				{world.name}
			</span>
			{world.isDefault && <Badge tone="default">▶ game loads this</Badge>}
			<TrackedBadge tracked={world.tracked} />
			{legacy && <Badge>legacy</Badge>}
			{current && <Badge>open</Badge>}
			<div className="flex-1" />
			<span className="whitespace-nowrap text-[11px] text-muted-foreground">
				{relTime(world.manifestMtimeMs, Date.now())}
			</span>
			<ReasonTip reason={reason}>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					className="h-6 px-2 text-xs"
					disabled={busy || legacy || !catalogSettled}
					aria-label={`open ${world.name}${reason ? ` — ${reason}` : ""}`}
					onClick={onOpen}
				>
					Open
				</Button>
			</ReasonTip>
			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label={`more actions for ${world.name}`}
					className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring"
				>
					<MoreHorizontal className="h-4 w-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-48">
					<DropdownMenuItem
						disabled={world.isDefault}
						onSelect={() => makeDefault(world.name)}
					>
						Make default
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={onRename}>Rename…</DropdownMenuItem>
					<DropdownMenuItem onSelect={onDuplicate}>Duplicate…</DropdownMenuItem>
					{/* The daemon refuses this too (it is the one world the game is
					    guaranteed to need); saying so HERE is what keeps the refusal from
					    arriving as a surprise error toast. */}
					<DropdownMenuItem
						disabled={world.isDefault}
						onSelect={() => remove(world.name)}
					>
						{world.isDefault
							? "Delete — make another world default first"
							: "Delete"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/** The name form the drawer currently has open, if any. */
type Form =
	| { kind: "save-as" }
	| { kind: "rename"; from: string }
	| { kind: "duplicate"; from: string };

export function WorldDrawer() {
	const { worldsVersion } = useEditor();
	const { name, drawer, job } = useWorldState();
	// Every gate in here asks the yes/no question; the WORD is the status bar's business
	// (it names the verb on its progress chip). Derived once so the gates below stay a
	// boolean rather than each re-deciding what counts as busy.
	const busy = job !== null;
	const actions = useWorldActions();
	const { catalogSettled } = useCatalog();
	const [rows, setRows] = useState<WorldRow[]>([]);
	const [listError, setListError] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [cursor, setCursor] = useState(0);
	const [form, setForm] = useState<Form | null>(null);
	const open = drawer !== null;

	// Re-listed on every open AND on every `worlds-changed` tick, which is what makes the
	// editor's own mutations and anything that happens behind its back (a checkout,
	// another editor) land the same way. Cheap enough to be unconditional: one local
	// directory read.
	//
	// `worldsVersion` is a TRIGGER, not an input: the body never reads it, because the
	// daemon's events are notification-only dirty-bits carrying no payload (daemon/
	// events.ts) — the refetch IS the read. That is precisely the shape the dependency
	// rule cannot recognise.
	// biome-ignore lint/correctness/useExhaustiveDependencies: worldsVersion is the refetch trigger, deliberately unread in the body
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		api
			.worldList()
			.then(({ worlds }) => {
				if (cancelled) return;
				setRows(worlds);
				setListError(null);
			})
			.catch((err: unknown) => {
				if (!cancelled) setListError(errorMessage(err));
			});
		return () => {
			cancelled = true;
		};
	}, [open, worldsVersion]);

	// Each summon starts clean: the previous session's filter and half-typed rename are
	// not what the user asked for by clicking the chip. `save-as` opens with its form up
	// — that mode IS "name this world".
	useEffect(() => {
		if (!open) return;
		setFilter("");
		setCursor(0);
		setForm(drawer === "save-as" ? { kind: "save-as" } : null);
	}, [open, drawer]);

	// Case-INSENSITIVE, on both sides: world names may carry capitals (WORLD_NAME_RE's
	// `i` flag allows them), and a filter that hides "Cavern" when you type "cav" reads as
	// a missing world rather than a case-sensitive match.
	const needle = filter.trim().toLowerCase();
	const visible = rows.filter((w) => w.name.toLowerCase().includes(needle));

	// Every world the list knows about — which is exactly the set a save-as would write
	// over. Built off `rows` rather than `visible`: the filter hides rows, it does not
	// make the worlds behind them any less overwritable. Refreshed by the same refetch
	// every `worlds-changed` tick drives, so a world created behind the editor's back is
	// in here too.
	//
	// Unmemoised, like the `visible` filter above it — over the same array and doing
	// strictly less work. `NameForm` is not memoised either, so a stable identity here
	// would save no render.
	const listed = new Set(rows.map((w) => w.name));
	const selected = visible[Math.min(cursor, visible.length - 1)];

	// Every gate the row's own Open button wears, `busy` included. Without it ⏎ walks
	// past a disabled button into an `actions.open` that a write in flight silently
	// refuses — and on a dirty session that refusal lands AFTER the discard confirm has
	// been answered yes, so the user has agreed to lose the work and then nothing happens.
	const openSelected = useCallback((): void => {
		if (!selected || selected.kind === "legacy" || !catalogSettled || busy)
			return;
		actions.open(selected.name);
	}, [selected, catalogSettled, busy, actions]);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) actions.closeDrawer();
			}}
		>
			<DialogContent
				className="max-w-xl gap-0 p-0"
				// Escape belongs to an OPEN NAME FORM first: it cancels the form and the
				// drawer stays. It has to be intercepted here rather than in the field,
				// because Radix's dismiss listener is a CAPTURE-phase listener on `document`
				// — it has already run by the time a keydown reaches the input, so no amount
				// of stopPropagation down there can hold it (measured, this session). This
				// prop is the seam Radix provides for exactly that: a prevented event is not
				// a dismissal.
				onEscapeKeyDown={(e) => {
					if (form === null) return;
					e.preventDefault();
					setForm(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown") {
						e.preventDefault();
						setCursor((c) => Math.min(c + 1, visible.length - 1));
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						setCursor((c) => Math.max(c - 1, 0));
					}
					// ⏎ opens the selection — but never out from under a name form, whose own
					// submit owns the key.
					if (e.key === "Enter" && form === null) {
						e.preventDefault();
						openSelected();
					}
				}}
			>
				<DialogHeader className="border-border border-b px-3 py-2">
					<DialogTitle className="text-sm">Worlds</DialogTitle>
					<DialogDescription className="sr-only">
						Every world in this project. ⏎ opens the selected one, Esc closes.
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center gap-2 border-border border-b px-3 py-2">
					<Input
						type="text"
						value={filter}
						placeholder="filter worlds…"
						aria-label="filter worlds"
						// The virtual cursor: focus never leaves this field (typing and steering are
						// the same gesture here), so the row ⏎ would open has to be named from here
						// or it exists only as a background tint.
						aria-controls={LIST_ID}
						{...(selected
							? { "aria-activedescendant": rowId(selected.name) }
							: {})}
						onChange={(e) => {
							setFilter(e.target.value);
							setCursor(0);
						}}
						className="h-7 flex-1 font-mono text-xs"
					/>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						className="h-7"
						disabled={busy}
						onClick={actions.reset}
					>
						New world
					</Button>
					<Button
						type="button"
						size="sm"
						className="h-7"
						disabled={busy}
						onClick={() => setForm({ kind: "save-as" })}
					>
						Save as…
					</Button>
				</div>
				{form?.kind === "save-as" && (
					<NameForm
						label="save as world name"
						initial={name ?? ""}
						submitLabel="Save"
						busy={busy}
						// The ONLY form that overwrites. The tracked-world confirm downstream is
						// untouched by this — that prompt stands where it always did, and this is
						// the earlier, quieter half of the same warning, said before the commit
						// rather than on top of it (and it is the ONLY warning a scratch world
						// gets, since the confirm fires for tracked ones alone).
						overwrites={listed}
						onSubmit={(next) => {
							setForm(null);
							actions.saveAs(next);
						}}
						onCancel={() => setForm(null)}
					/>
				)}
				{form?.kind === "rename" && (
					<NameForm
						label={`rename ${form.from} to`}
						initial={form.from}
						submitLabel="Rename"
						busy={busy}
						onSubmit={(next) => {
							setForm(null);
							actions.rename(form.from, next);
						}}
						onCancel={() => setForm(null)}
					/>
				)}
				{form?.kind === "duplicate" && (
					<NameForm
						label={`duplicate ${form.from} as`}
						initial={`${form.from}-copy`}
						submitLabel="Duplicate"
						busy={busy}
						onSubmit={(next) => {
							setForm(null);
							actions.duplicate(form.from, next);
						}}
						onCancel={() => setForm(null)}
					/>
				)}
				{listError !== null && (
					<p className="px-3 py-4 text-destructive-text text-sm">
						could not list worlds: {listError}
					</p>
				)}
				{listError === null && visible.length === 0 && (
					<p className="px-3 py-4 text-muted-foreground text-sm">
						{rows.length === 0
							? "no worlds yet — save one and it appears here"
							: "no world matches that filter"}
					</p>
				)}
				<div
					id={LIST_ID}
					role="listbox"
					aria-label="worlds"
					className="max-h-80 overflow-y-auto text-sm"
				>
					{visible.map((world) => (
						<Row
							key={world.name}
							world={world}
							current={world.name === name}
							selected={world.name === selected?.name}
							busy={busy}
							catalogSettled={catalogSettled}
							onOpen={() => actions.open(world.name)}
							onRename={() => setForm({ kind: "rename", from: world.name })}
							onDuplicate={() =>
								setForm({ kind: "duplicate", from: world.name })
							}
						/>
					))}
				</div>
				<p className="border-border border-t px-3 py-1.5 text-[11px] text-muted-foreground">
					⏎ open selected · esc close
				</p>
			</DialogContent>
		</Dialog>
	);
}

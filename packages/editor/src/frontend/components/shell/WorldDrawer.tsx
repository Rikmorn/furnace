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
import { useCallback, useEffect, useState } from "react";
import { useCatalog } from "../../hooks/useCatalogs.tsx";
import { useWorldActions, useWorldState } from "../../hooks/useWorld.tsx";
import { api, type WorldRow } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { isValidWorldName, WORLD_NAME_RULE } from "../../lib/generation.ts";
import { errorMessage, relTime } from "../../lib/humanize.ts";
import { useEditor } from "../editor-context.ts";
import { ReasonTip } from "../field/form-bits.tsx";
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
const CATALOG_REASON =
	"waiting for the materials catalog — a world remeshes against the table it was baked with";

/** The inline name form the drawer uses for save-as, rename and duplicate. A form in
 *  place rather than a second dialog: the drawer is already modal, and stacking a prompt
 *  on top of it would put two focus traps and two Escape meanings on screen at once. */
function NameForm({
	label,
	initial,
	submitLabel,
	onSubmit,
	onCancel,
}: {
	label: string;
	initial: string;
	submitLabel: string;
	onSubmit: (name: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(initial);
	const valid = isValidWorldName(value);
	return (
		<form
			className="flex flex-wrap items-center gap-2 border-border border-b bg-muted/40 px-3 py-2"
			onSubmit={(e) => {
				e.preventDefault();
				if (valid) onSubmit(value);
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
				aria-invalid={value !== "" && !valid}
				onChange={(e) => setValue(e.target.value)}
				className={cn(
					"h-7 w-44",
					value !== "" && !valid && "border-destructive",
				)}
			/>
			{/* The rule is STATED, always, not revealed by failing it (D-21). */}
			<span className="text-muted-foreground text-xs">{WORLD_NAME_RULE}</span>
			<div className="flex-1" />
			<Button type="submit" size="sm" disabled={!valid}>
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
	return (
		<li
			className={cn(
				"flex items-center gap-2 border-border/50 border-b px-3 py-1.5 last:border-b-0",
				selected && "bg-accent",
			)}
		>
			<span className="font-mono text-[13px]">{world.name}</span>
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
		</li>
	);
}

/** The name form the drawer currently has open, if any. */
type Form =
	| { kind: "save-as" }
	| { kind: "rename"; from: string }
	| { kind: "duplicate"; from: string };

export function WorldDrawer() {
	const { worldsVersion } = useEditor();
	const { name, drawer, busy } = useWorldState();
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

	const visible = rows.filter((w) => w.name.includes(filter.trim()));
	const selected = visible[Math.min(cursor, visible.length - 1)];

	const openSelected = useCallback((): void => {
		if (!selected || selected.kind === "legacy" || !catalogSettled) return;
		actions.open(selected.name);
	}, [selected, catalogSettled, actions]);

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
				<ul className="max-h-80 overflow-y-auto text-sm">
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
				</ul>
				<p className="border-border border-t px-3 py-1.5 text-[11px] text-muted-foreground">
					⏎ open selected · esc close
				</p>
			</DialogContent>
		</Dialog>
	);
}

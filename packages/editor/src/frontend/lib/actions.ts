// The editor's ONE action registry (D-10/D-11/D-12) — the CHROME half of it since
// foundations T3b2. Every verb the chrome can run is DECLARED as a row in
// `src/action-registry/descriptors.ts` (id, group, binding, hint, gate, the two flags), and
// this file joins the five things a row cannot hold onto those rows by id: the contextual
// label, the enabled predicate, the menu checkbox's checked state, and the `run` that does
// it. A process with no DOM can hold the rows; only a browser can hold these.
//
// EIGHT SURFACES READ THIS TABLE — the window key dispatcher (`useGlobalKeybindings`), the
// burger menu, the Help▸Keyboard shortcuts overlay, the top bar (Bake and the palette
// toggle), the status bar's selection chip, the tool rail (through `TOOL_FAMILIES` at the
// foot of this file), the ⌘K command palette, which renders the WHOLE table at once, and
// `ui/tips.tsx`'s `ActionTip`, which looks a keycap up by id so a tooltip cannot print a
// chord this table has moved — so a binding cannot be live and undocumented, or documented
// and dead, and no surface works out an enabled state or a label of its own.
// `shell/SessionCard.tsx` and `shell/ToolStrip.tsx` import `entityName` and nothing else;
// they are not readers of the table and are not in the count. The count was three when this
// file was written and has been wrong at every re-count since: it stayed three while five
// more readers arrived, then read seven, which missed `ActionTip` — a control-library
// tooltip does not look like a surface, which is exactly why it is named above rather than
// left to be re-derived. Checking it takes THREE numbers, and only the last is the one
// written here: FOURTEEN files import this module, TWELVE of those value-import it
// (`hooks/useActionContext.tsx` and `components/field/EntitiesList.tsx` take `ActionCtx` and
// `ActionId` as types and read nothing), and EIGHT of THOSE read the table. T3b2 Task 4 moved
// the first two numbers and — in the commit that restated this very procedure — did not
// re-derive them: `runNamed`/`sayResult` gave `shell/WorldDrawer.tsx` and `hooks/useWorld.tsx`
// value imports, and `ActionId` gave `EntitiesList.tsx` a type-only one. The eight held.
// Adding a reader means editing this number and
// `docs/reference/editor-architecture.md` §17.4, which lists the eight by file. Those are
// the only two places the count is written down; §16.6 points at §17.4 rather than carrying
// a third copy.
//
// WHO OWNS A KEY. There are two keydown listeners in this editor: the field canvas's
// (`field-host/field-host.ts`) and this registry's, on `window`. The rule:
//
//   A key has ONE handler per press. The canvas keeps a key when the verb steers the
//   viewport under the pointer and must NOT fire from a palette — the fly set, `[`/`]`,
//   the arrow nudges, the momentary ⇧/⌃ — or when it needs first refusal over a verb it
//   answers more specifically (⌘Z, ⏎, Esc, R, F). Everything else is this registry's.
//   Where BOTH bind one key, the canvas branch that ACTS must `stopPropagation()`, and
//   that call is the whole licence for the second owner: exactly one of the two runs.
//
// What the registry adds for those shared keys is REACH and GATES. The canvas listener
// only fires while the canvas has focus, and clicking any palette control takes focus
// away — the standing F2b gate finding that a viewport binding silently dies the moment the
// user touches a panel (`docs/reference/editor-architecture.md` §18.9 carries the datum and
// the arrows-are-canvas-only-by-design position it settled into). The window listener has no
// such hole, and it is the only one that consults the gate below.
//
// This module is PURE and DOM-free (`KeyboardEvent` appears as a type only, erased at
// build). It type-imports the host types like every other chrome module — the chrome may
// never VALUE-import anything under `field-host/` (machine-enforced by
// `tests/frontend-no-engine-leakage.test.ts`), so every host verb here goes through the
// `FieldHost` instance the context hook reads off `fieldHostRef`. It DOES value-import
// `src/action-registry/`, which is licensed: that barrel is the zod-free surface, and the
// one module under it that carries zod (`schemas.ts`) is what the leakage guard bans the
// chrome from reaching (editor-architecture §22.5).
import {
  ACTION_DESCRIPTORS,
  ACTION_OK,
  type ActionDescriptor,
  type ActionGroup,
  type ActionId,
  type ActionInputs,
  type ActionResult,
  failed,
  type InputOf,
  type KeyFacts,
  keycap,
  matchBinding,
  refused,
} from "../../action-registry/index.ts";
import type {
  FieldEntityInfo,
  FieldHost,
  FieldStats,
  FieldTool,
  SelectionInfo,
  StampSession,
  ViewportGesture,
} from "../../field-host/index.ts"; // type-only: erased
// The tool table (T3b2 Task 5). The three member arrays this file used to declare are rows
// there now, and so are the two host limits their hints state: `MAX_SEGMENT_M` left with the
// Segment hint and `LATTICE` left with `edit.grab`'s into the descriptor row, so this module
// names neither number any more.
import type {
  DerivedFamily,
  DerivedMember,
  FamilyId,
} from "../../shared/action-table.ts";
import { deriveFamilies } from "../../shared/action-table.ts";
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";
import type { ViewActions, ViewState } from "../hooks/useView.tsx";
import type { WorkspaceActions } from "../hooks/useWorkspace.tsx";
import type { WorldActions } from "../hooks/useWorld.tsx";
// The triad's naming function, shared so the gizmo and the menu spell a view once
// (see `axisView`).
import { axisViewLabel } from "./axis-triad.ts";
import { errorMessage } from "./humanize.ts";
import { notify } from "./notify-store.ts";
import type { PaletteId } from "./palette-store.ts";

// Re-exported rather than re-declared, so there is exactly ONE declaration of each and the
// files that name them off this module keep the import site they have — re-pointing them
// would be churn against no ownership gap, which is what the surface-membership rule asks
// us not to buy. Type-only, so nothing crosses into the chrome's bundle.
//
// `ActionGate` is NOT re-exported: it has no consumer outside the registry, and a re-export
// is one line on the day one appears. `ACTION_GROUPS` below stays HERE: what a group is
// called and in what order it renders is a chrome fact.
export type { ActionGroup, ActionId };

/** Everything an action can read or call, assembled once per render by
 *  `useActionContext` and handed to every `label`/`enabled`/`run`.
 *
 *  Nothing here may be a SNAPSHOT of something that changes between renders — see
 *  `host`. The one such value the gate needs (is the right button down?) is polled at
 *  dispatch time and travels in {@link GateEnv}, not here. */
export type ActionCtx = {
  /** The live host, or null before the engine bundle lands. Held as the OBJECT, never
   *  as a snapshot of its state: a method call on it answers for the instant it is
   *  made, which is what `host.isLooking()` has to be.
   *
   *  There is no separate `engineReady` beside it, deliberately: App assigns the host
   *  ref ONCE, synchronously, immediately before the dispatch that makes the editor
   *  ready (see `Shell.tsx`), so `host !== null` and "the engine is up" are the same
   *  fact — and a second spelling of one fact is a second thing to keep true. */
  host: FieldHost | null;
  /** What LMB is armed to do (`null` = the brush strokes). */
  gesture: ViewportGesture | null;
  tool: FieldTool;
  /** The live stamp/reconfigure/move session — `null` between sessions. */
  session: StampSession | null;
  /** The selected committed entity, resolved from the id the host published. */
  selectedEntity: FieldEntityInfo | null;
  /** The CELL selection (independent of the entity one — either can stand alone). */
  selection: SelectionInfo | null;
  stats: FieldStats | null;
  world: { name: string | null; dirty: boolean; busy: boolean };
  view: ViewState;
  workspace: { hidden: boolean };
  /** The registry generators, in registry order — the `S` family's member list. Read
   *  from the host rather than spelled here, so the family cannot drift from what core
   *  actually stages. */
  generators: readonly { id: string; name: string }[];
  /** Which generator `S` would stamp. `null` = the first one. */
  stampCursor: string | null;
  /** The stamp ARMED for region-draw, waiting on the two clicks that span its region
   *  (D-F4.5-7) — the host's own state, mirrored through `useFieldTool`. It SHADOWS
   *  `gesture`: while one stands LMB is drawing a region whatever the gesture slot
   *  still says, which is why {@link idle} reads it and every family's `armed` goes
   *  through that. */
  pendingStamp: { id: string; name: string } | null;
  /** What the last/next history step DID, for a named Undo/Redo — `null` when there is
   *  nothing to step, in which case the labels fall back to the bare verb. Derived from
   *  the top of each stack, which the history seam publishes as the LAST element. */
  history: { undoLabel: string | null; redoLabel: string | null };
  /** The verbs an action dispatches through. Host verbs are NOT here — they are called
   *  on `ctx.host` directly. These are the chrome's own funnels, and using them rather
   *  than the host is load-bearing for the two tool verbs: `host.setGesture` alone would
   *  leave the chrome's mirror showing the old arm. */
  run: {
    world: WorldActions;
    view: ViewActions;
    workspace: WorkspaceActions;
    openConfirm: (request: ConfirmRequest) => void;
    /** Arm what LMB does — mirror + host push (`useFieldTool`'s funnel). */
    setGesture: (gesture: ViewportGesture | null) => void;
    /** Arm a brush EFFECT: clamps paint to an organic class and returns LMB to the
     *  brush, exactly as the tool palette's own button does (one spelling — the palette
     *  calls this too). */
    armBrush: (effect: FieldTool["effect"]) => void;
    /** Point the `S` family at a generator id. */
    setStampCursor: (id: string) => void;
    /** Bring a palette somewhere the user can READ it — open, uncollapsed, unlatched and
     *  raised. The chrome's one summon spelling (`usePaletteSummon`), which the status
     *  bar's two chips and the burger's checkboxes go through too. */
    summonPalette: (id: PaletteId) => void;
    /** Raise the ⌘K command palette. Takes no {@link PaletteId} and never will: the
     *  command palette is a modal DIALOG over the whole window, not a member of the
     *  floating arrangement — nothing persists it, `⌘\` does not hide it, and it has no
     *  geometry to restore. A second verb rather than a `summonPalette("command")` for
     *  exactly that reason. */
    openCommandPalette: () => void;
    /** Raise the keyboard-shortcut overlay. The same shape as `openCommandPalette` above
     *  and for the same reason — another modal dialog the SHELL owns, which is what makes
     *  "open it" expressible from a pure table at all.
     *
     *  TWO verbs rather than one `openDialog(id)` funnel: with exactly two members a keyed
     *  funnel buys nothing and costs an id union plus a lookup at the shell (the
     *  tolerate-duplication-until-the-third rule). A THIRD shell-owned modal is the trigger
     *  to collapse all three. */
    openShortcuts: () => void;
  };
};

/** WHO is running this action — the discriminant of {@link GateEnv}, which is where the
 *  split and its reason are written. */
export type ActionCaller = "key" | "named";

/** The world OUTSIDE the ctx that the gate reads, all of it polled at DISPATCH time.
 *
 *  THE ONE ACCOUNT OF THE CALLER SPLIT (T3b2's S12 finding); {@link ActionCaller},
 *  {@link clickGate} and {@link gateAction} point here rather than each telling a quarter of
 *  it, which is what they were doing.
 *
 *  - `key` — a window keypress. Everything the gate refuses a KEY for is about a key: a
 *    character someone is typing, a letter the fly drag owns, a keycap on a menu-only verb.
 *  - `named` — the user (or an agent) NAMED the verb: a burger item, a rail button, a ⌘K
 *    row, a top-bar control, and tomorrow an MCP tool call. None of those is a character and
 *    none of them holds the right button, so none of the key classes applies.
 *
 *  A UNION rather than one record with a `caller` field beside four facts, and that is the
 *  whole of the fix. `clickGate` used to hard-code `inTextInput: false` on an argument —
 *  *"the user typed to find it and then named it"* — that is true of a palette row and
 *  UNTRUE of an agent, and a hard-coded fact defended by a caller-specific story is a fact
 *  waiting to be wrong for the next caller. Split by caller, the two key-only facts are
 *  simply not askable of a named call: there is no `false` left to write down, so nobody has
 *  to justify one. The hard-code became UNWRITEABLE rather than relocated. */
export type GateEnv =
  | {
      readonly caller: "key";
      /** `isTextInputTarget(e.target)` for this event. */
      readonly inTextInput: boolean;
      /** The right button is down and driving the camera (`host.isLooking()`). Polled per
       *  keypress and never stored on the ctx: the button goes down and up between renders,
       *  so a snapshot would answer for a frame that has already gone. Only actions marked
       *  {@link ActionDescriptor.flyLetter} care. */
      readonly looking: boolean;
      /** A modal confirm is open (`confirmRef.current !== null`). */
      readonly confirmOpen: boolean;
    }
  | {
      readonly caller: "named";
      /** The one fact both callers state. A modal is modal whoever is asking — though a
       *  chrome control activation cannot arrive while one covers the surface it sits on,
       *  which is why {@link NAMED_CALL} says `false`. An agent caller is the case that
       *  will have to answer this honestly, and it does not exist yet. */
      readonly confirmOpen: boolean;
    };

/** The env a chrome control activation pins by construction: the user chose a named thing,
 *  and a modal confirm covers the surface the press would land on. */
const NAMED_CALL: GateEnv = { caller: "named", confirmOpen: false };

/** Whether the key may fire, and what to tell the user when it may not. A `null` hint
 *  means refuse SILENTLY — the reason is already on screen (a modal dialog) or is the
 *  user's own hand (they are typing, they are holding the right button). */
export type GateVerdict = { ok: true } | { ok: false; hint: string | null };

/** What a run may be handed beyond the ctx, as the DISPATCHER holds it.
 *
 *  WIDENED, because a holder of 39 heterogeneous actions cannot name 39 input types, and
 *  every chrome surface is such a holder: they dispatch with no input at all and each run
 *  falls back to what the ctx has selected. Where the per-id typing DOES bind, and where it
 *  stops, is {@link ActionDef}'s to say — it is one account and it is told there. */
export type ActionInput = ActionInputs[keyof ActionInputs] | undefined;

/** One action's chrome half — the five things a serializable row cannot carry, typed
 *  against THIS action's input. */
type ActionBehavior<Id extends ActionId> = {
  /** What to call it on a surface, given the current state — "Delete hall #7", "Undo
   *  dig". Contextual because the menu is where a user checks WHAT a verb will act on. */
  label: (ctx: ActionCtx) => string;
  /** Whether the verb can do anything right now. A disabled action greys its menu item
   *  and swallows its key (the key is still CLAIMED — see the dispatcher). */
  enabled: (ctx: ActionCtx) => boolean;
  /** For the menu's checkbox items (the view toggles). Absent = a plain item. */
  checked?: (ctx: ActionCtx) => boolean;
  /** DO IT, and answer for it. See {@link ActionResult} for which failures are this
   *  action's verdict and which belong to a channel below it. */
  run: (ctx: ActionCtx, input: InputOf<Id>) => Promise<ActionResult>;
};

/** Every action's chrome half, keyed by id — EXHAUSTIVE BY TYPE, which is the whole reason
 *  {@link ActionId} exists and is argued at that type's own declaration rather than a second
 *  time here. This is the half of the join the union protects. */
type ActionBehaviors = { readonly [Id in ActionId]: ActionBehavior<Id> };

/** One action as every surface holds it: the row and its behaviors, joined.
 *
 *  `keys` is the BINDING (data), not a printed cap — `keycap()` derives the cap wherever one
 *  is drawn, which closes a gap `keybindings.test.ts` had already named in writing: *"a cap
 *  edited to `⇧/` would leave every case here green while the menu advertised a key nothing
 *  answers"*.
 *
 *  `run` is declared with METHOD syntax, deliberately and not as a style choice: method
 *  parameters are checked bivariantly, which is what lets a behavior declared against its
 *  own narrow `InputOf<Id>` sit in a table typed against the wide {@link ActionInput}.
 *
 *  BE EXACT ABOUT WHICH SITE THAT PROTECTS, because it is one of two. The DECLARATION site is
 *  checked: `BEHAVIORS` is keyed by {@link ActionId} and each row's `run` states its own
 *  `InputOf<Id>`, so `edit.duplicate` reading a `generatorId` does not compile. The DISPATCH
 *  site is NOT: `runAction(byId("edit.duplicate"), ctx, env, { name: "x" })` compiles, and
 *  degrades at runtime to the ctx fallback rather than doing anything with the `name`.
 *
 *  A generic (`runAction<Id extends ActionId>(def: ActionDef & { id: Id }, …,
 *  input?: InputOf<Id>)`) was tried and does not close it: `byId` answers `ActionDef`, whose
 *  `id` is `string`, so `Id` cannot be inferred from any call site the chrome actually
 *  writes. Recovering it means `byId<Id>(id: Id): ActionDef & { id: Id }`, a narrowing
 *  `ACTIONS.find`, and `ActionDef` becoming generic everywhere it is held — `ToolFamily.arm`,
 *  `ACTIONS`, five surfaces. Not bought, because no chrome caller passes an input at all: the
 *  gap is between a widened dispatcher and a future agent caller, and T4 is what will have a
 *  reason to close it. */
export type ActionDef = ActionDescriptor & {
  label: (ctx: ActionCtx) => string;
  enabled: (ctx: ActionCtx) => boolean;
  checked?: (ctx: ActionCtx) => boolean;
  run(ctx: ActionCtx, input?: ActionInput): Promise<ActionResult>;
};

/** The six groups in the order a user meets them, with what each is CALLED on a surface
 *  that shows headings.
 *
 *  Here rather than beside each surface because three of them now name the same six sets
 *  — the burger's submenu triggers, the shortcuts overlay's sections and the command
 *  palette's groups — and a group renamed in one of them would silently be two groups to
 *  anyone reading both. The ORDER is part of the data for the same reason: the overlay and
 *  the palette both list all six, and two different orders is two different mental maps.
 *  `help` is LAST because documentation about the verbs belongs after the verbs.
 *  Every group carrying an action must appear here (asserted in `tests/actions.test.ts`). */
export const ACTION_GROUPS: readonly { id: ActionGroup; title: string }[] = [
  { id: "world", title: "World" },
  { id: "edit", title: "Edit" },
  { id: "tool", title: "Tools" },
  { id: "session", title: "Session" },
  { id: "view", title: "View" },
  { id: "help", title: "Help" },
];

// --- results ------------------------------------------------------------------

/** The run of a verb that HANDS OFF and cannot fail from here — every action whose whole
 *  body is one call into the host or into one of the chrome's own funnels.
 *
 *  NO COUNT, deliberately. This file's own header records that the reader count "was three
 *  when this file was written and has been wrong at every re-count since"; a second tally
 *  nothing checks would rot the same way, and it did — the first draft of this line said 30
 *  and `ACTION_OK`'s said 34 about the same set, where head has 31 (25 here plus the six
 *  axis views, which reach this through `axisView`). The membership is greppable: it is
 *  every `run: handOff(` in `BEHAVIORS`.
 *
 *  It is not optimism. A host verb that refuses reports on the host's OWN channel
 *  (`reportToolError` → `subscribeToolError` → a toast), later and asynchronously, and that
 *  refusal is not this action's verdict to give — see {@link ActionResult}'s module header
 *  for the three provenances and the rule that keeps them from doubling a toast. */
const handOff =
  (effect: (ctx: ActionCtx) => void) =>
  (ctx: ActionCtx): Promise<ActionResult> => {
    effect(ctx);
    return Promise.resolve(ACTION_OK);
  };

/** The same hand-off, for a run that had to compute or refuse something FIRST — so it is
 *  called at the END of a body where {@link handOff} wraps one. */
const okAfter = (effect: () => void): Promise<ActionResult> => {
  effect();
  return Promise.resolve(ACTION_OK);
};

// --- families ---------------------------------------------------------------
//
// THE ROWS ARE THE ONLY COPY since T3b2 Task 5. Three member arrays used to stand here —
// each spelling a label, a per-member sentence and a `{effect}`/`{gesture}` discriminator
// that the strip, the keymap line and the breakpoint table each keyed on separately. They
// are `shared/action-table.ts`'s `FAMILY_ROWS` now, and this file joins the three things a
// row cannot hold onto them: the contextual label, the resolved members and the `armed`
// predicate. Same shape as `BEHAVIORS` above, one layer up.
//
// The row's `memberSource` is what makes that join a lookup rather than a switch on family
// id: it states which of two rules a column follows — for its members, its label AND its
// armed predicate, which are one distinction and not three — and the three functions below
// implement each rule once instead of once per column.

/** The four columns, resolved once at module init. Named apart from the table's own
 *  `FAMILY_ROWS`, which is the un-resolved half: these carry their members. */
const FAMILIES = deriveFamilies();

/** A column BY ID, throwing on a miss. The four arm/cycle runs below need their own members,
 *  and a `find` answering `undefined` would leave a bare-letter press doing nothing at all —
 *  the same reason `byId` throws one table up. */
function familyOf(id: FamilyId): DerivedFamily {
  const row = FAMILIES.find((f) => f.id === id);
  if (row === undefined) throw new Error(`actions: no tool family "${id}"`);
  return row;
}

/** Which member is armed right now, as an index into the family's members — `-1` when none
 *  is (the family is not the armed one). A `gesture` member wins over the brush effect,
 *  because arming `segment` is what LMB is actually doing. */
function armedIndex(members: readonly DerivedMember[], ctx: ActionCtx): number {
  const byGesture = members.findIndex(
    (m) => "gesture" in m.ref && m.ref.gesture === ctx.gesture,
  );
  if (byGesture !== -1) return byGesture;
  // The brush effect only counts while LMB still brushes: under `pointer` or a cell
  // gesture the effect is a remembered setting, not an arm.
  if (ctx.gesture !== null) return -1;
  return members.findIndex(
    (m) => "effect" in m.ref && m.ref.effect === ctx.tool.effect,
  );
}

/** Arm exactly this member and nothing else.
 *
 *  The trailing `setGesture(null)` is what makes the brush family a RING rather than a
 *  trap, and the bug it fixes was live: `brushArming` deliberately does NOT disarm
 *  `segment` when a brush effect is picked ("Fill under Segment means sweep a rampart, not
 *  stop segmenting"), and `armedIndex` resolves by GESTURE first — so once `segment` was
 *  armed, every ⇧B armed dig, left the gesture on `segment`, and came back to index 4 to
 *  arm dig again. The cycle could not leave Segment at all, and neither could the rail's
 *  member flyout.
 *
 *  The two rules are about different gestures and both stand: picking a member from THIS
 *  list is EXCLUSIVE — arming one leaves the others — while `X`'s dig↔fill swap goes through
 *  `armBrush` alone and still keeps a live segment, which is exactly where re-aiming is the
 *  point. */
function armMember(member: DerivedMember, ctx: ActionCtx): void {
  if ("gesture" in member.ref) {
    ctx.run.setGesture(member.ref.gesture);
    return;
  }
  ctx.run.armBrush(member.ref.effect);
  // Only `segment` needs saying: every other gesture is already dropped inside
  // `armBrush` (`brushArming.disarmGesture`), and re-pushing a null the host already
  // holds would be a redundant call on every bare-letter press.
  if (ctx.gesture === "segment") ctx.run.setGesture(null);
}

/** Arm the family's CURRENT member — the bare press. With nothing of the family armed it
 *  takes the first, which is what makes one key enough to enter a family. */
function armFamily(id: FamilyId, ctx: ActionCtx): void {
  const members = familyOf(id).members;
  const i = armedIndex(members, ctx);
  const member = members[i === -1 ? 0 : i];
  if (member !== undefined) armMember(member, ctx);
}

/** Step to the next member and arm it — the ⇧ press. Wraps. */
function cycleFamily(id: FamilyId, ctx: ActionCtx): void {
  const members = familyOf(id).members;
  const i = armedIndex(members, ctx);
  const member = members[(i + 1) % members.length];
  if (member !== undefined) armMember(member, ctx);
}

/** The generator the `S` family points at, or null when the registry is empty. The
 *  cursor is an id rather than an index so it survives a registry that reorders. */
function stampMember(ctx: ActionCtx): { id: string; name: string } | null {
  const byCursor = ctx.generators.find((g) => g.id === ctx.stampCursor);
  return byCursor ?? ctx.generators[0] ?? null;
}

// --- labels -----------------------------------------------------------------

/** How a committed entity is named in a sentence. Entities carry no user-facing name —
 *  the palette rows say `hall #7`, and a second spelling here would be a second thing to
 *  keep in agreement with them.
 *
 *  Exported since F4.5b Task 8: the top strip's pointer readout names the SAME entity the
 *  rows highlight and the menu labels act on, and three spellings of one name is three
 *  places a user has to work out they are looking at one object. */
export const entityName = (e: FieldEntityInfo): string =>
  `${e.generator} #${e.entityId}`;

/** The one sentence the three entity verbs share when they have nothing to act on. A
 *  BACKSTOP: `enabled` already refuses each of them with no selection, so the chrome never
 *  reaches it — what it is for is the caller that does not consult `enabled` and does not
 *  name an `entityId` either. */
const NO_ENTITY = "no stamp selected — select one, or name an entityId";

// --- the six axis views (F4.5c Task 5) ---------------------------------------

type Axis = "x" | "y" | "z";

/** The id an axis and a sign MUST carry, computed from the pair itself. */
type AxisViewId<
  A extends Axis,
  S extends 1 | -1,
> = `view.snap${S extends 1 ? "Pos" : "Neg"}${Uppercase<A>}`;

/** One axis view's behaviors, with its id CHECKED against the pair it snaps to.
 *
 *  Six behaviors differing only by two arguments is exactly the shape a copy-paste slip
 *  survives in — a `NegZ` that passes `+1` reads perfectly in review and sends the camera to
 *  the far side of the world. Generating the six from a loop would rule that out, but at the
 *  cost of the registry's own premise: this table is meant to be GREPPABLE (`TopBar` and the
 *  suites both look actions up by id literal), and a template-built id leaves
 *  `grep view.snapNegZ` returning prose and no definition.
 *
 *  So the ids stay literal and the type does the pairing: `AxisViewId` computes the id from
 *  `axis` and `sign`, so `axisView("view.snapNegZ", "z", 1)` is a compile error (TS2345),
 *  and so is a mismatched axis — and since the return is `ActionBehavior<AxisViewId<A,S>>`,
 *  so is filing it under the wrong key in `BEHAVIORS`. Same guarantee, still greppable.
 *
 *  THE SIX SHARE THIS ONE RUNNER and carry NO input schema of their own, which is the
 *  settled reading of "the axis views need input": their axis and sign ARE the id, so a
 *  `{axis, sign}` schema on `view.snapNegZ` would let a caller hand it `x` and make the id a
 *  lie. What they carry instead is `mcpProjection` — the record that the six collapse onto
 *  one `view.snap {axis, sign}` agent tool. Recorded here, built in T4.
 *
 *  WHY THEY EXIST AT ALL — an accessibility remedy, not a convenience. `AxisTriad`'s six
 *  tips are hit targets below WCAG 2.2 SC 2.5.8's minimum, and unfixably so at that size;
 *  the measurements live on `HIT`/`NEG_HIT` there. That SC does not apply to a control whose
 *  function is reachable another way on the same page — these rows are that other way.
 *  Delete this list and the finding re-opens (`docs/reference/editor-architecture.md`
 *  §18.5). The labels come from `axisViewLabel`, which is also what each TIP is called — one
 *  spelling, so the gizmo and the menu cannot name one view two ways (D-12). That is not
 *  tidiness: two differently-worded controls are two controls to a screen reader rather than
 *  one reachable twice, which is the exception above failing. */
const axisView = <A extends Axis, S extends 1 | -1>(
  // biome-ignore lint/correctness/noUnusedFunctionParameters: the id is the PAIRING CHECK — `AxisViewId<A,S>` is what makes a mismatched axis/sign a compile error, and the key it is filed under agree with it
  id: AxisViewId<A, S>,
  axis: A,
  sign: S,
): ActionBehavior<AxisViewId<A, S>> => ({
  label: () => axisViewLabel(axis, sign),
  // Live with no selection and no engine, like `view.frame` beside it: a view verb needs
  // neither, and a row greyed with no visible reason reads as broken.
  enabled: () => true,
  run: handOff((ctx) => ctx.host?.snapView(axis, sign)),
});

// --- the behaviors ------------------------------------------------------------
//
// In the descriptors' own order, which is the order every surface renders. A row and its
// behaviors are one action read two ways; keeping the two files in step is what the
// exhaustive keying above enforces, and reading them side by side is what the shared order
// is for.

const BEHAVIORS: ActionBehaviors = {
  // ——— world ———————————————————————————————————————————————————————————————
  "world.new": {
    label: () => "New",
    // New empties the host's world SYNCHRONOUSLY, so a New landing mid-save writes the
    // freshly-emptied world over the named target.
    enabled: (ctx) => !ctx.world.busy,
    run: handOff((ctx) => ctx.run.world.reset()),
  },
  "world.open": {
    label: () => "Open…",
    enabled: () => true,
    run: handOff((ctx) => ctx.run.world.openDrawer("browse")),
  },
  "world.save": {
    label: () => "Save",
    enabled: (ctx) => !ctx.world.busy,
    // ONE OF THE TWO THAT GENUINELY AWAIT. `save` used to be fired into the void
    // (`void write(...)` inside `useWorld`), so a rejection out of the upload became an
    // unhandled promise rejection and a caller could not tell a save from a refusal. The
    // verb now answers, and the funnel says whatever it answers.
    run: (ctx) => ctx.run.world.save(),
  },
  "world.saveAs": {
    label: () => "Save as…",
    enabled: () => true,
    // TWO BEHAVIOURS ON ONE VERB, which is what "name a copy" means: with no name, ask for
    // one (the drawer, which is what ⇧⌘S has always done); with one, write it. That is the
    // whole reason this row carries a `{name}` schema — a human names the copy in a form,
    // an agent names it in the call.
    run: (ctx, input) =>
      input === undefined
        ? okAfter(() => ctx.run.world.openDrawer("save-as"))
        : ctx.run.world.saveAs(input.name),
  },
  "world.bake": {
    // The reason rides IN the label: a disabled menu item swallows the tooltip that
    // would otherwise carry it. TWO reasons now, most specific first.
    label: (ctx) => {
      if (ctx.session !== null) return "Bake — finish the session first";
      // The reason names the WAY OUT, not just the blocker: ⌘S is what gives the world a
      // name. It reads the same in the menu item and in the top bar's tooltip because both
      // render this one string.
      return ctx.world.name === null
        ? "Bake — name the world first (⌘S)"
        : "Bake";
    },
    // Refused during a session, and this clause is what makes the top bar's hidden Bake
    // honest rather than decorative: `exportArtifact` bakes from the COMMITTED field and op
    // log (`bakeFieldWorld(store, log, …)`), and a live session's ghost is in neither, so a
    // bake here writes a world without the thing on screen. Before this clause the top bar
    // hid the button while the burger's World group still offered it — the same hazard one
    // menu click away, and two surfaces disagreeing about whether the verb exists.
    enabled: (ctx) =>
      !ctx.world.busy && ctx.world.name !== null && ctx.session === null,
    run: (ctx) => ctx.run.world.bake(),
  },
  "world.makeDefault": {
    label: (ctx) =>
      ctx.world.name === null
        ? "Make default — name the world first (⌘S)"
        : "Make default",
    enabled: (ctx) => ctx.world.name !== null,
    // Shown only when the item is ENABLED (a disabled one has pointer-events-none), which
    // is the case this sentence is for: it distinguishes Make default from Bake, and the
    // label has no room for that.
    //
    // NOT ONE OF THE AWAITING THREE, and the digest that said it was had the shape wrong:
    // this verb opens a MODAL and returns. The promise it is said to fire lives two hops
    // down, inside the confirm's `onConfirm` (`useWorld`'s `runVerb`), and awaiting it from
    // here would mean awaiting a human decision — and leaking the promise on every cancel.
    // The verdict answers for the DISPATCH: the confirm was raised.
    //
    // The three that DO await are `save`, `saveAs` and `bake` — the three `WorldActions`
    // members returning `Promise<ActionResult>`, against eight still returning `void`. The
    // digest marked a different three (`save`, `bake` and this verb), so it was wrong twice
    // in one column: it named this one and missed `saveAs`.
    run: (ctx, input) => {
      const name = input?.name ?? ctx.world.name;
      if (name === null)
        return Promise.resolve(refused("name the world first (⌘S)"));
      return okAfter(() => ctx.run.world.makeDefault(name));
    },
  },

  // ——— edit ————————————————————————————————————————————————————————————————
  "edit.undo": {
    // The field's op log IS the editor's history — there is no second document to step.
    label: (ctx) =>
      ctx.history.undoLabel === null ? "Undo" : `Undo ${ctx.history.undoLabel}`,
    enabled: (ctx) => (ctx.stats?.undoDepth ?? 0) > 0,
    run: handOff((ctx) => ctx.host?.undo()),
  },
  "edit.redo": {
    label: (ctx) =>
      ctx.history.redoLabel === null ? "Redo" : `Redo ${ctx.history.redoLabel}`,
    enabled: (ctx) => (ctx.stats?.redoDepth ?? 0) > 0,
    run: handOff((ctx) => ctx.host?.redo()),
  },
  "edit.duplicate": {
    label: (ctx) =>
      ctx.selectedEntity === null
        ? "Duplicate"
        : `Duplicate ${entityName(ctx.selectedEntity)}`,
    enabled: (ctx) => ctx.selectedEntity !== null,
    run: (ctx, input) => {
      const entityId = input?.entityId ?? ctx.selectedEntity?.entityId;
      if (entityId === undefined) return Promise.resolve(refused(NO_ENTITY));
      return okAfter(() => ctx.host?.duplicateEntity(entityId));
    },
  },
  "edit.delete": {
    label: (ctx) =>
      ctx.selectedEntity === null
        ? "Delete"
        : `Delete ${entityName(ctx.selectedEntity)}`,
    // Refused during a session: the session may BE the selected entity's reconfigure,
    // and deleting the entity under it cancels the session the user is still editing.
    enabled: (ctx) => ctx.selectedEntity !== null && ctx.session === null,
    run: (ctx, input) => {
      const entity = ctx.selectedEntity;
      if (entity === null) return Promise.resolve(refused(NO_ENTITY));
      // THE ONE ENTITY VERB THAT CANNOT ACT ON AN UNSELECTED ID, and the limit is the
      // confirm rather than the delete: the prompt below names the generator and counts the
      // ops, and both come off `ctx.selectedEntity` — the only entity the chrome can
      // describe. Duplicate and Grab need the id alone, so they take any. A caller naming
      // another entity gets told what to do about it rather than a prompt describing the
      // wrong stamp. (T4's projection is where a host-side lookup would change this.)
      const entityId = input?.entityId ?? entity.entityId;
      if (entityId !== entity.entityId)
        return Promise.resolve(
          refused(
            `select stamp #${entityId} first — Delete confirms against the SELECTED stamp`,
          ),
        );
      // The same prompt the palette row raises, with the op count in it: a row reads
      // "3 ops" but a scatter reads "1 ops" and takes every prop it placed with it.
      const ops = entity.opSpan[1] - entity.opSpan[0] + 1;
      return okAfter(() =>
        ctx.run.openConfirm({
          title: `Delete stamp #${entity.entityId}?`,
          message: `Removes ${entity.generator} #${entity.entityId} and the ${ops} op${ops === 1 ? "" : "s"} it committed. Edits made after it are replayed onto what is left, so a dig that cut through this stamp survives as a dig into whatever was underneath. ⌘Z puts it back.`,
          confirmLabel: "Delete",
          destructive: true,
          onConfirm: () => ctx.host?.deleteEntity(entity.entityId),
        }),
      );
    },
  },
  "edit.grab": {
    label: (ctx) =>
      ctx.selectedEntity === null
        ? "Move"
        : `Move ${entityName(ctx.selectedEntity)}`,
    // No session, for `edit.delete`'s reason plus its own: `beginMove` REPLACES the live
    // session, so a G during a reconfigure would discard the params being edited.
    enabled: (ctx) => ctx.selectedEntity !== null && ctx.session === null,
    run: (ctx, input) => {
      const entityId = input?.entityId ?? ctx.selectedEntity?.entityId;
      if (entityId === undefined) return Promise.resolve(refused(NO_ENTITY));
      return okAfter(() => ctx.host?.beginMove(entityId));
    },
  },
  "edit.clearSelection": {
    label: (ctx) =>
      ctx.selection === null
        ? "Clear selection"
        : `Clear ${ctx.selection.count} selected cell${ctx.selection.count === 1 ? "" : "s"}`,
    // Gated on there BEING one, unlike Esc's ladder: Esc is one key that cancels the
    // most recent thing, so it is never refused, but a named menu item over an empty
    // selection is a verb with no object.
    enabled: (ctx) => ctx.selection !== null,
    run: handOff((ctx) => ctx.host?.clearSelection()),
  },
  "edit.reselect": {
    label: () => "Reselect",
    // ALWAYS live, and the asymmetry with Clear above is the point: Reselect matters
    // exactly when there is NO selection, because what it restores is what the last
    // Clear (or replace) displaced. The host no-ops on an empty slot.
    enabled: () => true,
    run: handOff((ctx) => ctx.host?.reselect()),
  },
  "edit.history": {
    // Named for the surface it opens, and ALWAYS enabled: an empty history is something
    // the palette SAYS ("nothing yet"), not a reason to grey out the way to it. The other
    // disabled items in this menu are gated on a missing INPUT (a world name, a selected
    // stamp, something to step); a summon has none.
    label: () => "History…",
    enabled: () => true,
    run: handOff((ctx) => ctx.run.summonPalette("history")),
  },

  // ——— tool ————————————————————————————————————————————————————————————————
  "tool.pointer": {
    label: () => "Select",
    enabled: () => true,
    run: handOff((ctx) => ctx.run.setGesture("pointer")),
  },
  "tool.brush": {
    label: () => "Brush",
    enabled: () => true,
    run: handOff((ctx) => armFamily("brush", ctx)),
  },
  "tool.brushCycle": {
    label: () => "Next brush",
    enabled: () => true,
    run: handOff((ctx) => cycleFamily("brush", ctx)),
  },
  "tool.select": {
    label: () => "Cell select",
    enabled: () => true,
    run: handOff((ctx) => armFamily("select", ctx)),
  },
  "tool.selectCycle": {
    label: () => "Next cell select",
    enabled: () => true,
    run: handOff((ctx) => cycleFamily("select", ctx)),
  },
  "tool.stamp": {
    label: (ctx) => {
      const member = stampMember(ctx);
      return member === null ? "Stamp" : `Stamp ${member.name}`;
    },
    enabled: (ctx) => ctx.generators.length > 0,
    // THE EXEMPLAR of the input channel. The chrome dispatches with nothing and gets the
    // `S` family's cursor; a caller that names a generator opens that one instead, without
    // moving the cursor a human is reading off the status bar.
    run: (ctx, input) => {
      const generatorId = input?.generatorId ?? stampMember(ctx)?.id;
      if (generatorId === undefined)
        return Promise.resolve(
          refused("nothing to stamp — this project registers no generators"),
        );
      return okAfter(() => ctx.host?.startStamp(generatorId));
    },
  },
  "tool.stampCycle": {
    label: () => "Next stamp",
    enabled: (ctx) => ctx.generators.length > 1,
    run: handOff((ctx) => {
      const current = stampMember(ctx);
      if (current === null) return;
      const i = ctx.generators.findIndex((g) => g.id === current.id);
      const next = ctx.generators[(i + 1) % ctx.generators.length];
      if (next !== undefined) ctx.run.setStampCursor(next.id);
    }),
  },
  "tool.swapEffect": {
    label: () => "Swap dig ↔ fill",
    enabled: (ctx) => ctx.tool.effect === "dig" || ctx.tool.effect === "fill",
    run: handOff((ctx) =>
      ctx.run.armBrush(ctx.tool.effect === "dig" ? "fill" : "dig"),
    ),
  },

  // ——— session —————————————————————————————————————————————————————————————
  "session.confirm": {
    label: (ctx) =>
      ctx.session?.moving === true ? "Drop the move" : "Apply session",
    // Live for a MOVE too, and that is load-bearing: `beginMove` does not focus the
    // canvas, so a grab started from the Edit menu or by `G` with a palette control
    // focused has no canvas listener to answer ⏎ — while the status bar advertises
    // "⏎ drop". `confirmSession` is the move-aware verb both keys route through.
    enabled: (ctx) => ctx.session !== null,
    run: handOff((ctx) => ctx.host?.confirmSession()),
  },
  "session.rotate": {
    label: () => "Rotate a quarter turn",
    enabled: (ctx) => ctx.session !== null,
    run: handOff((ctx) => ctx.host?.rotateStamp()),
  },
  "session.escape": {
    label: () => "Cancel",
    // Never disabled: the ladder decides what there is to cancel, and an Esc with
    // nothing to cancel is a no-op rather than a refusal.
    enabled: () => true,
    run: handOff((ctx) => ctx.host?.escape()),
  },

  // ——— view ————————————————————————————————————————————————————————————————
  "view.commandPalette": {
    // Named for what it DOES rather than for what it is. "Command palette" is jargon a
    // first-time user has to already know; "Find a command…" is the question they have.
    // The ellipsis is the menu convention for "opens a surface" (View options…, History…).
    label: () => "Find a command…",
    // Never refused. It reaches the whole table, so the one state in which it would be
    // useless is one where nothing at all can run — and in that state the palette SHOWING
    // every verb greyed with its reason is the most useful screen in the editor.
    enabled: () => true,
    run: handOff((ctx) => ctx.run.openCommandPalette()),
  },
  "view.frame": {
    label: () => "Frame selection",
    // The host reports "nothing to frame" itself, so this stays live with neither
    // selection: a key that swallows the press and says nothing reads as broken.
    enabled: () => true,
    run: handOff((ctx) => ctx.host?.frameSelection()),
  },
  "view.frameWorld": {
    label: () => "Frame world",
    // Same stance as `view.frame` beside it: the host says "nothing to frame yet"
    // itself, so this stays live on an empty world rather than going quiet.
    enabled: () => true,
    run: handOff((ctx) => ctx.host?.frameWorld()),
  },
  "view.snapPosX": axisView("view.snapPosX", "x", 1),
  "view.snapNegX": axisView("view.snapNegX", "x", -1),
  "view.snapPosY": axisView("view.snapPosY", "y", 1),
  "view.snapNegY": axisView("view.snapNegY", "y", -1),
  "view.snapPosZ": axisView("view.snapPosZ", "z", 1),
  "view.snapNegZ": axisView("view.snapNegZ", "z", -1),
  "view.normals": {
    label: () => "Normals shading",
    enabled: () => true,
    checked: (ctx) => ctx.view.shading === "normals",
    run: handOff((ctx) =>
      ctx.run.view.setShading(
        ctx.view.shading === "normals" ? "studio" : "normals",
      ),
    ),
  },
  "view.grid": {
    label: () => "Grid",
    enabled: () => true,
    checked: (ctx) => ctx.view.layers.grid,
    run: handOff((ctx) =>
      ctx.run.view.setLayers({
        ...ctx.view.layers,
        grid: !ctx.view.layers.grid,
      }),
    ),
  },
  "view.togglePalettes": {
    label: (ctx) => (ctx.workspace.hidden ? "Show palettes" : "Hide palettes"),
    enabled: () => true,
    run: handOff((ctx) => ctx.run.workspace.toggleHidden()),
  },
  "view.resetWorkspace": {
    label: () => "Reset workspace",
    enabled: () => true,
    run: handOff((ctx) => ctx.run.workspace.reset()),
  },

  // ——— help ————————————————————————————————————————————————————————————————
  "help.shortcuts": {
    // NO ellipsis, unlike every other surface-opener in this table (Open…, Save as…,
    // History…, View options…, Find a command…). That is this row inheriting the burger
    // item's existing wording rather than a considered exception — four test sites and a
    // user's muscle memory name it as it is, and the label is out of the ruling's scope.
    label: () => "Keyboard shortcuts",
    // Never refused. The state where a user cannot work out which key does what is exactly
    // the state this overlay is for, so there is nothing to gate it on.
    enabled: () => true,
    run: handOff((ctx) => ctx.run.openShortcuts()),
  },
};

// --- the table --------------------------------------------------------------

/** Every action, in the descriptors' order, with its chrome half joined on.
 *
 *  Boundary cast: `BEHAVIORS` is keyed by {@link ActionId} and the exported
 *  `ACTION_DESCRIPTORS` is widened to `ActionDescriptor` (so its readers can touch the
 *  optional fields the shape declares), which leaves the compiler unable to see that `d.id`
 *  is one of the 39 keys — a fact the two are declared from the SAME literal array to
 *  guarantee. Read back through a `Record<string, …>` and asserted non-undefined rather than
 *  index-asserted, so a rename that somehow escaped the exhaustive keying still fails loudly
 *  at import rather than shipping a dead row. */
export const ACTIONS: readonly ActionDef[] = ACTION_DESCRIPTORS.map((d) => {
  const behavior: ActionBehavior<ActionId> | undefined = (
    BEHAVIORS as Readonly<Record<string, ActionBehavior<ActionId>>>
  )[d.id];
  if (behavior === undefined)
    throw new Error(`actions: no behavior for "${d.id}"`);
  return { ...d, ...behavior };
});

/** The action with this id, THROWING on a miss — so an id renamed in the table above
 *  cannot leave a control wired to nothing.
 *
 *  NARROWED to {@link ActionId} in T3b2 Task 4, which is what Task 3 said the union would
 *  buy the day something could use it: every one of the dozen `byId("…")` literals in the
 *  chrome is now checked at compile time, and the throw is the backstop for the one caller
 *  that cannot be (a test naming an id that is deliberately not there).
 *
 *  Exported because every surface that names ONE action needs it and the alternative is
 *  `ACTIONS.find(...)` returning `ActionDef | undefined`, which reads as a nullable and gets
 *  papered over with `?.`: a renamed action then renders a blank keycap instead of failing.
 *  `TOOL_FAMILIES` calls it at MODULE INIT, where the throw takes the whole editor down at
 *  import rather than shipping a dead column; a caller reaching for it during render gets
 *  the same guarantee one render later. */
export function byId(id: ActionId): ActionDef {
  const def = ACTIONS.find((a) => a.id === id);
  if (def === undefined) throw new Error(`actions: no action "${id}"`);
  return def;
}

/** What this group is called, THROWING on a group missing from {@link ACTION_GROUPS}.
 *
 *  The list is an array (its ORDER is data), so TypeScript cannot prove it covers the
 *  union the way a `Record<ActionGroup, string>` would. This is that proof, moved to
 *  runtime: without it a group added to `ActionGroup` and forgotten here renders an EMPTY
 *  heading — a menu section with rows and no name — instead of failing.
 *  `tests/actions.test.ts` asserts the covering case, so this throw is the backstop rather
 *  than the first thing to notice. */
export function groupTitle(group: ActionGroup): string {
  const found = ACTION_GROUPS.find((g) => g.id === group);
  if (found === undefined)
    throw new Error(`actions: group "${group}" is not in ACTION_GROUPS`);
  return found.title;
}

/** The keycap a surface prints for this action, or `undefined` for a menu-only verb.
 *
 *  A thin read of the registry's `keycap()` over `def.keys`, here so every surface that
 *  prints one spells it once (six files do, and the number is not written down — see the
 *  note on `handOff` for why this file states no counts it does not have to). What it replaces is a `keys: "⇧⌘S"` STRING on every row, declared beside a
 *  matcher it had to agree with by review; the cap is now a view of the binding. */
export const capOf = (def: ActionDef): string | undefined =>
  def.keys === undefined ? undefined : keycap(def.keys);

// --- the tool families, as the RAIL renders them -----------------------------

/** One member of a tool family, resolved against the current state — what the rail's
 *  corner flyout lists and what the ⇧ chord steps through. */
export type ToolFamilyMember = {
  /** Stable within its family; the generator id for a stamp, the member label otherwise. */
  id: string;
  label: string;
  /** The one sentence this member needs and its family cannot give it — the momentary
   *  modifier, the organic-only clamp, the 60 m segment cap. */
  hint: string;
  /** Is THIS member the one the family is currently on? */
  armed: boolean;
  /** DO THE ARM — push at `ctx.run` (`armMember`, which reads `ctx.gesture` and pushes twice
   *  when it has to drop a live `segment`) or call the host (`startStamp`). THE EFFECT, not
   *  the dispatch: it does not gate, does not speak and answers nothing, which is why no
   *  surface may call it. {@link runMember} is its ONE caller — literally, and
   *  `grep -rn "member\.arm(" packages/editor/src` is the check — and is what gives a pick
   *  its gate and its {@link ActionResult}. */
  arm: (ctx: ActionCtx) => void;
};

/** A rail column entry: one family, its arming action, and its members.
 *
 *  The rail does not re-implement any of this — it renders `TOOL_FAMILIES` and dispatches
 *  `arm`, so a click and the family's key are the same code path. That is what stops the
 *  rail and the keyboard from meaning different things, which is the defect class this
 *  slice has closed four times. */
export type ToolFamily = {
  id: FamilyId;
  /** The family's STABLE name, for surfaces that name the set rather than the press —
   *  the rail's member flyout. Distinct from `arm.label`, which is contextual and may
   *  name a MEMBER ("Stamp Hall"): a flyout headed "Stamp Hall tools" would be named
   *  after one of the things it lists. */
  name: string;
  /** What the family button is called RIGHT NOW — separate from `arm.label`, which answers
   *  a different question once a session is live. Which of the two rules a column follows is
   *  the ROW's (`memberSource`); {@link familyLabel} implements both and carries the why. */
  label: (ctx: ActionCtx) => string;
  /** The action a click on the family BUTTON runs: arm the family's CURRENT member (the
   *  bare-letter press). Deliberately not the cycle — see `cycle`. */
  arm: ActionDef;
  /** The ⇧ chord that steps to the next member; `null` for a one-member family, where a
   *  cycle key would be a keycap that does nothing. */
  cycle: ActionDef | null;
  /** Its members in cycle order. A function because the stamp family's members are the
   *  host's registry, which the ctx carries. */
  members: (ctx: ActionCtx) => readonly ToolFamilyMember[];
  /** Is this the family LMB is currently doing? Exactly one is true at a time. */
  armed: (ctx: ActionCtx) => boolean;
};

/** Is the STAGED grammar (D-7) idle — no session, no stamp armed for region-draw?
 *
 *  Either one owns the interaction, so no gesture family reads as armed while one
 *  stands; the stamp family reads armed instead, because both states ARE the staged
 *  grammar running. Without this the rail would show a brush armed beside a bar
 *  saying the tools are locked, or `pointer` pressed while LMB drew a stamp region.
 *
 *  The pending arm and the session are deliberately ONE question here: a stamp picked
 *  with nothing selected is the same act as one picked with a selection, a click
 *  earlier in its life. */
const idle = (ctx: ActionCtx): boolean =>
  ctx.session === null && ctx.pendingStamp === null;

/** What the family button is called right now, per the row's `memberSource` — which carries
 *  the naming rule too, for the reason that field's own note gives.
 *
 *  A `"rows"` column takes the arm action's own label, which is what three of the four want.
 *  A `"generators"` column names whatever is RUNNING: `pendingStamp` ▸ session ▸ the arm
 *  action's label. A pending arm and a live session cannot both stand (opening one clears the
 *  other), so that is a fallback rather than a priority — name whichever is running, and fall
 *  through to the ⇧S cursor, which is what the arm label reports, only when nothing is. */
function familyLabel(family: DerivedFamily): (ctx: ActionCtx) => string {
  if (family.memberSource === "rows")
    return (ctx) => byId(family.arm).label(ctx);
  return (ctx) => {
    if (ctx.pendingStamp !== null) return `Stamp ${ctx.pendingStamp.name}`;
    const live = ctx.session;
    if (live === null) return byId(family.arm).label(ctx);
    const def = ctx.generators.find((g) => g.id === live.generator);
    return `Stamp ${def?.name ?? live.generator}`;
  };
}

/** The family's members, resolved against the current state, per the row's `memberSource`.
 *
 *  `"rows"` — the table's own, with `armed` from the same `armedIndex` the ⇧ cycle uses, so
 *  the flyout's tick and the cycle's starting point are one answer. `id` is the member LABEL
 *  here and the generator ID below, which is the one place that choice is made and the
 *  reason {@link DerivedMember} carries no `id` of its own.
 *
 *  `"generators"` — the host's registry, straight through: a stamp "member" is a generator,
 *  and picking one OPENS a session rather than arming a mode. */
function familyMembers(
  family: DerivedFamily,
): (ctx: ActionCtx) => readonly ToolFamilyMember[] {
  if (family.memberSource === "generators")
    return (ctx) =>
      ctx.generators.map((g) => ({
        id: g.id,
        label: g.name,
        // A generator's own hint is its ROLE, which nothing in the registry carries per
        // generator — `FieldGeneratorInfo` has id/name/paramSchema/defaults/placesProps.
        // What IS true of every one of them, and is the fact a first-time user needs, is
        // what picking it DOES — and since F4.5b Task 9 that is TWO answers, so the hint
        // gives both. The flyout is the one surface the user is looking at at the moment
        // they pick, so a hint promising a session (and naming two keys that mean nothing
        // yet) is wrong exactly where it is being read.
        hint: "opens a session on the selection — or click ×2 to draw its region",
        armed: ctx.pendingStamp?.id === g.id || ctx.session?.generator === g.id,
        arm: (c: ActionCtx) => c.host?.startStamp(g.id),
      }));
  return (ctx) => {
    const i = armedIndex(family.members, ctx);
    return family.members.map((m, index) => ({
      id: m.label,
      label: m.label,
      hint: m.hint,
      armed: index === i && idle(ctx),
      arm: (c: ActionCtx) => armMember(m, c),
    }));
  };
}

/** Is this the family LMB is currently doing? Exactly one is true at a time.
 *
 *  ON `memberSource` RATHER THAN ON THE ID, because that field is what the two answers
 *  actually differ by. A `"rows"` column is armed when one of its own member refs matches
 *  what LMB is on — `armedIndex` is the whole rule, and it is why the brush counts as armed
 *  both with LMB on the stroke (gesture null) and under `segment`, whose click commits a
 *  brush op. A `"generators"` column has no ref to match: its members are SESSIONS, so it is
 *  armed exactly while the staged grammar is running, which is `idle` read the other way. */
function familyArmed(family: DerivedFamily): (ctx: ActionCtx) => boolean {
  if (family.memberSource === "generators") return (ctx) => !idle(ctx);
  return (ctx) => idle(ctx) && armedIndex(family.members, ctx) !== -1;
}

export const TOOL_FAMILIES: readonly ToolFamily[] = FAMILIES.map((family) => ({
  id: family.id,
  name: family.name,
  label: familyLabel(family),
  arm: byId(family.arm),
  cycle: family.cycle === null ? null : byId(family.cycle),
  members: familyMembers(family),
  armed: familyArmed(family),
}));

// --- the gate ---------------------------------------------------------------

/** May a CONTROL for this action run it, and what to say when it may not?
 *
 *  The same {@link gateAction} the keyboard uses, under the `named` caller class (see
 *  {@link GateEnv}) — routed through the one gate rather than re-spelled, because a button
 *  that arms what its own key refuses is the two-surfaces-disagree defect, and the refusal
 *  SENTENCE has to be the same one too.
 *
 *  A MENU-ONLY action (no `gate`) IS runnable from a control, and that is the class's whole
 *  content: the no-gate refusal is a rule about KEYCAPS, and a control has none. The burger
 *  has always run those straight from its items; the rail never had to ask (every family it
 *  renders is keyed); the command palette renders the whole table, half of which is
 *  menu-only, so it does. */
export function clickGate(def: ActionDef, ctx: ActionCtx): GateVerdict {
  return gateAction(def, ctx, NAMED_CALL);
}

/** Whether a CONTROL for this action may run it, and what to say when it may not.
 *
 *  THREE states in two cases, which is why it is a union rather than a string: runnable;
 *  refused WITH a sentence (the gate's); and refused with NOTHING to add. The last is not a
 *  shrug — `enabled` false with the gate open means the verb has nothing to ACT on (the
 *  stamp family over an empty registry, Bake with no world on disk), and those labels
 *  already carry the reason, so a control that invented a second sentence would be
 *  guessing. Every caller shows the control as refused either way; only the wording moves.
 *
 *  A UNION rather than the `string | null` (with `""` for the middle state) it was first
 *  written as, because that shape was already being read two different ways by its only two
 *  callers — one three-way explicit, one truthy, which collapses inert into runnable. Both
 *  happened to be correct; neither was obviously so, and a third caller writing
 *  `if (reason)` to mean "is it refused" gets inert wrong. The discriminant makes that read
 *  unwriteable. */
export type ControlVerdict =
  | { runnable: true }
  | { runnable: false; reason: string | null };

/** {@link ControlVerdict} for this action, right now.
 *
 *  In the registry rather than in each surface because two copies of this three-way is
 *  precisely how a rail button and a palette row come to disagree about one verb. */
export function controlVerdict(def: ActionDef, ctx: ActionCtx): ControlVerdict {
  const verdict = clickGate(def, ctx);
  if (!verdict.ok) return { runnable: false, reason: verdict.hint };
  return def.enabled(ctx)
    ? { runnable: true }
    : { runnable: false, reason: null };
}

/** The one refusal that is about STATE rather than about keys: an action that re-arms what
 *  LMB does cannot run while a session owns the interaction. It binds BOTH caller classes —
 *  a rail button that armed what its own key refuses is the defect the shared gate exists
 *  for — which is why it is the tail of {@link gateAction} rather than a key-only clause. */
function sessionRefusal(def: ActionDef, ctx: ActionCtx): GateVerdict {
  if (def.armsTool === true && ctx.session !== null)
    return {
      ok: false,
      hint: "finish the session first — ⏎ applies it, Esc discards it",
    };
  return { ok: true };
}

/** May this action run right now, for THIS caller? PURE — everything that changes between
 *  renders arrives in `env`, polled at dispatch time by the caller ({@link GateEnv} carries
 *  why the two callers are a union).
 *
 *  Three of the four clauses are about a KEY and say so by living inside the `key` branch:
 *  a menu-only action can never be fired by a keycap it does not have; a `typed` gate is
 *  about a character someone is typing; the fly refusal is about a letter the look drag owns
 *  while the right button is HELD.
 *
 *  The two that bind every caller are the modal suppression (a second `openConfirm` would
 *  strand the first, whose `onCancel` then never runs) and {@link sessionRefusal}. */
export function gateAction(
  def: ActionDef,
  ctx: ActionCtx,
  env: GateEnv,
): GateVerdict {
  if (env.confirmOpen) return { ok: false, hint: null };
  if (env.caller === "key") {
    // A menu-only action has no `match` either, so the dispatcher never reaches it; this
    // refuses it as a backstop, so a binding added without a gate cannot slip through
    // ungated.
    if (def.gate === undefined) return { ok: false, hint: null };
    // A chord is never a character someone is typing; everything else can be.
    if (def.gate === "typed" && env.inTextInput)
      return { ok: false, hint: null };
    // While the right button is down the fly owns its own letters.
    if (def.flyLetter === true && env.looking) return { ok: false, hint: null };
  }
  return sessionRefusal(def, ctx);
}

// --- dispatch ---------------------------------------------------------------

/** The four facts a matcher is allowed to know, read off a DOM event. The ONE translation
 *  in the editor, which is what lets `matchBinding` — and the whole registry behind it —
 *  never name a `KeyboardEvent`. */
export const keyFacts = (e: KeyboardEvent): KeyFacts => ({
  key: e.key,
  mod: e.metaKey || e.ctrlKey,
  shift: e.shiftKey,
  alt: e.altKey,
});

/** The action this event runs, or null. First match wins; the bindings are written so
 *  that no two can claim one event (asserted in `tests/keybindings.test.ts`). */
export function matchAction(e: KeyboardEvent): ActionDef | null {
  const facts = keyFacts(e);
  return (
    ACTIONS.find((a) => a.keys !== undefined && matchBinding(a.keys, facts)) ??
    null
  );
}

/** Say an action's verdict out loud — the funnel's voice, and the whole of it.
 *
 *  ONLY `refused` is spoken. That is the reconciliation stated in {@link ActionResult}'s
 *  module header, read from the speaking end: a `refused` result is the action's OWN verdict
 *  and nobody has said it yet, so this is the sentence that used to be a `notify.error` call
 *  inside the verb (`useWorld`'s bake backstop; `write`'s invalid-name). A `failed` result
 *  came from a layer that owns its own channel and has already said it — the host's
 *  `reportToolError` toast, `world-actions.ts`'s "bake failed: ENOSPC" — and repeating it
 *  would be the doubled toast this rule exists to prevent; the Result carries it to a caller
 *  who is not looking at the screen.
 *
 *  THE ONE `failed` NOBODY BELOW SAID is the one {@link runAction} builds itself out of a
 *  caught throw, and it is voiced AT THE CATCH rather than here — same rule read the other
 *  way round: the funnel says what the funnel owns.
 *
 *  DO NOT PIPE A {@link runAction} RESULT THROUGH THIS. It has already said everything it was
 *  going to say, and the `refused` it returns for a GATE refusal was said through
 *  `sayRefusal` on the way out — so `runNamed(def, ctx).then(sayResult)` would print every
 *  session refusal twice, once quietly and once as an error. The idiom is for a caller of a
 *  verb that ANSWERS but does not dispatch (`WorldActions.save`/`saveAs`/`bake`, whose two
 *  live callers are `WorldDrawer`'s name form and `write`'s own confirm re-entry); everything
 *  that goes through the funnel is already spoken for.
 *
 *  `notify.error` and not `sayRefusal`, deliberately: both sentences it can say were
 *  `notify.error` before this task moved them, and a refusal that used to hold the screen
 *  until dismissed must not quietly become a four-second info toast. The gate's refusals —
 *  the other kind, and the noisy one, since a held key repeats at the OS rate — still go
 *  through `sayRefusal` below, which is where the de-duplication is needed and lives. */
export function sayResult(result: ActionResult): void {
  if (result.ok || result.kind !== "refused") return;
  notify.error(result.message);
}

/** RUN IT: gate, claim, check, do, say. The one funnel every surface dispatches a NAMED
 *  ACTION through; {@link runMember} is its sibling for a family-member pick, which is a
 *  second way into a row rather than a row of its own (that function carries the argument).
 *
 *  `onClaim` fires the instant the gate ALLOWS and before `enabled` is consulted, because at
 *  that point the key has been claimed: a disabled ⌘S must still suppress the browser's
 *  save-page dialog, and a ⌫ over the canvas with nothing selected must still not navigate.
 *  It is the key dispatcher's `preventDefault` seam and nothing else passes one — a REFUSED
 *  action never reaches it, so the character the user is typing still lands in their field.
 *
 *  The INERT case (`enabled` false, gate open) returns a refusal carrying the action's LABEL
 *  and says nothing, which is the existing three-way policy made answerable: those labels
 *  already state the reason on screen ("Bake — name the world first (⌘S)"), so a toast would
 *  be a second wording of a sentence the user is looking at — while a caller who cannot see
 *  the screen gets that same sentence as the message.
 *
 *  A THROW OUT OF A RUN IS SURFACED, NOT THROWN PAST — which is the whole of what `failed`
 *  means. Before this funnel a run that threw took its listener with it (a sync throw out of
 *  the keydown handler; an unhandled rejection once one of them became async), which is
 *  neither visible nor answerable. Caught here it becomes a Result the caller can read AND a
 *  toast, because this is the one `failed` no layer below has said: the funnel says what the
 *  funnel owns. */
export async function runAction(
  def: ActionDef,
  ctx: ActionCtx,
  env: GateEnv,
  input?: ActionInput,
  onClaim?: () => void,
): Promise<ActionResult> {
  const verdict = gateAction(def, ctx, env);
  if (!verdict.ok) {
    // A refusal with a reason the user cannot see gets said out loud; the rest (a modal is
    // open, they are typing, they are holding the right button) are already visible and a
    // toast would be noise. `sayRefusal` also stops a HELD key, which repeats at the OS
    // rate, from stacking one sentence three deep.
    notify.sayRefusal(verdict.hint);
    // THE LABEL AS A FALLBACK IS A T4 PROBLEM, and it is left here rather than guessed at.
    // The three SILENT gate classes carry `hint: null` — a modal is open, the user is typing,
    // the right button is down — and a caller who cannot see the screen still needs a
    // message, so it gets the label. For a human that path is unreachable and the label is
    // never read. For an AGENT it will not be: `NAMED_CALL` hard-codes `confirmOpen: false`
    // today, and the day the daemon answers that honestly an agent's "a modal is open"
    // refusal will read `"Frame selection"`. Whoever wires that answers this.
    return refused(verdict.hint ?? def.label(ctx));
  }
  onClaim?.();
  if (!def.enabled(ctx)) return refused(def.label(ctx));
  try {
    const result = await def.run(ctx, input);
    sayResult(result);
    return result;
  } catch (err) {
    const message = `${def.label(ctx)} failed: ${errorMessage(err)}`;
    notify.error(message);
    return failed(message);
  }
}

/** {@link runAction} for a surface that NAMED the verb — every control in the chrome. */
export function runNamed(
  def: ActionDef,
  ctx: ActionCtx,
  input?: ActionInput,
): Promise<ActionResult> {
  return runAction(def, ctx, NAMED_CALL, input);
}

/** RUN A MEMBER PICK: gate against its FAMILY, do the member's own arm, answer for it.
 *
 *  The second funnel, and what makes {@link runAction}'s *"the one funnel every surface
 *  dispatches through"* literally true — it was not, of exactly this path, until foundations
 *  T4a. The rail's corner flyout and the ⌘K member rows both called the member's `arm` bare:
 *  no gate, no {@link ActionResult}, nothing said.
 *
 *  BOTH SURFACES REFUSE BEFORE THE PICK rather than inside it — the flyout's TRIGGER off the
 *  row's verdict, the palette's member rows through `disabled`, which cmdk skips for the
 *  arrows and for ⏎ — which is why the bypass was filed as a false claim rather than as a bug.
 *  That is not quite the same as saying there was no route: the rail's check is a moment
 *  EARLIER than the pick, so a session pushed onto the host while the flyout stands open
 *  leaves five member buttons whose gate has already been passed, and a bare arm re-armed LMB
 *  under a live session (`tests/chrome/tool-rail.test.tsx` drives exactly that). Rare for a
 *  human and ordinary for an agent, which is the other half: T4's caller has no flyout to be
 *  refused by, and a pick that answers `undefined` is not an answer it can read.
 *
 *  THE GATE IS THE FAMILY'S. Arming a member IS arming the family, so the refusal that stops
 *  `tool.brush` stops Paint — and both surfaces already say so in the code, the palette by
 *  giving every member row `controlVerdict(family.arm, ctx)` and the rail by gating the whole
 *  flyout on the one its row carries. Reading that same three-way here is what keeps the
 *  sentence a pick refuses with identical to the one the family button beside it is showing,
 *  and it is why this needs no row of its own in `ACTION_DESCRIPTORS`: there is no second verb
 *  here, only a second way into one.
 *
 *  {@link controlVerdict} rather than {@link runAction}'s gate-then-`enabled` sequence spelled
 *  a second time. The two are the same behaviour, exactly: `sayRefusal` is a no-op on a null
 *  reason, so the INERT case (`enabled` false, gate open) stays silent here as it does there,
 *  and both hand back the arm action's LABEL as the message a caller who cannot see the screen
 *  gets. One three-way in the editor beats two that have to be kept in agreement.
 *
 *  SYNCHRONOUS, unlike {@link runNamed}, because everything it wraps is: `armMember` pushes a
 *  gesture or an effect at `ctx.run`, and a stamp member calls `host.startStamp`, which
 *  returns `void`. A promise here would be one nothing awaits — both call sites drop the
 *  result — and it would move a pick's own failure onto a later turn for a caller that could
 *  have had it on this one. It is a hand-off either way, so `ok` means what
 *  {@link ActionResult}'s module header says it means: the host answers for itself, later, on
 *  its own channel. The day a member arm becomes async this signature is what has to change,
 *  which is the honest place for that cost to land.
 *
 *  No `onClaim`: that seam is the key dispatcher's `preventDefault`, and no key reaches a
 *  member. The ⇧ chords step families through `tool.brushCycle` and its two siblings, which
 *  are ordinary rows and already funnelled. */
export function runMember(
  family: ToolFamily,
  member: ToolFamilyMember,
  ctx: ActionCtx,
): ActionResult {
  const verdict = controlVerdict(family.arm, ctx);
  if (!verdict.runnable) {
    notify.sayRefusal(verdict.reason);
    return refused(verdict.reason ?? family.arm.label(ctx));
  }
  try {
    member.arm(ctx);
    return ACTION_OK;
  } catch (err) {
    // The MEMBER's label, not the family's: "Paint failed: …" names what was picked, where
    // the family button says "Brush" whichever of its five is on it. Voiced here for
    // `runAction`'s reason — this is the one `failed` no layer below has said.
    const message = `${member.label} failed: ${errorMessage(err)}`;
    notify.error(message);
    return failed(message);
  }
}

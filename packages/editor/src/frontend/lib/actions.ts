// The editor's ONE action registry (D-10/D-11/D-12): every verb the chrome can run,
// declared once, with the key that runs it, the label that names it and the rule that
// refuses it. SIX surfaces read this table — the window key dispatcher
// (`useGlobalKeybindings`), the burger menu, the Help▸Keyboard shortcuts overlay, the top
// bar (Bake and the palette toggle), the status bar's selection chip, and the tool rail
// (through `TOOL_FAMILIES` at the foot of this file) — so a binding cannot be live and
// undocumented, or documented and dead, and no surface works out an enabled state or a
// label of its own. The count was three when this file was written and stayed written down
// as three through F4.5b, which added the last three readers.
//
// WHO OWNS A KEY. There are two keydown listeners in this editor: the field canvas's
// (`viewport-host/field-host.ts`) and this registry's, on `window`. The rule:
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
// away — the standing F2b finding (`field-f2b-gate-ux-findings.md` #6) that a viewport
// binding silently dies the moment the user touches a panel. The window listener has no
// such hole, and it is the only one that consults the gate below.
//
// This module is PURE and DOM-free (`KeyboardEvent` appears as a type only, erased at
// build). It type-imports the host types like every other chrome module — the chrome may
// never VALUE-import anything under `viewport-host/` (machine-enforced by
// `tests/frontend-no-engine-leakage.test.ts`), so every host verb here goes through the
// `FieldHost` instance the context hook reads off `fieldHostRef`.
import type {
  FieldEntityInfo,
  FieldHost,
  FieldStats,
  FieldTool,
  SelectionInfo,
  StampSession,
  ViewportGesture,
} from "../../viewport-host/index.ts"; // type-only: erased
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";
import type { ViewActions, ViewState } from "../hooks/useView.tsx";
import type { WorkspaceActions } from "../hooks/useWorkspace.tsx";
import type { WorldActions } from "../hooks/useWorld.tsx";
// The one VALUE import here, and it stays inside `frontend/lib` — the triad's naming
// function, shared so the gizmo and the menu spell a view once (see AXIS_VIEWS).
import { axisViewLabel } from "./axis-triad.ts";
import type { PaletteId } from "./palette-store.ts";

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
  };
};

/** When an action's key is allowed to fire.
 *
 *  - `chord` — a ⌘/Ctrl chord. Live everywhere, INCLUDING inside a text input, because
 *    the browser default it replaces (save-page, the input's own undo stack) is worse.
 *  - `typed` — a key someone could be TYPING: every bare letter, plus ⌫, Esc and ⏎.
 *    Refused when the focus is in a text input, and nowhere else.
 *
 *  There is deliberately no third class for "refused during a look drag". That refusal
 *  is not a property of being bare — it exists for exactly one reason, a keycap that is
 *  ALSO a fly key, and it is declared per action ({@link ActionDef.flyLetter}). A blanket
 *  class would take `R` and `F` down with it for no collision at all: turning a ghost
 *  while orbiting round it is a normal gesture, and `readFlyMove` reads only w/a/s/d/q/e. */
export type ActionGate = "chord" | "typed";

/** The world OUTSIDE the ctx that the gate reads, all of it polled at DISPATCH time. */
export type GateEnv = {
  /** `isTextInputTarget(e.target)` for this event. */
  inTextInput: boolean;
  /** A modal confirm is open (`confirmRef.current !== null`). */
  confirmOpen: boolean;
  /** The right button is down and driving the camera (`host.isLooking()`). Polled per
   *  keypress and never stored on the ctx: the button goes down and up between renders,
   *  so a snapshot would answer for a frame that has already gone. Only actions marked
   *  {@link ActionDef.flyLetter} care. */
  looking: boolean;
};

/** Whether the key may fire, and what to tell the user when it may not. A `null` hint
 *  means refuse SILENTLY — the reason is already on screen (a modal dialog) or is the
 *  user's own hand (they are typing, they are holding the right button). */
export type GateVerdict = { ok: true } | { ok: false; hint: string | null };

export type ActionDef = {
  /** Stable id, `group.verb`. Unique across the table (asserted). */
  id: string;
  group: ActionGroup;
  /** What to call it on a surface, given the current state — "Delete hall #7", "Undo
   *  dig". Contextual because the menu is where a user checks WHAT a verb will act on. */
  label: (ctx: ActionCtx) => string;
  /** Whether the verb can do anything right now. A disabled action greys its menu item
   *  and swallows its key (the key is still CLAIMED — see the dispatcher). */
  enabled: (ctx: ActionCtx) => boolean;
  /** For the menu's checkbox items (the view toggles). Absent = a plain item. */
  checked?: (ctx: ActionCtx) => boolean;
  /** The chord as the user reads it, in the editor's keycap vocabulary (⌘ ⇧ ⌃ ⌥ ⏎ ⌫).
   *  Absent = menu-only. Unique across the table (asserted). */
  keys?: string;
  /** One sentence for the shortcuts overlay — the CONDITION and the consequence, which a
   *  menu label has no room for. */
  hint?: string;
  /** Does this event run this action? Absent = menu-only, unreachable from the keyboard.
   *  Declared together with `gate` (asserted). */
  match?: (e: KeyboardEvent) => boolean;
  gate?: ActionGate;
  /** This action re-arms what LMB does, so it is refused while a session owns the
   *  interaction — with a hint, because the key looking dead is the failure mode. */
  armsTool?: boolean;
  /** This keycap is ALSO one of the viewport's fly keys (w/a/s/d/q/e — `readFlyMove`),
   *  so the look drag owns it: refused while the right button is down. `S` is the whole
   *  membership today — fly-backward and the stamp family on one key — and the RMB gate
   *  on fly travel is the other half of the same bargain. */
  flyLetter?: boolean;
  /** Per-action data only a MENU needs: the `title` for an item whose reason will not fit
   *  in its label. Here rather than in a lookup beside the menu so there is ONE home for
   *  per-action menu facts, beside `checked`. */
  menuTitle?: string;
  run: (ctx: ActionCtx) => void;
};

/** `world` and `edit` and `view` are the burger's groups; `tool` and `session` are the
 *  keyboard's, and reach the user through the tool rail, the status bar's keymap line and
 *  the shortcuts overlay rather than through a menu. */
export type ActionGroup = "world" | "edit" | "view" | "tool" | "session";

// --- matchers ---------------------------------------------------------------

/** ⌘ on macOS, Ctrl everywhere else. */
const mod = (e: KeyboardEvent): boolean => e.metaKey || e.ctrlKey;

/** A ⌘-chord on `key`, with ⇧ stated rather than assumed — ⌘Z and ⇧⌘Z are two actions,
 *  so neither may match the other's event. ⌥ is excluded throughout: it is the viewport's
 *  eyedropper modifier and (on macOS) rewrites `e.key` anyway. */
const chord = (e: KeyboardEvent, key: string, shift = false): boolean =>
  mod(e) && !e.altKey && e.shiftKey === shift && e.key.toLowerCase() === key;

/** A plain letter with no modifier at all. `toLowerCase` is what makes a CapsLocked or
 *  ⇧-held keyboard produce the same action — except where ⇧ is the binding, below. */
const bare = (e: KeyboardEvent, key: string): boolean =>
  !mod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key;

/** ⇧ + a letter: the family CYCLE half of `B`/`M`/`S`. */
const shifted = (e: KeyboardEvent, key: string): boolean =>
  !mod(e) && !e.altKey && e.shiftKey && e.key.toLowerCase() === key;

// --- families ---------------------------------------------------------------

/** One member of a keyed family: what arming it does, in the binding table's order.
 *  `effect` members arm the brush (and return LMB to it); `gesture` members arm a click
 *  gesture. The brush family has both — `segment` is a gesture that strokes.
 *
 *  `label` is here rather than in the rail because the rail's member flyout and the ⇧
 *  cycle step the SAME list: a second list beside the rail is how "⇧B cycles Dig → Fill"
 *  and what the flyout shows would come to disagree.
 *
 *  `hint` is the per-MEMBER sentence — the registry's own `hint` is family-level ("Arm the
 *  brush family"), and the facts that used to live on `ToolPalette`'s per-button tooltips
 *  ("momentary: hold Ctrl", the 60 m segment cap) had no home after that file was deleted.
 *  This is that home. */
type FamilyMember = { label: string; hint: string } & (
  | { effect: FieldTool["effect"] }
  | { gesture: ViewportGesture }
);

/** The pointer is a family of ONE. Spelled as a family anyway so the rail renders four
 *  things the same way, and so "how many members has it?" is the single question that
 *  decides whether a corner flyout appears. */
const POINTER_FAMILY: readonly FamilyMember[] = [
  {
    label: "Select",
    hint: "click a stamp, a prop or a marker; bare rock deselects",
    gesture: "pointer",
  },
];

const BRUSH_FAMILY: readonly FamilyMember[] = [
  { label: "Dig", hint: "carve air — momentary: hold ⌃", effect: "dig" },
  { label: "Fill", hint: "solidify + write the material", effect: "fill" },
  {
    label: "Paint",
    hint: "retint solid cells — organic classes only",
    effect: "paint",
  },
  {
    label: "Smooth",
    hint: "relax the surface — momentary: hold ⇧",
    effect: "smooth",
  },
  {
    label: "Segment",
    // The 60 m is FieldHost's MAX_SEGMENT_M, RESTATED (that constant's doc names this as
    // the restating site): the chrome cannot value-import anything under `viewport-host/`,
    // so the two agree by review. It was `ToolPalette`'s Segment tooltip until F4.5b Task 8
    // deleted that file, and for one commit the cap had no affordance at all — a user met
    // it only as a post-hoc refusal.
    hint: "two clicks sweep the brush between them — max 60 m; Esc drops the point",
    gesture: "segment",
  },
];

const SELECT_FAMILY: readonly FamilyMember[] = [
  { label: "Box", hint: "two clicks span a snapped region", gesture: "box" },
  {
    label: "Wand",
    hint: "flood-select the clicked material",
    gesture: "material",
  },
  { label: "Room", hint: "flood-select an air pocket", gesture: "void" },
];

/** Which member is armed right now, as an index into `family` — `-1` when none is (the
 *  family is not the armed one). A `gesture` member wins over the brush effect, because
 *  arming `segment` is what LMB is actually doing. */
function armedIndex(family: readonly FamilyMember[], ctx: ActionCtx): number {
  const byGesture = family.findIndex(
    (m) => "gesture" in m && m.gesture === ctx.gesture,
  );
  if (byGesture !== -1) return byGesture;
  // The brush effect only counts while LMB still brushes: under `pointer` or a cell
  // gesture the effect is a remembered setting, not an arm.
  if (ctx.gesture !== null) return -1;
  return family.findIndex((m) => "effect" in m && m.effect === ctx.tool.effect);
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
 *  list is exclusive (the members are Dig | Fill | Paint | Smooth | Segment — one of
 *  them), while `X`'s dig↔fill swap goes through `armBrush` alone and still keeps a live
 *  segment, which is exactly where re-aiming is the point. */
function armMember(member: FamilyMember, ctx: ActionCtx): void {
  if ("gesture" in member) {
    ctx.run.setGesture(member.gesture);
    return;
  }
  ctx.run.armBrush(member.effect);
  // Only `segment` needs saying: every other gesture is already dropped inside
  // `armBrush` (`brushArming.disarmGesture`), and re-pushing a null the host already
  // holds would be a redundant call on every bare-letter press.
  if (ctx.gesture === "segment") ctx.run.setGesture(null);
}

/** Arm the family's CURRENT member — the bare press. With nothing of the family armed it
 *  takes the first, which is what makes one key enough to enter a family. */
function armFamily(family: readonly FamilyMember[], ctx: ActionCtx): void {
  const i = armedIndex(family, ctx);
  const member = family[i === -1 ? 0 : i];
  if (member !== undefined) armMember(member, ctx);
}

/** Step to the next member and arm it — the ⇧ press. Wraps. */
function cycleFamily(family: readonly FamilyMember[], ctx: ActionCtx): void {
  const i = armedIndex(family, ctx);
  const member = family[(i + 1) % family.length];
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

// --- the six axis views (F4.5c Task 5) ---------------------------------------

/** The corner triad's six tips, as registry rows. Generated from one statement of each
 *  axis and each sign rather than written out six times, deliberately: six defs differing
 *  only by two arguments is exactly the shape a copy-paste slip survives in, and a `NegZ`
 *  that passes `+1` reads perfectly in review while sending the camera to the far side of
 *  the world. Here `axis` and `sign` are each named once and flow into the id, the label
 *  and the call together.
 *
 *  WHY THEY EXIST — this is an accessibility remedy, not a convenience. `AxisTriad`'s six
 *  tips are 18 px / 14 px hit targets inside a 64 px box, under WCAG 2.2 SC 2.5.8's 24 px
 *  floor and unfixable at that size (six tips, one box). That SC does not apply to a
 *  control whose function is reachable another way on the same page; these rows are that
 *  other way, so the tips became a redundant affordance the moment this list landed.
 *  Deleting it re-opens the finding — `field-f4-gate-ux-findings.md` §3, and the comment on
 *  those two constants says the same thing from the other end.
 *
 *  NO `keys`, and that is a decision rather than an omission: six chords would be six
 *  claims on a keyboard this editor keeps sparse, and the charter's binding table allocates
 *  none of them. The menu is the route. It follows — and is worth stating, because it reads
 *  like an oversight otherwise — that these six do NOT appear in the shortcuts overlay,
 *  which renders only actions carrying a `keys`. The command palette Task 7 adds reads this
 *  same table and will list them without any of them claiming a keycap.
 *
 *  The labels come from `axisViewLabel`, which is also what each TIP is called. One
 *  spelling, so the gizmo and the menu cannot come to name one view two ways: that drift is
 *  what D-12 exists to prevent, and here it would break the exception above, since two
 *  differently-worded controls are two controls rather than one reachable twice. */
const AXIS_VIEWS: readonly ActionDef[] = (["x", "y", "z"] as const).flatMap(
  (axis) =>
    ([1, -1] as const).map(
      (sign): ActionDef => ({
        id: `view.snap${sign === 1 ? "Pos" : "Neg"}${axis.toUpperCase()}`,
        group: "view",
        label: () => axisViewLabel(axis, sign),
        // Live with no selection and no engine, like `view.frame` beside it: a view verb
        // needs neither, and a row greyed with no visible reason reads as broken.
        enabled: () => true,
        run: (ctx) => ctx.host?.snapView(axis, sign),
      }),
    ),
);

// --- the table --------------------------------------------------------------

export const ACTIONS: readonly ActionDef[] = [
  // ——— world ———————————————————————————————————————————————————————————————
  {
    id: "world.new",
    group: "world",
    label: () => "New",
    // New empties the host's world SYNCHRONOUSLY, so a New landing mid-save writes the
    // freshly-emptied world over the named target.
    enabled: (ctx) => !ctx.world.busy,
    run: (ctx) => ctx.run.world.reset(),
  },
  {
    id: "world.open",
    group: "world",
    label: () => "Open…",
    enabled: () => true,
    run: (ctx) => ctx.run.world.openDrawer("browse"),
  },
  {
    id: "world.save",
    group: "world",
    label: () => "Save",
    enabled: (ctx) => !ctx.world.busy,
    keys: "⌘S",
    hint: "Save the world — an untitled one opens the drawer to be named first",
    match: (e) => chord(e, "s"),
    gate: "chord",
    run: (ctx) => ctx.run.world.save(),
  },
  {
    id: "world.saveAs",
    group: "world",
    label: () => "Save as…",
    enabled: () => true,
    // ⇧⌘S is the platform convention, and binding it here closes a regression as well
    // as adding a shortcut: `world.save` pins `shiftKey === false`, so without this row
    // nothing claims ⇧⌘S — and nothing calls `preventDefault`, which on macOS hands
    // muscle-memory Save As straight to the browser's Save-Page dialog.
    keys: "⇧⌘S",
    hint: "Name a copy — opens the drawer with the name form ready",
    match: (e) => chord(e, "s", true),
    gate: "chord",
    run: (ctx) => ctx.run.world.openDrawer("save-as"),
  },
  {
    id: "world.bake",
    group: "world",
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
  {
    id: "world.makeDefault",
    group: "world",
    label: (ctx) =>
      ctx.world.name === null
        ? "Make default — name the world first (⌘S)"
        : "Make default",
    enabled: (ctx) => ctx.world.name !== null,
    // Shown only when the item is ENABLED (a disabled one has pointer-events-none), which
    // is the case this sentence is for: it distinguishes Make default from Bake, and the
    // label has no room for that.
    menuTitle:
      "point the game at the SAVED copy of this world — Bake if you want the edits in this session to go with it",
    run: (ctx) => {
      const name = ctx.world.name;
      if (name !== null) ctx.run.world.makeDefault(name);
    },
  },

  // ——— edit ————————————————————————————————————————————————————————————————
  {
    id: "edit.undo",
    group: "edit",
    // The field's op log IS the editor's history — there is no second document to step.
    label: (ctx) =>
      ctx.history.undoLabel === null ? "Undo" : `Undo ${ctx.history.undoLabel}`,
    enabled: (ctx) => (ctx.stats?.undoDepth ?? 0) > 0,
    keys: "⌘Z",
    hint: "Undo the last field op — the field's op log is the editor's ONE history",
    match: (e) => chord(e, "z"),
    gate: "chord",
    run: (ctx) => ctx.host?.undo(),
  },
  {
    id: "edit.redo",
    group: "edit",
    label: (ctx) =>
      ctx.history.redoLabel === null ? "Redo" : `Redo ${ctx.history.redoLabel}`,
    enabled: (ctx) => (ctx.stats?.redoDepth ?? 0) > 0,
    keys: "⇧⌘Z",
    hint: "Redo",
    match: (e) => chord(e, "z", true),
    gate: "chord",
    run: (ctx) => ctx.host?.redo(),
  },
  {
    id: "edit.duplicate",
    group: "edit",
    label: (ctx) =>
      ctx.selectedEntity === null
        ? "Duplicate"
        : `Duplicate ${entityName(ctx.selectedEntity)}`,
    enabled: (ctx) => ctx.selectedEntity !== null,
    // ⌘J, not the mock's ⌘D: ⌘D is Safari's Add-bookmark and is not interceptable
    // there (charter §5). ⌘J is Downloads in Chrome, which IS interceptable.
    keys: "⌘J",
    hint: "Duplicate the selected stamp beside itself — a fresh commit from its own recipe",
    match: (e) => chord(e, "j"),
    gate: "chord",
    run: (ctx) => {
      if (ctx.selectedEntity !== null)
        ctx.host?.duplicateEntity(ctx.selectedEntity.entityId);
    },
  },
  {
    id: "edit.delete",
    group: "edit",
    label: (ctx) =>
      ctx.selectedEntity === null
        ? "Delete"
        : `Delete ${entityName(ctx.selectedEntity)}`,
    // Refused during a session: the session may BE the selected entity's reconfigure,
    // and deleting the entity under it cancels the session the user is still editing.
    enabled: (ctx) => ctx.selectedEntity !== null && ctx.session === null,
    keys: "⌫",
    hint: "Delete the selected stamp and the ops it committed, behind a confirm (⌘Z puts it back)",
    match: (e) =>
      !mod(e) &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === "Backspace" || e.key === "Delete"),
    gate: "typed",
    run: (ctx) => {
      const entity = ctx.selectedEntity;
      if (entity === null) return;
      // The same prompt the palette row raises, with the op count in it: a row reads
      // "3 ops" but a scatter reads "1 ops" and takes every prop it placed with it.
      const ops = entity.opSpan[1] - entity.opSpan[0] + 1;
      ctx.run.openConfirm({
        title: `Delete stamp #${entity.entityId}?`,
        message: `Removes ${entity.generator} #${entity.entityId} and the ${ops} op${ops === 1 ? "" : "s"} it committed. Edits made after it are replayed onto what is left, so a dig that cut through this stamp survives as a dig into whatever was underneath. ⌘Z puts it back.`,
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => ctx.host?.deleteEntity(entity.entityId),
      });
    },
  },
  {
    id: "edit.grab",
    group: "edit",
    label: (ctx) =>
      ctx.selectedEntity === null
        ? "Move"
        : `Move ${entityName(ctx.selectedEntity)}`,
    // No session, for `edit.delete`'s reason plus its own: `beginMove` REPLACES the live
    // session, so a G during a reconfigure would discard the params being edited.
    enabled: (ctx) => ctx.selectedEntity !== null && ctx.session === null,
    keys: "G",
    hint: "Grab the selected stamp — the cursor moves its ghost in 0.5 m steps until ⏎ drops it or Esc discards it",
    match: (e) => bare(e, "g"),
    gate: "typed",
    run: (ctx) => {
      if (ctx.selectedEntity !== null)
        ctx.host?.beginMove(ctx.selectedEntity.entityId);
    },
  },
  {
    id: "edit.clearSelection",
    group: "edit",
    label: (ctx) =>
      ctx.selection === null
        ? "Clear selection"
        : `Clear ${ctx.selection.count} selected cell${ctx.selection.count === 1 ? "" : "s"}`,
    // Gated on there BEING one, unlike Esc's ladder: Esc is one key that cancels the
    // most recent thing, so it is never refused, but a named menu item over an empty
    // selection is a verb with no object.
    enabled: (ctx) => ctx.selection !== null,
    // Deliberately NO chord. Esc already clears the cell selection (its ladder's last
    // rung) and a second key for the same verb is a second thing to keep true; this
    // exists so the status chip's popover and the menu can name it.
    menuTitle:
      "drop the cell selection — the ops that were masked by it stop being masked",
    run: (ctx) => ctx.host?.clearSelection(),
  },
  {
    id: "edit.reselect",
    group: "edit",
    label: () => "Reselect",
    // ALWAYS live, and the asymmetry with Clear above is the point: Reselect matters
    // exactly when there is NO selection, because what it restores is what the last
    // Clear (or replace) displaced. The host no-ops on an empty slot.
    enabled: () => true,
    menuTitle: "restore the selection the last Clear or replace displaced",
    run: (ctx) => ctx.host?.reselect(),
  },
  {
    id: "edit.history",
    group: "edit",
    // Named for the surface it opens, and ALWAYS enabled: an empty history is something
    // the palette SAYS ("nothing yet"), not a reason to grey out the way to it. The other
    // disabled items in this menu are gated on a missing INPUT (a world name, a selected
    // stamp, something to step); a summon has none.
    label: () => "History…",
    enabled: () => true,
    menuTitle:
      "the field's ONE history as a list — every step, newest first; click a row to step back to it",
    // Deliberately NO chord. ⌘Y is redo on Windows and would teach the wrong thing here,
    // and every bare letter in the editor is a tool family (D-10). The burger's own
    // palette checkbox is the other way in, and the status bar's `undo N` chip the third.
    run: (ctx) => ctx.run.summonPalette("history"),
  },

  // ——— tool ————————————————————————————————————————————————————————————————
  {
    id: "tool.pointer",
    group: "tool",
    label: () => "Select",
    enabled: () => true,
    keys: "V",
    hint: "Arm Select — click a stamp, a prop or a marker to select it; the wheel travels the camera",
    match: (e) => bare(e, "v"),
    gate: "typed",
    armsTool: true,
    run: (ctx) => ctx.run.setGesture("pointer"),
  },
  {
    id: "tool.brush",
    group: "tool",
    label: () => "Brush",
    enabled: () => true,
    keys: "B",
    hint: "Arm the brush family — press again with ⇧ to cycle Dig → Fill → Paint → Smooth → Segment",
    match: (e) => bare(e, "b"),
    gate: "typed",
    armsTool: true,
    run: (ctx) => armFamily(BRUSH_FAMILY, ctx),
  },
  {
    id: "tool.brushCycle",
    group: "tool",
    label: () => "Next brush",
    enabled: () => true,
    keys: "⇧B",
    hint: "Cycle the brush family: Dig → Fill → Paint → Smooth → Segment",
    match: (e) => shifted(e, "b"),
    gate: "typed",
    armsTool: true,
    run: (ctx) => cycleFamily(BRUSH_FAMILY, ctx),
  },
  {
    id: "tool.select",
    group: "tool",
    label: () => "Cell select",
    enabled: () => true,
    keys: "M",
    hint: "Arm the cell-selection family — press again with ⇧ to cycle Box → Wand → Room",
    match: (e) => bare(e, "m"),
    gate: "typed",
    armsTool: true,
    run: (ctx) => armFamily(SELECT_FAMILY, ctx),
  },
  {
    id: "tool.selectCycle",
    group: "tool",
    label: () => "Next cell select",
    enabled: () => true,
    keys: "⇧M",
    hint: "Cycle the cell-selection family: Box → Wand → Room",
    match: (e) => shifted(e, "m"),
    gate: "typed",
    armsTool: true,
    run: (ctx) => cycleFamily(SELECT_FAMILY, ctx),
  },
  {
    id: "tool.stamp",
    group: "tool",
    label: (ctx) => {
      const member = stampMember(ctx);
      return member === null ? "Stamp" : `Stamp ${member.name}`;
    },
    enabled: (ctx) => ctx.generators.length > 0,
    keys: "S",
    hint: "Open a stamp session for the family's generator — into the current cell selection, or drag a region for it when there is none",
    match: (e) => bare(e, "s"),
    gate: "typed",
    armsTool: true,
    // `S` IS fly-backward. This is the one collision in the table, and the RMB gate on
    // fly travel is the other half of the same bargain.
    flyLetter: true,
    run: (ctx) => {
      const member = stampMember(ctx);
      if (member !== null) ctx.host?.startStamp(member.id);
    },
  },
  {
    id: "tool.stampCycle",
    group: "tool",
    label: () => "Next stamp",
    enabled: (ctx) => ctx.generators.length > 1,
    keys: "⇧S",
    // The ONLY family whose cycle does not also arm, because a stamp has nothing to arm
    // until it is opened: `S` opens a SESSION. The status bar's keymap line names the
    // member this points at, which is what keeps the cursor from being invisible state.
    hint: "Point the S key at the next generator — it opens nothing by itself",
    match: (e) => shifted(e, "s"),
    gate: "typed",
    armsTool: true,
    // ⇧S reaches the same keycap, and ⇧ is the fly BOOST — so it collides too.
    flyLetter: true,
    run: (ctx) => {
      const current = stampMember(ctx);
      if (current === null) return;
      const i = ctx.generators.findIndex((g) => g.id === current.id);
      const next = ctx.generators[(i + 1) % ctx.generators.length];
      if (next !== undefined) ctx.run.setStampCursor(next.id);
    },
  },
  {
    id: "tool.swapEffect",
    group: "tool",
    label: () => "Swap dig ↔ fill",
    enabled: (ctx) => ctx.tool.effect === "dig" || ctx.tool.effect === "fill",
    keys: "X",
    hint: "Swap Dig ↔ Fill and STAY there — ⌃ is the same swap while held",
    match: (e) => bare(e, "x"),
    gate: "typed",
    // The brush is SUSPENDED while a session stands (D-F4.5-7), so a swap there
    // changes only what a click that cannot happen would have done. It joined the
    // `armsTool` set when the suspension landed, which is what the flag has always
    // meant: this key re-arms LMB, and LMB is not the user's right now.
    armsTool: true,
    run: (ctx) => ctx.run.armBrush(ctx.tool.effect === "dig" ? "fill" : "dig"),
  },

  // ——— session —————————————————————————————————————————————————————————————
  {
    id: "session.confirm",
    group: "session",
    label: (ctx) =>
      ctx.session?.moving === true ? "Drop the move" : "Apply session",
    // Live for a MOVE too, and that is load-bearing: `beginMove` does not focus the
    // canvas, so a grab started from the Edit menu or by `G` with a palette control
    // focused has no canvas listener to answer ⏎ — while the status bar advertises
    // "⏎ drop". `confirmSession` is the move-aware verb both keys route through.
    enabled: (ctx) => ctx.session !== null,
    keys: "⏎",
    hint: "Commit the ready ghost, apply a reconfigure, or drop a grab",
    match: (e) => !mod(e) && !e.altKey && e.key === "Enter",
    gate: "typed",
    run: (ctx) => ctx.host?.confirmSession(),
  },
  {
    id: "session.rotate",
    group: "session",
    label: () => "Rotate a quarter turn",
    enabled: (ctx) => ctx.session !== null,
    keys: "R",
    hint: "Quarter-turn the live ghost — refused, with a reason, on a generator that has no rotation",
    match: (e) => bare(e, "r"),
    gate: "typed",
    run: (ctx) => ctx.host?.rotateStamp(),
  },
  {
    id: "session.escape",
    group: "session",
    label: () => "Cancel",
    // Never disabled: the ladder decides what there is to cancel, and an Esc with
    // nothing to cancel is a no-op rather than a refusal.
    enabled: () => true,
    keys: "Esc",
    hint: "Cancel one thing, most recent first: a half-drawn region, then the live session, then the selected stamp, then the cell selection",
    match: (e) => !mod(e) && !e.altKey && e.key === "Escape",
    gate: "typed",
    run: (ctx) => ctx.host?.escape(),
  },

  // ——— view ————————————————————————————————————————————————————————————————
  {
    id: "view.frame",
    group: "view",
    label: () => "Frame selection",
    // The host reports "nothing to frame" itself, so this stays live with neither
    // selection: a key that swallows the press and says nothing reads as broken.
    enabled: () => true,
    keys: "F",
    hint: "Frame what is selected — the selected stamp, else the cell selection; with neither it says so",
    match: (e) => bare(e, "f"),
    gate: "typed",
    run: (ctx) => ctx.host?.frameSelection(),
  },
  // HERE, between the other camera verb and the display toggles, because the burger renders
  // a group in table order: seven camera rows then read as one run, where appending them
  // would file six of them behind two workspace verbs. FLAT rather than behind a submenu —
  // this group is the ACCESSIBLE route to a control too small to click reliably, and one
  // hover-intent step deeper would make the alternative harder to reach than the thing it
  // stands in for. Eleven rows is a long group; the command palette, not a submenu, is what
  // makes it short again.
  ...AXIS_VIEWS,
  {
    id: "view.normals",
    group: "view",
    label: () => "Normals shading",
    enabled: () => true,
    checked: (ctx) => ctx.view.shading === "normals",
    run: (ctx) =>
      ctx.run.view.setShading(
        ctx.view.shading === "normals" ? "studio" : "normals",
      ),
  },
  {
    id: "view.grid",
    group: "view",
    label: () => "Grid",
    enabled: () => true,
    checked: (ctx) => ctx.view.layers.grid,
    run: (ctx) =>
      ctx.run.view.setLayers({
        ...ctx.view.layers,
        grid: !ctx.view.layers.grid,
      }),
  },
  {
    id: "view.togglePalettes",
    group: "view",
    label: (ctx) => (ctx.workspace.hidden ? "Show palettes" : "Hide palettes"),
    enabled: () => true,
    keys: "⌘\\",
    hint: "Hide every palette, or restore the exact arrangement",
    // Through `chord` like every other ⌘-binding rather than hand-rolled, so ⇧ means the
    // same thing across the whole table: a hand-rolled matcher here is what let ⇧⌘\
    // toggle palettes while ⇧⌘S did nothing at all. Matched on `key`, not `code`: on a
    // layout where `\` is not its own physical key the code would be wrong, whereas the
    // key is whatever the user actually produced. UNVERIFIED in Safari — that ⌘\ arrives
    // as `key === "\\"` is the standard reading, not something measured here; if the
    // browser gate finds it silent, an `e.code === "Backslash"` fallback is the fix.
    match: (e) => chord(e, "\\"),
    gate: "chord",
    run: (ctx) => ctx.run.workspace.toggleHidden(),
  },
  {
    id: "view.resetWorkspace",
    group: "view",
    label: () => "Reset workspace",
    enabled: () => true,
    run: (ctx) => ctx.run.workspace.reset(),
  },
];

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
  arm: (ctx: ActionCtx) => void;
};

/** A rail column entry: one family, its arming action, and its members.
 *
 *  The rail does not re-implement any of this — it renders `TOOL_FAMILIES` and dispatches
 *  `arm.run`, so a click and the family's key are the same code path. That is what stops
 *  the rail and the keyboard from meaning different things, which is the defect class this
 *  slice has closed four times. */
export type ToolFamily = {
  id: "pointer" | "brush" | "select" | "stamp";
  /** The family's STABLE name, for surfaces that name the set rather than the press —
   *  the rail's member flyout. Distinct from `arm.label`, which is contextual and may
   *  name a MEMBER ("Stamp Hall"): a flyout headed "Stamp Hall tools" would be named
   *  after one of the things it lists. */
  name: string;
  /** What the family button is called RIGHT NOW.
   *
   *  Separate from `arm.label` because the two answer different questions once a session is
   *  live. `arm.label` names what pressing the KEY would do, and for `tool.stamp` that is
   *  `stampMember(ctx)` — the ⇧S cursor, which is independent of any live session. The rail
   *  is showing the family as PRESSED at that moment, so it must name what is pressed: with
   *  a `maze` reconfigure standing and the cursor still on `hall`, `arm.label` says "Stamp
   *  Hall" while the session strip six inches away says `maze #3`. D-8's arming channel
   *  lying about the state D-7 exists for. */
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

/** The action with this id. Resolved at module init and THROWS on a miss, so an id
 *  renamed in the table above cannot leave a rail button wired to nothing — the editor
 *  fails to import rather than shipping a dead column. */
function byId(id: string): ActionDef {
  const def = ACTIONS.find((a) => a.id === id);
  if (def === undefined) throw new Error(`actions: no action "${id}"`);
  return def;
}

/** Turn a static family into resolved members. `armed` comes from the same `armedIndex`
 *  the ⇧ cycle uses, so the flyout's tick and the cycle's starting point are one answer. */
const staticMembers =
  (family: readonly FamilyMember[]) =>
  (ctx: ActionCtx): readonly ToolFamilyMember[] => {
    const i = armedIndex(family, ctx);
    return family.map((m, index) => ({
      id: m.label,
      label: m.label,
      hint: m.hint,
      armed: index === i && idle(ctx),
      arm: (c: ActionCtx) => armMember(m, c),
    }));
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

export const TOOL_FAMILIES: readonly ToolFamily[] = [
  {
    id: "pointer",
    name: "Select",
    label: (ctx) => byId("tool.pointer").label(ctx),
    arm: byId("tool.pointer"),
    cycle: null,
    members: staticMembers(POINTER_FAMILY),
    armed: (ctx) => idle(ctx) && ctx.gesture === "pointer",
  },
  {
    id: "brush",
    name: "Brush",
    label: (ctx) => byId("tool.brush").label(ctx),
    arm: byId("tool.brush"),
    cycle: byId("tool.brushCycle"),
    members: staticMembers(BRUSH_FAMILY),
    // `armedIndex` is the whole rule: the brush counts as armed with LMB on the stroke
    // (gesture null) and under `segment`, whose click commits a brush op.
    armed: (ctx) => idle(ctx) && armedIndex(BRUSH_FAMILY, ctx) !== -1,
  },
  {
    id: "select",
    name: "Cell select",
    label: (ctx) => byId("tool.select").label(ctx),
    arm: byId("tool.select"),
    cycle: byId("tool.selectCycle"),
    members: staticMembers(SELECT_FAMILY),
    armed: (ctx) => idle(ctx) && armedIndex(SELECT_FAMILY, ctx) !== -1,
  },
  {
    id: "stamp",
    name: "Stamp",
    // The one family whose rail label is NOT its action's. While a session stands this
    // family reads as pressed (a session IS the staged grammar running, D-7), so it has to
    // name the generator the SESSION is on — `tool.stamp`'s own label names the ⇧S cursor,
    // which the session does not move. A `maze` reconfigure under a `hall` cursor made the
    // rail say "Stamp Hall" beside a session strip saying `maze #3`.
    label: (ctx) => {
      // The ARM first, then the session, then the cursor. A pending arm and a live
      // session cannot both stand (opening one clears the other), so the order is a
      // fallback chain rather than a priority: name whichever is running, and the
      // cursor only when nothing is.
      if (ctx.pendingStamp !== null) return `Stamp ${ctx.pendingStamp.name}`;
      const live = ctx.session;
      if (live === null) return byId("tool.stamp").label(ctx);
      const def = ctx.generators.find((g) => g.id === live.generator);
      return `Stamp ${def?.name ?? live.generator}`;
    },
    arm: byId("tool.stamp"),
    // ⇧S POINTS the S key at the next generator without opening anything, so it is a
    // cursor move rather than an arm — but it is still this family's cycle chord, and
    // naming it here is what lets the rail annotate the flyout with it.
    cycle: byId("tool.stampCycle"),
    // The registry generators, straight through: a stamp "member" is a generator, and
    // picking one OPENS a session rather than arming a mode.
    members: (ctx) =>
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
      })),
    armed: (ctx) => !idle(ctx),
  },
];

/** May a CLICK on this action's control run it, and what to say when it may not?
 *
 *  The same {@link gateAction} the keyboard uses, with the env a pointer click pins by
 *  construction: a click lands on the control (never inside a text input), a modal confirm
 *  covers the surface it would land on, and the fly gate is about a HELD right button
 *  while this is a left-button press. Routed through the one gate rather than re-spelled,
 *  because a button that arms what its own key refuses is the two-surfaces-disagree defect
 *  — and the refusal SENTENCE has to be the same one too. */
export function clickGate(def: ActionDef, ctx: ActionCtx): GateVerdict {
  return gateAction(def, ctx, {
    inTextInput: false,
    confirmOpen: false,
    looking: false,
  });
}

/** May this action's key fire right now? PURE — everything that changes between renders
 *  arrives in `env`, polled at dispatch time by the caller.
 *
 *  A menu-only action (no `gate`) can never fire: it has no `match` either, so the
 *  dispatcher never reaches it, and this refuses it as a backstop. */
export function gateAction(
  def: ActionDef,
  ctx: ActionCtx,
  env: GateEnv,
): GateVerdict {
  // A confirm is MODAL, and it suppresses every class: a second openConfirm would strand
  // the first, whose onCancel then never runs.
  if (env.confirmOpen) return { ok: false, hint: null };
  if (def.gate === undefined) return { ok: false, hint: null };
  // A chord is never a character someone is typing; everything else can be.
  if (def.gate === "typed" && env.inTextInput) return { ok: false, hint: null };
  // While the right button is down the fly owns its own letters.
  if (def.flyLetter === true && env.looking) return { ok: false, hint: null };
  if (def.armsTool === true && ctx.session !== null)
    return {
      ok: false,
      hint: "finish the session first — ⏎ applies it, Esc discards it",
    };
  return { ok: true };
}

/** The action this event runs, or null. First match wins; the matchers are written so
 *  that no two can claim one event (asserted in `tests/keybindings.test.ts`). */
export function matchAction(e: KeyboardEvent): ActionDef | null {
  return ACTIONS.find((a) => a.match?.(e) === true) ?? null;
}

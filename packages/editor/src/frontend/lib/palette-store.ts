// The palette arrangement, as pure data: where each floating palette sits, whether it
// is rolled up or closed, and whether the whole layer is latched away by ⌘\.
//
// PURE on purpose — no DOM, no persistence, no React. The cell's size is the one fact
// this module cannot know, so it arrives as an argument (`OriginBounds`); the layer
// component owns measuring it, owns the debounced write, and owns nothing else.
// Everything here is a value→value function, which is what makes the geometry rules
// (clamp, snap, what survives a hide) testable without a browser.
import type { PaletteState, UiState } from "./persist.ts";

/** Every palette the cockpit knows, in rail order. The union is closed on purpose: a
 *  persisted record for an id that is not here is dropped rather than restored, so a
 *  palette that gets renamed or retired cannot come back as dead geometry.
 *
 *  `controls` is the first id to actually exercise that rule. It held the FieldPanel
 *  control stack until F4.5b dissolved the panel's last organ into palettes and surfaces
 *  of their own; a blob written by any build before then still carries a `controls`
 *  record, and `deserializeWorkspace` drops it on the floor. Nothing needs to migrate the
 *  stored shape — which is the whole reason the union is closed here rather than inferred
 *  from whatever the blob happens to contain. */
export const PALETTE_IDS = [
  "entities",
  "session",
  "flags",
  "history",
  "log",
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

/** Where a palette starts before the user has moved it, what it is called, and whether
 *  its OPEN state belongs to the user at all.
 *
 *  `log` starts CLOSED, which used to be the difference between it and every other
 *  palette: it is summoned (the status bar's ⚠ chip, the View menu) rather than always-on,
 *  so an editor that has had nothing to say never spends screen on saying so. `history`
 *  is the second of that kind (the status bar's `undo N` chip, the Edit menu): the named
 *  Undo/Redo items carry the last step already, and the visible LIST is what you go
 *  looking for rather than what you keep open.
 *
 *  `session` starts closed too, but for a DIFFERENT reason, and the difference is what
 *  `drivenOpen` records: the session card is not normally summoned. It appears when there
 *  is a session or a selected entity for it to be about and leaves when there is not
 *  (D-13), which makes its open state a fact about the editor rather than a decision the
 *  user made — the one exception to D-3's "the arrangement is the user's".
 *
 *  ONE deliberate hole in that, and it is worth naming rather than pretending away:
 *  `BurgerMenu` maps `PALETTE_IDS`, so this palette has a user checkbox like every other
 *  one. It is KEPT, because the card's × closes it and the driver will not re-open it for
 *  the same subject — without the menu item that close is a latch with no exit. The cost is
 *  that the card can be ticked open with nothing to be about, where it shows a placeholder
 *  that STANDS until the next subject change. `drivenOpen` therefore means "not persisted,
 *  and normally not user-set", not "unreachable by the user".
 *
 *  THE ARRANGEMENT IS THREE COLUMNS, and it is arithmetic rather than taste. At the design
 *  floor (see `DESIGN_FLOOR_CELL`, 1235 px of cell) three palette-widths fit side by side:
 *  x = 24 (entities, 360 wide), x = 420 (the session card, 280) and x = 720 (history, 240,
 *  ending at 960). Four palettes must not collide, so exactly ONE column stacks — the left
 *  one, entities over flags — and that stack is what `entities.maxHeight` pays for. The two
 *  gate riders are those two facts: R21 was a long entity list growing through the flags
 *  palette below it (paid by the extent), R27 was the summoned History palette landing on
 *  the live session card (paid by moving it out of the card's column entirely, because the
 *  card's height is a form with an expanding section and any proof that assumed it would be
 *  a guess). `tests/palette-store.test.ts` checks all ten pairs, not these two.
 *
 *  Nothing docks by default, and no default claims the RIGHT edge: `controls` was the one
 *  that did, and it retired with the panel it held. Past history's 960 the cell is clear,
 *  which leaves the top-right corner to the axis triad (64 px inset 8 from both edges) and
 *  the strip a right-handed user orbits in unclaimed until they put something there. The
 *  bottom-left belongs to the collapsed-chip rail (see PaletteLayer). */
export const PALETTES: Record<
  PaletteId,
  {
    title: string;
    default: PaletteState;
    /** How wide this palette renders, in px — the layer's inline width, the projection's
     *  `maxX`, and the rect the default-arrangement check reasons about, all from here.
     *  ONE number rather than a Tailwind class, because a `w-[360px]` is a number in
     *  disguise that only CSS can read, and half of this module's job is arithmetic on it.
     *
     *  Every figure is set by the WIDEST row that palette must render without truncating;
     *  each one carries its own argument below. */
    width: number;
    /** How far down this palette may grow, in px — `undefined` for one that may run to the
     *  bottom of the cell.
     *
     *  A BUDGET, not a measurement, and the layer enforces it (`max-height`, so the body
     *  scrolls past it). It exists because the default arrangement has to be PROVABLE: at
     *  the design floor there are three columns and four palettes that must not collide, so
     *  one column stacks two of them — and a stack cannot be proven clear when the upper
     *  palette's height is whatever its content happens to be. The budget is the upper
     *  one's half of that proof; see `tests/palette-store.test.ts`. */
    maxHeight?: number;
    /** This palette's default DELIBERATELY lands on another palette's, and the pairwise
     *  check is told so here rather than in the check. A declaration, not a suppression:
     *  it sits beside the default it excuses, and a palette added later inherits nothing
     *  — it has to clear everything or argue for its own line. */
    sharesCornerWith?: PaletteId;
    /** This palette's `open` is DRIVEN by the editor, so it is neither persisted nor
     *  restored — `deserializeWorkspace` forces it back to the default above. Everything
     *  else about it (where it sits, whether it is docked or rolled up) is still the
     *  user's, which is exactly D-13's "permanence is a docking choice". */
    drivenOpen?: true;
  }
> = {
  entities: {
    title: "Entities",
    // Free-floating top-left, and OPEN: the committed-stamp list is the reference
    // surface for everything the dig loop produces, so it ships visible. Its section
    // starts collapsed (EntitiesList's own default), so an empty world spends one
    // header row on it rather than a column.
    default: { x: 24, y: 24, edge: null, collapsed: false, open: true },
    // A row is a monospace summary (`scatter · seed 9 · 1 ops · rock · 24 placed`)
    // followed by three verbs, and at 300 px the summary truncated before it reached
    // what the stamp actually placed.
    width: 360,
    // THE ONE STACK in the arrangement, and this is its upper half. A world with fifty
    // stamps would otherwise grow this list straight through the flags palette at y = 380
    // — the gate saw exactly that (R21). 320 px is the palette header, the section header
    // and ten rows; past that the list scrolls inside its own box, which is what a
    // reference surface should do anyway.
    //
    // It applies WHEREVER the user drags this palette, not only at its default, because a
    // cap that switched itself off once the palette moved would be a rule nobody could
    // predict. The cost is honest: on a tall screen this list shows ten rows and scrolls
    // where it could have shown twenty. The day palettes can be resized, this becomes the
    // initial height instead of a ceiling.
    maxHeight: 320,
  },
  session: {
    title: "Session",
    // FLOATING, and closed. Floating because D-13 makes permanence a docking choice the
    // user makes rather than a panel class we assign; closed because there is nothing to
    // configure until something is selected or a session opens.
    //
    // `y: 56` clears the 40 px top bar with a gutter (the mock's own figure). `x: 420`
    // clears the entities palette, which floats at x = 24 in a 360 px box — the card is
    // the surface a user reads WHILE looking at the entity list, so overlapping the two
    // by default would make the first drag mandatory.
    default: { x: 420, y: 56, edge: null, collapsed: false, open: false },
    // The mock's card is a 264 px form; 280 px is that plus the palette's own 8 px of
    // padding either side. Narrower than every other palette on purpose — it is a
    // label-column form, not a list, and a wide one puts the labels a long way from the
    // values they name.
    width: 280,
    drivenOpen: true,
  },
  flags: {
    title: "Flags",
    // Free-floating and OPEN, unlike the two SUMMONED palettes below it, and the
    // difference is who starts the conversation: the advisor runs on its own, so its
    // findings are the one thing on screen nobody asked for. A palette you have to
    // go looking for is one that never gets read, and it costs nothing on a clean
    // world — an empty list is a header line and one sentence.
    //
    // Below the entities palette in the same left column (that one floats at (24, 24)):
    // the two are the REFERENCE surfaces — what the world contains, and what is wrong with
    // it — and they are read together. y = 380 is 36 px below where the entities list is
    // allowed to stop growing; the gutter is what the eye reads as two surfaces rather
    // than one seam.
    default: { x: 24, y: 380, edge: null, collapsed: false, open: true },
    // Between the entities list and the history: a row is a mono locator
    // (`narrow ×3 @ (2.5, 0.0, -8.0)`) plus a verdict chip plus a verb, and at 240 px the
    // locator truncated before its Z coordinate — which is the coordinate that tells two
    // findings in the same corridor apart.
    width: 320,
  },
  history: {
    title: "History",
    // THE THIRD COLUMN, and the reason it exists. This used to sit at (420, 360), under
    // the session card in the card's own column — and the F4.5b machine smoke caught it
    // landing ON the card's door rows (R27). The card is a form whose Advanced section
    // expands, so no y below it is safe; the fix is to stop sharing the column at all.
    // 720 clears the card's right edge (420 + 280) by 20 px, and 720 + 240 = 960 leaves
    // the triad's corner and the whole strip past it alone.
    //
    // A DEPARTURE, and worth naming as one: the F4.5c plan put this in the LEFT column
    // under entities. That column cannot hold three — entities' extent already reaches
    // y = 344 and flags starts at 380, so a third would need an extent of its own invented
    // for it, and the arrangement would rest on two budgets instead of one. A column of its
    // own needs none, which is why it is the stronger answer rather than merely a different
    // one.
    //
    // y = 56 rather than 24, so it lines up with the card it is read alongside: the two
    // answer different questions at different moments (what a stamp IS, versus what has
    // been done) and belong on one eye line.
    default: { x: 720, y: 56, edge: null, collapsed: false, open: false },
    // The narrowest of the five, and it can be: a row is a mono index and a two-word
    // phrase ("segment fill", "reconfigure Hall"), with nothing to the right of it.
    width: 240,
  },
  log: {
    title: "Messages",
    // Deliberately the SAME corner as entities: the log is summoned, transient and
    // rarely wanted at the same moment as the entity list, and a summon that lands
    // somewhere visible beats one tucked into whatever corner is still free.
    //
    // Sharing the corner rests on TWO mechanisms, and it is worth naming both because
    // either one alone leaves a hole. (1) Every summon raises: the ⚠ chip and the View
    // menu call `raise` unconditionally — not merely on the open transition, because the
    // log is very often already open and just buried. (2) The log only marks messages
    // READ while it is topmost (LogPalette's VisibilityProbe), so a log that ends up
    // under this palette anyway keeps the ⚠ chip lit instead of swallowing the errors
    // behind it. Dragging either aside is the answer for a user who wants both at once.
    default: { x: 24, y: 24, edge: null, collapsed: false, open: false },
    // The widest of the five: log lines are sentences (a save path, an esbuild
    // diagnostic), and a narrow box turns every one of them into four wrapped rows.
    width: 380,
    // It shares a corner with `entities`, so it inherits that palette's extent for the
    // same reason: the flags palette is below both of them, and a long error log growing
    // through it would be R21 again through the other door.
    maxHeight: 320,
    sharesCornerWith: "entities",
  },
};

/** The smallest cell the shipped defaults are chosen against, in px, and the premise the
 *  pairwise non-overlap case is asserted at.
 *
 *  A 1280×800 window minus the chrome that is never not there (`Shell`): the 40 px top bar
 *  and its border, the 28 px status bar and its border, the 44 px tool rail and its border.
 *  A DESIGN PREMISE rather than a measurement — the layer measures the real cell at
 *  runtime and the projection below uses that. It lives here because the defaults are
 *  chosen against it, and a premise kept anywhere else is one nobody re-checks when a bar
 *  changes height. */
export const DESIGN_FLOOR_CELL = {
  width: 1280 - (44 + 1),
  height: 800 - (40 + 1) - (28 + 1),
} as const;

/** How much of a palette's top edge must stay inside the cell for its grip to be grabbable
 *  — the header's full height: a 20 px control, `py-1.5` either side, and the 1 px bottom
 *  border. The projection's Y bound, and deliberately weaker than the drag's: a drag knows
 *  the palette's measured height and can keep the WHOLE box in, while the projection runs
 *  without measuring anything and can only promise the handle.
 *
 *  Exported because the default-arrangement check needs it for the same reason the
 *  projection does — a palette with less than this inside the cell is not reachable, so it
 *  is the floor on an unbounded default's height as well. */
export const GRIP_REACH_PX = 20 + 6 + 6 + 1;

/** The cell as the layer measured it. */
export type CellSize = { width: number; height: number };

/** How close (px) a dragged palette's edge must come to the cell's edge to dock there.
 *  24 px is roughly a coarse pointer's slop — close enough that "shove it to the side"
 *  docks, far enough that a deliberate placement 30 px off the edge stays put. */
export const SNAP_PX = 24;

/** The live arrangement. `hidden` is the ⌘\ latch and deliberately does NOT touch the
 *  per-palette records — see `setPalettesHidden`. */
export type WorkspaceState = {
  palettes: Record<PaletteId, PaletteState>;
  hidden: boolean;
};

/** The box a palette's top-left ORIGIN may occupy: the cell's size minus the palette's
 *  own measured size, so `maxX` IS the right-docked position. Both maxima go negative
 *  when the palette is bigger than the cell, which the clamp handles by pinning to 0. */
export type OriginBounds = { maxX: number; maxY: number };

/** The default arrangement — also what Reset Workspace restores. Returns FRESH records
 *  every call (the result goes straight into React state; a shared record would let a
 *  later drag rewrite the defaults). */
export function defaultWorkspace(): WorkspaceState {
  // Written out rather than built from PALETTE_IDS: `Record<PaletteId, …>` makes the
  // compiler demand a line here for every palette added to the union, which is the
  // cheapest possible reminder that a new palette needs a default.
  return {
    palettes: {
      entities: { ...PALETTES.entities.default },
      session: { ...PALETTES.session.default },
      flags: { ...PALETTES.flags.default },
      history: { ...PALETTES.history.default },
      log: { ...PALETTES.log.default },
    },
    hidden: false,
  };
}

const clamp = (v: number, max: number): number => Math.max(0, Math.min(v, max));

/** Which edge a clamped origin has landed against, `null` if it is in open water. The
 *  NEARER edge wins when both gutters overlap (a palette nearly as wide as the cell),
 *  ties to the left — decided, rather than whichever comparison happens to run first. */
function edgeAt(x: number, maxX: number): PaletteState["edge"] {
  const toLeft = x;
  const toRight = maxX - x;
  if (toLeft > SNAP_PX && toRight > SNAP_PX) return null;
  return toLeft <= toRight ? "left" : "right";
}

function withPalette(
  state: WorkspaceState,
  id: PaletteId,
  next: PaletteState,
): WorkspaceState {
  return { ...state, palettes: { ...state.palettes, [id]: next } };
}

/** Place a palette's origin at `pos`, clamped into `bounds` and docked if it lands in
 *  an edge gutter. Docking pins x to the edge AND records it, and `edge` adds the one
 *  thing a coordinate cannot: that a later resize should keep it on that edge (the
 *  renderer places a docked palette FROM the edge and ignores `x` until it un-docks).
 *  Dragging out of the gutter un-docks.
 *
 *  Returns the SAME state when nothing about the placement changed. A drag along a
 *  clamped edge produces a move per pointer event that all resolve to one position;
 *  without this React re-renders and the persist debounce re-arms on every one of them. */
export function movePalette(
  state: WorkspaceState,
  id: PaletteId,
  pos: { x: number; y: number },
  bounds: OriginBounds,
): WorkspaceState {
  const y = clamp(pos.y, bounds.maxY);
  const clampedX = clamp(pos.x, bounds.maxX);
  const edge = edgeAt(clampedX, bounds.maxX);
  const snapped = { left: 0, right: bounds.maxX };
  const x = edge === null ? clampedX : clamp(snapped[edge], bounds.maxX);
  const geom = state.palettes[id];
  if (geom.x === x && geom.y === y && geom.edge === edge) return state;
  return withPalette(state, id, { ...geom, x, y, edge });
}

/** Step a palette by a delta — the keyboard's half of D-26, so a palette can be moved
 *  without a pointer.
 *
 *  It is `movePalette` with the origin worked out first, and that is the whole of it: the
 *  clamp, the edge snap and the identity return are the DRAG's, not a second set. A
 *  keyboard that could reach placements a pointer cannot (or vice versa) would be two
 *  geometries to keep in agreement.
 *
 *  The origin has to be resolved rather than read, because `geom.x` is the one field on the
 *  record that can disagree with the screen: a docked palette is placed FROM its edge, so
 *  after a resize its stored x is wherever the edge used to be. `clampToCell` answers
 *  "where is it now", which is what a step has to start from. */
export function nudgePalette(
  state: WorkspaceState,
  id: PaletteId,
  delta: { dx: number; dy: number },
  bounds: OriginBounds,
): WorkspaceState {
  const geom = state.palettes[id];
  const from = clampToCell(geom, bounds);
  return movePalette(
    state,
    id,
    { x: from.x + departing(geom.edge, delta.dx), y: from.y + delta.dy },
    bounds,
  );
}

/** A step that LEAVES a dock, enlarged to clear the snap gutter.
 *
 *  The one place the keyboard cannot simply inherit the drag's geometry, and it is a
 *  difference in kind rather than a second rule: crossing a 24 px gutter is one gesture for
 *  a pointer and impossible for an 8 px step, which re-snaps to the edge it started on and
 *  returns the identical state — a permanent no-op with not even a re-render to hint at it.
 *  The ARRIVAL stays exactly the drag's (a step into the gutter docks, `edgeAt` decides);
 *  only the departure is enlarged, only on the axis that has edges, and only in the
 *  direction that leaves. A step toward the edge, a free palette, and the Y axis all keep
 *  their own size.
 *
 *  `SNAP_PX + 1` rather than something roomier: the smallest departure that IS one, so the
 *  keyboard still lands where a pointer could and no placement becomes keyboard-only. */
function departing(edge: PaletteState["edge"], dx: number): number {
  if (edge === null || dx === 0) return dx;
  const leaving = edge === "left" ? dx > 0 : dx < 0;
  if (!leaving) return dx;
  return Math.sign(dx) * Math.max(Math.abs(dx), SNAP_PX + 1);
}

/** The origin bounds the LAYER projects against: the cell minus this palette's declared
 *  width, and minus one grip's worth of height.
 *
 *  Asymmetric on purpose. The width is declared (this module owns it and the layer renders
 *  it), so x gets the drag's own rule — the whole box stays in. The height is content, and
 *  the projection runs on every render without measuring anything, so the strongest honest
 *  promise on that axis is that the header is still there to grab.
 *
 *  FOUR rules decide where a palette may be, and this is the invariant that keeps them
 *  agreeing. `movePalette` clamps a drag, `clampToCell` clamps the projection, this
 *  function derives the projection's bounds, and `PaletteLayer.measureBounds` derives the
 *  drag's. The two derivations differ on BOTH axes: the drag measures the palette, this one
 *  declares its width and gives the Y axis a grip instead of a height. On x they agree
 *  exactly, because the declared width IS the rendered width (`box-sizing: border-box`). On
 *  y they do not, and the thing that stops the difference from being visible is
 *  `Palette.placement`'s `calc(100% - y)` height cap on the SHOWN y: it is what keeps a
 *  projected palette inside the cell it was projected into, so the drag's own maxY is never
 *  smaller than where the projection put it. Remove that cap and the first arrow press
 *  after a shrink re-measures a palette that is taller than the cell and teleports it. */
export function cellBounds(cell: CellSize, id: PaletteId): OriginBounds {
  return {
    maxX: cell.width - PALETTES[id].width,
    maxY: cell.height - GRIP_REACH_PX,
  };
}

/** Where a stored geometry is actually SHOWN in a cell this size — a projection, applied
 *  at render, that leaves the record alone.
 *
 *  This is the F4.5a rider's answer, and the mutate-vs-project decision is the interesting
 *  half of it. A window that shrinks (or a blob restored into a smaller window than it was
 *  written in) leaves a palette outside the cell with no grip to grab. Clamping the STATE
 *  would fix that and lose the user's position permanently — a shrink they undo a second
 *  later, a devtools pane, a display change, and the arrangement is silently rewritten to
 *  wherever the smallest window of the session forced it. Worse here than in general: every
 *  write to this store also marks the arrangement "touched", which persists it and vetoes
 *  the restore that may not have arrived yet — so a resize would overwrite a saved
 *  arrangement the user never touched. Projecting keeps the record as intent and the
 *  clamp as presentation, and growing the window back brings the palette back with it.
 *
 *  Returns the SAME record when nothing moved: the layer projects per render, so a fresh
 *  object every time would defeat every memo downstream.
 *
 *  A docked palette re-derives x from its EDGE and keeps that edge. Running the record
 *  through `movePalette` instead would re-read the edge off the projected x and un-dock the
 *  palette the moment the window grew past the snap gutter. */
export function clampToCell(
  geom: PaletteState,
  bounds: OriginBounds,
): PaletteState {
  const docked = { left: 0, right: Math.max(0, bounds.maxX) };
  const x = geom.edge === null ? clamp(geom.x, bounds.maxX) : docked[geom.edge];
  const y = clamp(geom.y, bounds.maxY);
  if (x === geom.x && y === geom.y) return geom;
  return { ...geom, x, y };
}

/** Roll the palette up to a rail chip, or back down. Geometry is untouched: the chip is
 *  a display of the same record, not a different place to be.
 *
 *  ABSOLUTE, with no toggle beside it: every caller knows which way it wants to go (the
 *  header's chevron collapses, the rail chip expands, a summon un-collapses), and a
 *  toggle would make each of them read the state first to be sure. */
export function setPaletteCollapsed(
  state: WorkspaceState,
  id: PaletteId,
  collapsed: boolean,
): WorkspaceState {
  const geom = state.palettes[id];
  if (geom.collapsed === collapsed) return state;
  return withPalette(state, id, { ...geom, collapsed });
}

/** Close a palette (it leaves the layer AND the rail) or bring it back. Everything else
 *  about it survives, so re-opening restores the arrangement rather than the default.
 *
 *  Returns the SAME state when nothing changed — `setPaletteCollapsed`'s discipline, and
 *  it earns its keep here for a reason that did not exist when the other two got it: the
 *  session card's open state is DRIVEN by an effect rather than clicked, so a redundant
 *  "still open" would otherwise rewrite the arrangement (re-rendering the layer, re-arming
 *  the persist debounce) on a schedule nothing user-facing controls. */
export function setPaletteOpen(
  state: WorkspaceState,
  id: PaletteId,
  open: boolean,
): WorkspaceState {
  const geom = state.palettes[id];
  if (geom.open === open) return state;
  return withPalette(state, id, { ...geom, open });
}

/** The ⌘\ latch (D-3). ONE flag over the whole layer, rewriting no palette record —
 *  which is what makes "restores the EXACT prior arrangement" true by construction
 *  rather than by remembering to save a copy. Clearing each palette's `open` instead
 *  would also lose the difference between hidden-by-chord and closed-by-the-user. */
export function setPalettesHidden(
  state: WorkspaceState,
  hidden: boolean,
): WorkspaceState {
  return { ...state, hidden };
}

/** The arrangement as it goes to disk — already the persisted shape, so this is the
 *  seam rather than a transformation. */
export function serializeWorkspace(
  state: WorkspaceState,
): NonNullable<UiState["workspace"]> {
  return { palettes: state.palettes, hidden: state.hidden };
}

/** Structural check on ONE persisted record. Necessary despite the static type: the
 *  blob is JSON off localStorage — hand-editable, half-written, or written by a build
 *  that spelled these fields differently. */
function isPaletteState(value: unknown): value is PaletteState {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    Number.isFinite(r["x"]) &&
    Number.isFinite(r["y"]) &&
    (r["edge"] === "left" || r["edge"] === "right" || r["edge"] === null) &&
    typeof r["collapsed"] === "boolean" &&
    typeof r["open"] === "boolean"
  );
}

/** Rebuild the arrangement from a persisted blob, defaulting anything unusable. Each
 *  record is validated ALONE so one bad palette costs only itself, and ids outside
 *  `PALETTE_IDS` are dropped.
 *
 *  A blob written before a palette EXISTED is the same case as a corrupt record: the
 *  base is `defaultWorkspace()` and only ids the blob actually carries overwrite it, so
 *  a new palette arrives at its own default (closed, for `log`) instead of `undefined`
 *  — which would be a crash in the layer, not a fallback.
 *
 *  A `drivenOpen` palette (today: `session`) restores its GEOMETRY and drops its `open`,
 *  because that flag is the editor's rather than the user's. Enforced here, at the one
 *  place a blob becomes an arrangement, rather than left to the driver to correct on
 *  mount: the driver would close it a frame later, so the visible outcome of trusting the
 *  blob is a flash of a card describing nothing.
 *
 *  Deliberately does NOT clamp to the current window: bounds need the palette's own
 *  measured size, which does not exist until it renders. A window that shrank between
 *  sessions can therefore restore a palette out of reach — the case Reset Workspace
 *  exists for (D-3, the Photoshop mechanism). */
export function deserializeWorkspace(
  raw: UiState["workspace"],
): WorkspaceState {
  const state = defaultWorkspace();
  if (typeof raw !== "object" || raw === null) return state;
  const persisted: unknown = raw.palettes;
  if (typeof persisted === "object" && persisted !== null) {
    const records = persisted as Record<string, unknown>;
    for (const id of PALETTE_IDS) {
      const record = records[id];
      if (!isPaletteState(record)) continue;
      state.palettes[id] =
        PALETTES[id].drivenOpen === true
          ? { ...record, open: PALETTES[id].default.open }
          : record;
    }
  }
  return { palettes: state.palettes, hidden: raw.hidden === true };
}

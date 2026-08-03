// The palette arrangement, as pure data: where each floating palette sits, how big the
// user has made it, whether it is rolled up or closed, and whether the whole layer is
// latched away by ⌘\.
//
// PURE on purpose — no DOM, no persistence, no React. The cell's size is the one fact
// this module cannot know, so it arrives as an argument (`OriginBounds`, `SizeBounds`);
// the layer component owns measuring it, owns the debounced write, and owns nothing else.
// A palette's own CONTENT height is the second such fact, and the only one a caller has to
// hand in per gesture (`growPalette`) rather than per cell. Everything here is a
// value→value function, which is what makes the geometry rules (clamp, snap, what survives
// a hide) testable without a browser.
//
// TWO NUMBERS FOR ONE FACT, and `paletteBox` is where that stops. `PALETTES[id]` holds what
// a palette SHIPS as — the figures the default-arrangement proof reasons about, which stay
// the proof's whatever any user does (D-3). `PaletteState.width/height` hold what the user
// dragged. Everything that wants the LIVE size goes through `paletteBox`, so the width the
// layer renders and the width the projection subtracts cannot come apart.
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
    /** How wide this palette renders BEFORE the user sizes it, in px — the default the
     *  projection's `maxX` and the default-arrangement check both reason about. ONE number
     *  rather than a Tailwind class, because a `w-[360px]` is a number in disguise that only
     *  CSS can read, and half of this module's job is arithmetic on it.
     *
     *  A DEFAULT rather than the width, since the F4.5 gate ruling: `PaletteState.width`
     *  overrides it once a handle has been dragged, and `paletteBox` is the one place the
     *  two are reconciled. What is asserted against these figures stays asserted against
     *  THESE — the shipped arrangement is a claim about how the cockpit opens, and a user's
     *  own arrangement is theirs to overlap (D-3).
     *
     *  Every figure is set by the WIDEST row that palette must render without truncating;
     *  each one carries its own argument below. ONE of them knowingly misses that bar and
     *  says so on its own line: the F4.5c holistic gate found `flags` truncating its locator
     *  on 22 of 25 rows at the 320 it still declares. The ruling was that the RESIZE is the
     *  answer rather than a bigger default — a width chosen for the worst locator is spent on
     *  every world that has none — so the rule above is the aspiration and that palette is
     *  the standing exception to it. Recorded here because a rule stated without its known
     *  counter-example reads as a proof. */
    width: number;
    /** How far down this palette may grow before the user sizes it, in px — `undefined` for
     *  one that may run to the bottom of the cell.
     *
     *  A BUDGET, not a measurement, and the layer enforces it (`max-height`, so the body
     *  scrolls past it). It exists because the default arrangement has to be PROVABLE: at
     *  the design floor there are three columns and four palettes that must not collide, so
     *  one column stacks two of them — and a stack cannot be proven clear when the upper
     *  palette's height is whatever its content happens to be. The budget is the upper
     *  one's half of that proof; see `tests/palette-store.test.ts`.
     *
     *  A CEILING ON CONTENT while it applies, and that is the half the F4.5 ruling did NOT
     *  change: an entities palette holding two rows is two rows tall, not 320. What the
     *  ruling changed is that it STOPS applying the moment the user sets a height — the
     *  extent is the default size rather than a ceiling, so nobody has to argue with a
     *  budget they can simply drag past (`paletteBox` drops it). */
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
    // predict. What it does NOT outlive is the user saying otherwise: dragging the resize
    // handle sets a height and this budget stops applying to that palette (the F4.5 gate
    // ruling — see `paletteBox`). So on a tall screen the ten rows are where the list
    // STARTS rather than where it is stuck.
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
    // 280 px leaves the card's own rows a 254 px text column, and that is the figure the
    // form was drawn against: the palette body carries NO padding of its own (see
    // `Palette`), so what 280 pays for is the section's 1 px border either side and the
    // card's `px-3` either side — 280 − 2 − 24. Narrower than every other palette on
    // purpose: it is a label-column form, not a list, and a wide one puts the labels a long
    // way from the values they name.
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
    //
    // KNOWN INSUFFICIENT at the design floor, and the record of that belongs here rather
    // than only in a commit message: the F4.5c holistic gate found this palette truncating
    // its locator on 22 of 25 rows AT this 320. The answer the gate ruled for is the
    // resize handle, not a bigger default — a default wide enough for the worst locator
    // would spend that width on every world that has none — so the figure stands and the
    // rule above it ("the widest row that must render without truncating") is the
    // aspiration this one palette knowingly misses.
    width: 320,
    // Ten locator rows, the same claim `entities` and `log` make — but 30 px more palette
    // to hold them, because this body puts TWO rows above its list (the candidate count,
    // then the filter-band chips) where theirs put one. Nothing sits below this palette,
    // so no pairwise proof rests on the number; what it buys is that the arrangement does
    // not silently grow to the bottom of a taller cell.
    //
    // It was a `max-h-64` on the list itself until the F4.5c fix round, which put the
    // ceiling somewhere the resize could not drop it — so dragging this palette taller
    // added empty space under a list still capped at ten rows.
    maxHeight: 350,
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
    // Ten rows, `entities`' figure exactly: this body's one chrome row (the step summary)
    // is the section header that figure already counts. Alone in its column, so no
    // pairwise proof rests on it — it is here because an extent is the DEFAULT SIZE, and
    // a summoned list that opened at the full height of the cell would be a different
    // arrangement from the one that shipped. See `flags` for the rest of the argument.
    maxHeight: 320,
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

/** The smallest a user may drag a palette on each axis, in px — the resize's whole
 *  "keep the grip reachable" and, per the ruling's scope guard, its only floor.
 *
 *  HEIGHT is the header (`GRIP_REACH_PX`) plus the section's own 1 px border top and
 *  bottom. The box is `overflow-hidden` and `box-sizing: border-box`, so a palette dragged
 *  to a bare 33 has a 31 px content box and clips 2 px off the one control that could drag
 *  it back — the rail chip being reachable only through a collapse button that went with it.
 *  Those two pixels are the same pair the width has always counted, and they were the one
 *  term missing from this axis.
 *
 *  WIDTH is that same header's furniture, added up rather than picked: the section's 1 px
 *  border either side, `px-2` either side, the collapse and close buttons at `w-5` apiece,
 *  the two `gap-1`s between the three children — and `GRIP_REACH_PX` once more for the
 *  title button, which is the same "one grip's worth" figure the Y axis uses, applied to
 *  the axis the grip is long on. Anything narrower is a header with no draggable title in
 *  it. Kept as the arithmetic so a header that grows a fourth control reddens the sum
 *  rather than silently outgrowing a round number — and the border pair is written the same
 *  way on both axes so the next such term cannot land on only one of them. */
export const MIN_PALETTE_SIZE = {
  width: 1 * 2 + 8 * 2 + 20 * 2 + 4 * 2 + GRIP_REACH_PX,
  height: 1 * 2 + GRIP_REACH_PX,
} as const;

/** The cell as the layer measured it. */
export type CellSize = { width: number; height: number };

/** A palette's own box, in px. Both the size a resize sets and the size the layer measures
 *  off a rendered palette — the same two numbers, so they are the same type. */
export type PaletteSize = { width: number; height: number };

/** How big a palette renders RIGHT NOW: the declared defaults and the user's own size,
 *  already reconciled. `paletteBox` is the only thing that builds one, and everything that
 *  needs a palette's size — the inline style, the projection's bounds — reads it, which is
 *  what makes "the width the layer renders IS the width the projection subtracts" true by
 *  construction rather than by two modules agreeing to read the same field. */
export type PaletteBox = {
  /** The rendered width. Always a number: a palette has no content-sized width to fall
   *  back to, so either the user set one or the declared default stands. */
  width: number;
  /** The user's own height, or `null` if they have never set one — in which case the box
   *  is content-sized and {@link PaletteBox.extent} is what stops it growing. */
  height: number | null;
  /** The declared extent budget (`PALETTES[id].maxHeight`), or `null`.
   *
   *  ALWAYS `null` once `height` is set, and that is the F4.5 ruling in one line: the
   *  extent is the DEFAULT size, not a ceiling, so the moment a user drags a height it
   *  stops applying. Null also when the palette declares no budget at all — the two read
   *  the same to the renderer, which only ever asks "is there a cap".
   *
   *  The cell's own ceiling is NOT here. `Palette.placement` adds `calc(100% - y)`
   *  separately, because it is a fact about the viewport rather than about the palette,
   *  and it applies to a user-set height as much as to a content-sized one. */
  extent: number | null;
};

/** A user-set figure, floored — or `null` when there is none.
 *
 *  The read side of the resize's clamp, and it is a projection in exactly `clampToCell`'s
 *  sense: `resizePalette` clamps what gets STORED, this pins what gets SHOWN, and a blob
 *  hand-edited to a 4 px palette is the case only this one covers. */
const sized = (value: number | undefined, floor: number): number | null =>
  value === undefined ? null : Math.max(value, floor);

/** How big this palette renders — the user's size where they set one, the declared default
 *  everywhere else.
 *
 *  THE ONE RECONCILIATION. `PALETTES[id]` holds what the palette ships as and what the
 *  default-arrangement proof reasons about; the record holds what the user dragged. Two
 *  readers wanting the live size (the layer's inline style, `cellBounds`) go through here
 *  rather than each deciding for themselves, because the moment they disagree a drag and
 *  the projection are clamping to different boxes. */
export function paletteBox(id: PaletteId, geom: PaletteState): PaletteBox {
  const declared = PALETTES[id];
  const height = sized(geom.height, MIN_PALETTE_SIZE.height);
  return {
    width: sized(geom.width, MIN_PALETTE_SIZE.width) ?? declared.width,
    height,
    extent: height === null ? (declared.maxHeight ?? null) : null,
  };
}

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
 *  ties to the left — decided, rather than whichever comparison happens to run first.
 *
 *  A cell with NO room to place the palette (`maxX <= 0`) has no edge at all, and that
 *  guard is a fix rather than a formality. Without it the arithmetic goes through and lies:
 *  the gutter test fails on a negative `maxX` (`0 > SNAP_PX` is false) and the tie-break
 *  then inverts (`0 <= -300` is false), so the answer is "right" — a free palette silently
 *  and permanently docking, losing its border and its rounded corner, rendering from
 *  `right: 0`, and re-docking on every further drag until the window grew back past its
 *  width. `clampBoxToCell` keeps `maxX` out of that range on the normal path; this keeps
 *  any OTHER path from writing a bogus dock. When every x resolves to 0 there is no
 *  direction the gesture could have expressed, so recording one invents a fact. */
function edgeAt(x: number, maxX: number): PaletteState["edge"] {
  if (maxX <= 0) return null;
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

/** Set a palette's own size, clamped into `bounds` and floored at {@link MIN_PALETTE_SIZE}.
 *
 *  The F4.5 gate ruling's write side. Size is the user's, so it joins the D-3 blob beside
 *  the position and Reset Workspace clears it the same way — by handing back a record that
 *  simply has no size on it.
 *
 *  PER AXIS, and an absent axis is "leave it" rather than "clamp it" or "clear it". This
 *  used to take both numbers every call, so the first gesture on EITHER axis pinned both —
 *  defensible for a corner drag, and wrong for a keyboard press that moved one axis by
 *  construction (`RESIZE_KEYS` hands `ArrowRight` a `dh` of 0). The cost was permanent: a
 *  written height makes `paletteBox` hand back `extent: null` plus a fixed number, so the
 *  palette stops being content-sized, and the session card — a form with an expanding
 *  Advanced section — starts scrolling that section inside a box frozen at its collapsed
 *  height. A corner drag still pins both, because a corner drag really does move both; the
 *  difference is that the GESTURE says which axes it moved instead of this function
 *  assuming.
 *
 *  Returns the SAME state when nothing about the size changed. A drag against a clamped
 *  edge produces one of these per pointer event; `movePalette`'s reason, verbatim. */
export function resizePalette(
  state: WorkspaceState,
  id: PaletteId,
  size: Partial<PaletteSize>,
  bounds: SizeBounds,
): WorkspaceState {
  // The floor wins over the ceiling when a cell is smaller than a usable palette, exactly
  // as `movePalette`'s clamp pins to 0 when both maxima go negative: un-grabbable-but-there
  // beats gone.
  const fit = (v: number, min: number, max: number): number =>
    Math.max(min, Math.min(v, max));
  const geom = state.palettes[id];
  const next: PaletteState = { ...geom };
  if (size.width !== undefined)
    next.width = fit(size.width, MIN_PALETTE_SIZE.width, bounds.maxWidth);
  if (size.height !== undefined)
    next.height = fit(size.height, MIN_PALETTE_SIZE.height, bounds.maxHeight);
  if (geom.width === next.width && geom.height === next.height) return state;
  return withPalette(state, id, next);
}

/** Step a palette's size by a keyboard delta — the resize's half of D-26, and `growPalette`
 *  is to `resizePalette` exactly what `nudgePalette` is to `movePalette`.
 *
 *  It is `resizePalette` with the current size worked out first, and that is the whole of
 *  it: the floor, the cell clamp and the identity return are the DRAG's, not a second set.
 *
 *  The size has to be RESOLVED rather than read, for the reason the origin does one function
 *  up — and on one axis only. `paletteBox` states the width outright, but a height the user
 *  has never set is CONTENT, and the DOM is the only thing that knows a content height. So
 *  the caller measures it and this decides whether it was needed: `measured.height` is the
 *  fallback for a palette that has no stored height, and is ignored once there is one.
 *  `measured.bounds` is used on EVERY call — it is the cell, not a fallback.
 *
 *  A ZERO delta writes nothing on that axis, which is what keeps `ArrowRight` from pinning
 *  a height (`RESIZE_KEYS` gives every key a zero on one axis by construction). See
 *  `resizePalette` for what a pinned height costs.
 *
 *  Resolving HERE rather than at the call site is what makes a burst of presses compound.
 *  React batches updates inside one task, so a component that worked the target out from its
 *  own props would read the same stale size for every press in the burst and all but the
 *  first would resolve to the identical state — a held arrow that moved the handle once. */
export function growPalette(
  state: WorkspaceState,
  id: PaletteId,
  delta: { dw: number; dh: number },
  measured: { height: number; bounds: SizeBounds },
): WorkspaceState {
  const box = paletteBox(id, state.palettes[id]);
  const target: Partial<PaletteSize> = {};
  if (delta.dw !== 0) target.width = box.width + delta.dw;
  if (delta.dh !== 0)
    target.height = (box.height ?? measured.height) + delta.dh;
  return resizePalette(state, id, target, measured.bounds);
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

/** The origin bounds the LAYER projects against: the cell minus this palette's live width,
 *  and minus one grip's worth of height.
 *
 *  Asymmetric on purpose. The width is a number this module can state without measuring
 *  anything (`paletteBox` — the user's, or the declared default), so x gets the drag's own
 *  rule: the whole box stays in. The height is content unless the user has set one, and the
 *  projection runs on every render, so the strongest honest promise on that axis is that the
 *  header is still there to grab.
 *
 *  FOUR rules decide where a palette may be, and this is the invariant that keeps them
 *  agreeing. `movePalette` clamps a drag, `clampToCell` clamps the projection, this
 *  function derives the projection's bounds, and `PaletteLayer.measureBounds` derives the
 *  drag's. The two derivations differ on BOTH axes: the drag measures the palette, this one
 *  states its width and gives the Y axis a grip instead of a height. On x they agree
 *  exactly, and the reason changed shape when palettes became resizable: it used to be that
 *  the DECLARED width is the rendered width, and it is now that both this function and the
 *  layer's inline style read the same `paletteBox` (`box-sizing: border-box`, and no
 *  `max-width` anywhere — a CSS width cap is the one thing that would break the agreement,
 *  which is why the Y axis's cap has no X twin). On y they do not agree, and the thing that
 *  stops the difference from being visible is `Palette.placement`'s `calc(100% - y)` height
 *  cap on the SHOWN y: it is what keeps a projected palette inside the cell it was projected
 *  into — a user-set height included, which is why that cap survives one — so the drag's own
 *  maxY is never smaller than where the projection put it. Remove that cap and the first
 *  arrow press after a shrink re-measures a palette taller than the cell and teleports it. */
export function cellBounds(
  cell: CellSize,
  id: PaletteId,
  geom: PaletteState,
): OriginBounds {
  return {
    maxX: cell.width - paletteBox(id, geom).width,
    maxY: cell.height - GRIP_REACH_PX,
  };
}

/** How big a palette may range over, for the RESIZE what `cellBounds` is for the move.
 *
 *  `maxHeight` here is the cell's, and is a different fact from `PaletteBox.extent` (a
 *  declared budget) — this one is how far the handle can travel before it leaves the cell. */
export type SizeBounds = { maxWidth: number; maxHeight: number };

/** The size bounds a resize clamps into: as far as this palette can grow before its resize
 *  handle leaves the cell. The ruling's scope guard grants exactly this much and no more —
 *  the handle rides the palette's far corner, so a palette sized past the cell puts the one
 *  control that could shrink it out of reach.
 *
 *  `geom` is the SHOWN geometry (post-`clampToCell`), because that is where the palette
 *  actually is. A DOCKED palette is placed FROM its edge and its stored x says nothing about
 *  that, so it may grow to fill the cell — the same fact `clampToCell` and `nudgePalette`
 *  already turn on, and reading `x` here would let a palette docked in a wider window
 *  compute a negative width for itself. */
export function sizeBounds(cell: CellSize, geom: PaletteState): SizeBounds {
  return {
    maxWidth: geom.edge === null ? cell.width - geom.x : cell.width,
    maxHeight: cell.height - geom.y,
  };
}

/** How big a stored box is actually SHOWN in a cell this size — {@link clampToCell}'s twin
 *  for the SIZE, applied at render, leaving the record alone.
 *
 *  `resizePalette` clamps what a gesture stores, and until this existed that was the only
 *  clamp: a window that shrank afterwards left the palette at its stored width with its
 *  resize handle — welded to the box's far corner — outside the cell. `Shell` is
 *  `fixed inset-0`, so nothing scrolls to reach it, and the one control that could shrink
 *  the palette back is gone until the window grows. That is the exact guarantee
 *  `sizeBounds` claims and could not keep alone.
 *
 *  PROJECT rather than mutate, for `clampToCell`'s reasons verbatim: the record is the
 *  user's intent, a shrink they undo a second later must not rewrite it, and every write to
 *  this store also marks the arrangement "touched" — which persists it and vetoes a restore
 *  that may not have arrived.
 *
 *  WIDTH ONLY, and the asymmetry is the honest one rather than an omission. The height is
 *  already held inside the cell by `Palette.placement`'s `calc(100% - y)` cap: `max-height`
 *  beats `height` in CSS, so a box's bottom edge cannot pass the cell's, and the handle is
 *  `absolute bottom-0` on that box. `cellBounds`' docblock already rests on that same cap.
 *  There is deliberately NO such cap on x — a CSS width cap would make the rendered width
 *  differ from the width the projection subtracts — so x is the axis with nothing else
 *  holding it, and this is what holds it.
 *
 *  The x-axis invariant survives it. `cellBounds` still subtracts the STORED width, so its
 *  `maxX` can be negative where the shown width is clamped; but a clamp only happens when
 *  `maxX < 0`, and there both the projection and the drag's measured bounds resolve every x
 *  to 0. Where `maxX >= 0` the origin projection has already put the whole box inside, so
 *  this function is an identity.
 *
 *  Returns the SAME box when nothing is clamped: the layer projects per render. */
export function clampBoxToCell(
  box: PaletteBox,
  bounds: SizeBounds,
): PaletteBox {
  const width = Math.max(
    MIN_PALETTE_SIZE.width,
    Math.min(box.width, bounds.maxWidth),
  );
  return width === box.width ? box : { ...box, width };
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

/** An OPTIONAL persisted figure: absent, or a real number. The user's size is the only
 *  field on the record that a blob is allowed not to carry — absent means "never resized",
 *  which is every blob written before palettes could be resized and therefore the whole of
 *  that migration.
 *
 *  Strict about what counts as present: only `undefined` passes as absent, so a
 *  hand-written `null` fails the record rather than being read as "unset". Nothing here
 *  ever writes one (`JSON.stringify` omits an undefined-valued property outright), so
 *  tolerating it would be a second spelling of absence with no producer. */
const isOptionalSize = (value: unknown): boolean =>
  value === undefined || Number.isFinite(value);

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
    typeof r["open"] === "boolean" &&
    isOptionalSize(r["width"]) &&
    isOptionalSize(r["height"])
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
 *  exists for (D-3, the Photoshop mechanism).
 *
 *  A restored SIZE is not clamped here either, and for once that costs nothing: the
 *  ceiling is the window (same problem), but the FLOOR is a static constant, so
 *  `paletteBox` applies it at render — a hand-edited 4 px palette is shown at the minimum
 *  rather than clipped away. Absent is the case that matters, and it is the whole
 *  migration: every blob written before palettes could be resized has no size, which reads
 *  as "never resized" and takes the declared default. */
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

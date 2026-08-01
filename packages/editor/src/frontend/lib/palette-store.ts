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
 *  palette that gets renamed or retired cannot come back as dead geometry. */
export const PALETTE_IDS = [
  "controls",
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
 *  The default arrangement claims THREE of the cell's four corners deliberately:
 *  controls docked right, entities floating top-left, and the top-right left clear for
 *  the axis triad. That leaves the bottom-left as the one strip nothing defaults into,
 *  which is where the collapsed-chip rail lives (see PaletteLayer).
 *
 *  MIGRATION (until F4.5b): `controls` is edge-docked right because it holds the whole
 *  surviving FieldPanel stack, which is still one 300 px column. It dissolves into
 *  per-concern palettes next slice, and this default goes with it. */
export const PALETTES: Record<
  PaletteId,
  {
    title: string;
    default: PaletteState;
    /** This palette's `open` is DRIVEN by the editor, so it is neither persisted nor
     *  restored — `deserializeWorkspace` forces it back to the default above. Everything
     *  else about it (where it sits, whether it is docked or rolled up) is still the
     *  user's, which is exactly D-13's "permanence is a docking choice". */
    drivenOpen?: true;
  }
> = {
  controls: {
    title: "Controls",
    default: { x: 0, y: 0, edge: "right", collapsed: false, open: true },
  },
  entities: {
    title: "Entities",
    // Free-floating top-left, and OPEN: the committed-stamp list is the reference
    // surface for everything the dig loop produces, so it ships visible. Its section
    // starts collapsed (EntitiesList's own default), so an empty world spends one
    // header row on it rather than a column.
    default: { x: 24, y: 24, edge: null, collapsed: false, open: true },
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
    // Below the entities palette in the same left column (that one floats at
    // (24, 24)): the two are the REFERENCE surfaces — what the world contains, and
    // what is wrong with it — and they are read together. A tall entity list will
    // reach this, which is the ordinary "drag one aside" case the log already
    // documents for sharing a corner, not a reason to spend the last free quadrant.
    default: { x: 24, y: 380, edge: null, collapsed: false, open: true },
  },
  history: {
    title: "History",
    // Free-floating, and the one default that had to dodge three occupied corners: the
    // entities palette and the log share the top-left, the session card sits at (420, 56),
    // the axis triad owns the top-right, and the collapsed-chip rail owns the bottom-left.
    // (420, 360) is under the session card in the same column — the two are read at
    // different moments (what a stamp IS, versus what has been done), and sharing a column
    // keeps the middle of the canvas clear.
    //
    // A y this far down clamps to the cell's bottom in a short window, which is the right
    // failure: the chip rail it would then sit beside is at x = 0, and this is not.
    default: { x: 420, y: 360, edge: null, collapsed: false, open: false },
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
  },
};

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
      controls: { ...PALETTES.controls.default },
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

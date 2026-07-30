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
 *  MIGRATION (until Task 10 of the F4.5a plan): `controls` alone. The entities palette
 *  registers here when it has content of its own — an empty titled box would be dead
 *  chrome, and Task 10 is what fills it. */
export const PALETTE_IDS = ["controls"] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

/** Where a palette starts before the user has moved it, and what it is called.
 *
 *  MIGRATION (until F4.5b): `controls` is edge-docked right because it holds the whole
 *  surviving FieldPanel stack, which is still one 300 px column. It dissolves into
 *  per-concern palettes next slice, and this default goes with it. */
export const PALETTES: Record<
  PaletteId,
  { title: string; default: PaletteState }
> = {
  controls: {
    title: "Controls",
    default: { x: 0, y: 0, edge: "right", collapsed: false, open: true },
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
    palettes: { controls: { ...PALETTES.controls.default } },
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
 *  a display of the same record, not a different place to be. */
export function togglePaletteCollapsed(
  state: WorkspaceState,
  id: PaletteId,
): WorkspaceState {
  const geom = state.palettes[id];
  return withPalette(state, id, { ...geom, collapsed: !geom.collapsed });
}

/** Close a palette (it leaves the layer AND the rail) or bring it back. Everything else
 *  about it survives, so re-opening restores the arrangement rather than the default. */
export function setPaletteOpen(
  state: WorkspaceState,
  id: PaletteId,
  open: boolean,
): WorkspaceState {
  return withPalette(state, id, { ...state.palettes[id], open });
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
      if (isPaletteState(record)) state.palettes[id] = record;
    }
  }
  return { palettes: state.palettes, hidden: raw.hidden === true };
}

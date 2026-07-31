// The palette arrangement as pure data — no DOM here (safe in bare tests/, like
// persist.test.ts beside it). Every geometric rule the cockpit rests on is decided in
// this module: what a drag is allowed to do to a palette, when it docks, and what
// survives a hide-all. The LAYER only measures the cell and hands the numbers in.
import { expect, test } from "bun:test";
import {
  defaultWorkspace,
  deserializeWorkspace,
  movePalette,
  PALETTES,
  SNAP_PX,
  serializeWorkspace,
  setPaletteCollapsed,
  setPaletteOpen,
  setPalettesHidden,
  type WorkspaceState,
} from "../src/frontend/lib/palette-store.ts";
import type { PaletteState } from "../src/frontend/lib/persist.ts";

// A roomy cell: every edge is far enough away that a move lands where it was put.
const BOUNDS = { maxX: 900, maxY: 500 };

/** The default arrangement with `controls` free-floating at (x, y) — the starting point
 *  for the move cases, which need a palette that is NOT already docked. */
function floatingAt(x: number, y: number): WorkspaceState {
  const base = defaultWorkspace();
  return {
    ...base,
    palettes: {
      ...base.palettes,
      controls: { ...base.palettes.controls, x, y, edge: null },
    },
  };
}

test("move clamps to the viewport bounds", () => {
  const start = floatingAt(400, 200);

  // Past the bottom-right corner: both axes pin to the maxima the layer measured.
  const far = movePalette(start, "controls", { x: 4000, y: 4000 }, BOUNDS);
  expect(far.palettes.controls.x).toBe(BOUNDS.maxX);
  expect(far.palettes.controls.y).toBe(BOUNDS.maxY);

  // Past the top-left corner: never negative, so the header always stays grabbable.
  const near = movePalette(start, "controls", { x: -500, y: -500 }, BOUNDS);
  expect(near.palettes.controls.x).toBe(0);
  expect(near.palettes.controls.y).toBe(0);

  // A palette LARGER than the cell (a narrow window, or a resize between sessions)
  // makes both maxima negative. It pins to the origin rather than off-screen: the
  // clamp's lower bound wins, so the header is still there to drag.
  const tiny = movePalette(
    start,
    "controls",
    { x: 300, y: 300 },
    { maxX: -120, maxY: -40 },
  );
  expect(tiny.palettes.controls.x).toBe(0);
  expect(tiny.palettes.controls.y).toBe(0);

  // Pure: the input state is not mutated.
  expect(start.palettes.controls.x).toBe(400);

  // A move that resolves to the placement already stored returns the SAME state. A drag
  // along a clamped edge produces one of these per pointer event; without the identity
  // return each one re-renders the layer and re-arms the persist debounce.
  expect(movePalette(far, "controls", { x: 4000, y: 4000 }, BOUNDS)).toBe(far);
  expect(movePalette(far, "controls", { x: 5000, y: 6000 }, BOUNDS)).toBe(far);
});

test("edge snap engages within SNAP_PX of the right/left edge and records edge", () => {
  const start = floatingAt(400, 200);

  // Inside the right gutter: pinned to the edge AND recorded as docked, so a window
  // resize keeps it on that edge instead of stranding it mid-canvas.
  const right = movePalette(
    start,
    "controls",
    { x: BOUNDS.maxX - (SNAP_PX - 1), y: 200 },
    BOUNDS,
  );
  expect(right.palettes.controls.x).toBe(BOUNDS.maxX);
  expect(right.palettes.controls.edge).toBe("right");

  const left = movePalette(
    start,
    "controls",
    { x: SNAP_PX - 1, y: 200 },
    BOUNDS,
  );
  expect(left.palettes.controls.x).toBe(0);
  expect(left.palettes.controls.edge).toBe("left");

  // Just OUTSIDE the gutter on both sides: free-floating, exactly where it was put.
  const freeRight = movePalette(
    start,
    "controls",
    { x: BOUNDS.maxX - (SNAP_PX + 1), y: 200 },
    BOUNDS,
  );
  expect(freeRight.palettes.controls.x).toBe(BOUNDS.maxX - (SNAP_PX + 1));
  expect(freeRight.palettes.controls.edge).toBeNull();
  const freeLeft = movePalette(
    start,
    "controls",
    { x: SNAP_PX + 1, y: 200 },
    BOUNDS,
  );
  expect(freeLeft.palettes.controls.edge).toBeNull();

  // Dragging a DOCKED palette off its edge un-docks it — the edge is a fact about
  // where it is now, never a latch that outlives the position.
  const undocked = movePalette(right, "controls", { x: 400, y: 200 }, BOUNDS);
  expect(undocked.palettes.controls.edge).toBeNull();

  // Both gutters overlap when the palette nearly fills the cell. The NEARER edge
  // wins and an exact tie goes left, so the outcome is decided rather than
  // order-of-comparison luck.
  const narrow = { maxX: SNAP_PX, maxY: 500 };
  expect(
    movePalette(start, "controls", { x: SNAP_PX / 2, y: 0 }, narrow).palettes
      .controls.edge,
  ).toBe("left");
  expect(
    movePalette(start, "controls", { x: SNAP_PX - 1, y: 0 }, narrow).palettes
      .controls.edge,
  ).toBe("right");

  // Vertical placement is never snapped: there are only two edges (the persisted
  // `edge` union says so), left and right.
  expect(
    movePalette(start, "controls", { x: 400, y: 2 }, BOUNDS).palettes.controls
      .y,
  ).toBe(2);
});

test("collapse is absolute; open=false removes from layout but keeps geometry", () => {
  const start = movePalette(
    floatingAt(400, 200),
    "controls",
    { x: 300, y: 120 },
    BOUNDS,
  );

  const collapsed = setPaletteCollapsed(start, "controls", true);
  expect(collapsed.palettes.controls.collapsed).toBe(true);
  expect(
    setPaletteCollapsed(collapsed, "controls", false).palettes.controls
      .collapsed,
  ).toBe(false);
  // Absolute, so a caller that already knows the state it wants (the status bar's ⚠
  // chip summoning the log; the rail chip expanding) needs no read first — and asking
  // for the state it is already in returns the SAME state rather than a new record
  // that would re-render the layer and re-arm the persist debounce.
  expect(setPaletteCollapsed(collapsed, "controls", true)).toBe(collapsed);
  // Collapsing is a chrome state, not a move: the geometry it will be restored to
  // has to survive the round trip untouched.
  expect(collapsed.palettes.controls.x).toBe(300);
  expect(collapsed.palettes.controls.y).toBe(120);
  expect(collapsed.palettes.controls.open).toBe(true);

  const closed = setPaletteOpen(collapsed, "controls", false);
  expect(closed.palettes.controls.open).toBe(false);
  // Same for closing: x/y/edge/collapsed all outlive it, so re-opening puts the
  // palette back where the user left it rather than at the default.
  expect(closed.palettes.controls.x).toBe(300);
  expect(closed.palettes.controls.y).toBe(120);
  expect(closed.palettes.controls.collapsed).toBe(true);
  expect(setPaletteOpen(closed, "controls", true).palettes.controls.open).toBe(
    true,
  );
});

test("hideAll stores prior state; restore returns the EXACT arrangement (D-3)", () => {
  const arranged = setPaletteCollapsed(
    movePalette(floatingAt(400, 200), "controls", { x: 260, y: 90 }, BOUNDS),
    "controls",
    true,
  );

  const hidden = setPalettesHidden(arranged, true);
  expect(hidden.hidden).toBe(true);
  // The mechanism, not just the outcome: hide-all is a LATCH over the arrangement and
  // rewrites no palette record at all. A version that cleared `open` per palette (the
  // obvious wrong shape) would pass a value comparison after one round trip and lose
  // the difference between "hidden" and "the user had closed that one".
  expect(hidden.palettes).toBe(arranged.palettes);

  const shown = setPalettesHidden(hidden, false);
  expect(shown).toEqual(arranged);
});

test("open is ABSOLUTE and returns the SAME state when it changes nothing", () => {
  // The sibling discipline (`setPaletteCollapsed`, `movePalette`): a verb asked for the
  // state it is already in hands back the same object, so React bails out and the persist
  // debounce is not re-armed. It matters more here than it did for the other two, because
  // `session`'s open state is DRIVEN by an effect rather than clicked — a driver that
  // re-asserted "open" on every push would otherwise rewrite the arrangement, and the
  // workspace provider reads any write as "the user has arranged something" and skips the
  // restore it has not performed yet.
  const start = defaultWorkspace();
  expect(setPaletteOpen(start, "controls", true)).toBe(start);
  expect(setPaletteOpen(start, "session", false)).toBe(start);
  const opened = setPaletteOpen(start, "session", true);
  expect(opened).not.toBe(start);
  expect(opened.palettes.session.open).toBe(true);
});

test("the History palette ships CLOSED, and its open state is the USER's", () => {
  // The second summoned palette (D-11). Closed for the message log's reason — the named
  // Undo item already carries the last step, so the LIST is what you go looking for
  // rather than what you keep open — but NOT `drivenOpen`: nothing in the editor decides
  // to show it, so a blob that has it open must restore it open.
  const fresh = defaultWorkspace();
  expect(fresh.palettes.history.open).toBe(false);
  expect(PALETTES.history.drivenOpen).toBeUndefined();
  const restored = deserializeWorkspace({
    palettes: {
      history: { x: 100, y: 200, edge: null, collapsed: false, open: true },
    },
    hidden: false,
  });
  expect(restored.palettes.history.open).toBe(true);
});

test("reset returns the default arrangement — fresh records, controls docked right", () => {
  const fresh = defaultWorkspace();
  expect(fresh.hidden).toBe(false);
  expect(fresh.palettes.controls).toEqual({
    x: 0,
    y: 0,
    edge: "right",
    collapsed: false,
    open: true,
  });
  // The log palette is the summoned one: it ships CLOSED, so a session that has had
  // nothing to say spends no screen on saying so. A default of `open: true` here would
  // put an empty box over the canvas on every first run.
  expect(fresh.palettes.log.open).toBe(false);
  expect(fresh.palettes.log.edge).toBeNull();
  // Entities is the OTHER always-on palette, and it floats: it must not dock, because
  // both edges' full-height slots are the ones a docked palette would take from the
  // rail and the triad. Open, because a list of what the world contains is the
  // reference surface the dig loop is judged against.
  expect(fresh.palettes.entities).toEqual({
    x: 24,
    y: 24,
    edge: null,
    collapsed: false,
    open: true,
  });
  // The session card (D-13): FLOATING and CLOSED. Floating because permanence is a
  // docking choice the user makes, not a panel class; closed because its open state is
  // DRIVEN — it appears when there is a session or a selected entity to be about, and a
  // card open over nothing is the "empty inspector" the category was retired for. `y: 56`
  // clears the top bar; `x` clears the entities palette's own 360 px box at x = 24.
  expect(fresh.palettes.session).toEqual({
    x: 420,
    y: 56,
    edge: null,
    collapsed: false,
    open: false,
  });

  // Fresh objects every call: the reset verb hands its result straight into React
  // state, so a shared default record would let one session's drag rewrite the
  // arrangement every LATER reset restores.
  const second = defaultWorkspace();
  expect(second.palettes.controls).not.toBe(fresh.palettes.controls);
  fresh.palettes.controls.x = 999;
  expect(defaultWorkspace().palettes.controls.x).toBe(0);
});

test("serialize/deserialize round-trips through UiState.workspace", () => {
  const arranged = setPalettesHidden(
    movePalette(floatingAt(400, 200), "controls", { x: 260, y: 90 }, BOUNDS),
    true,
  );

  const blob = serializeWorkspace(arranged);
  // The persisted shape is UiState["workspace"] itself — JSON-safe, no class
  // instances, nothing the store has to know how to revive.
  expect(JSON.parse(JSON.stringify(blob))).toEqual(blob);
  expect(deserializeWorkspace(blob)).toEqual(arranged);

  // Nothing persisted yet (first run, or a project whose root never resolved).
  expect(deserializeWorkspace(undefined)).toEqual(defaultWorkspace());

  // The blob is JSON off localStorage: hand-edited, half-written or written by an
  // older build. Each unusable record falls back to its default INDEPENDENTLY rather
  // than costing the whole arrangement, and a palette id we no longer know is
  // dropped instead of resurrected as dead geometry.
  const salvaged = deserializeWorkspace({
    palettes: {
      // Boundary cast: the persisted blob's static type is what we hope for, not
      // what a JSON.parse of user-writable storage actually returns.
      controls: {
        x: "left-ish",
        y: 90,
        edge: "right",
        collapsed: false,
        open: true,
      } as unknown as PaletteState,
      ghosts: { x: 10, y: 10, edge: null, collapsed: false, open: true },
    },
    hidden: true,
  });
  expect(salvaged.palettes.controls).toEqual(
    defaultWorkspace().palettes.controls,
  );
  expect(Object.keys(salvaged.palettes).sort()).toEqual([
    "controls",
    "entities",
    "history",
    "log",
    "session",
  ]);
  expect(salvaged.hidden).toBe(true);
});

// D-13's one exception, and it is a property of the palette rather than of the store's
// callers, so it is enforced HERE where a persisted blob becomes an arrangement. The
// session card's GEOMETRY is the user's (where they dragged it, whether they docked it —
// permanence is a docking choice); its OPEN state is the editor's, driven by whether
// there is a session or a selected entity to be about. A blob written while a card was
// open would otherwise restore an empty card over the canvas on the next boot — and the
// driver would close it a frame later, so the visible outcome is a flash of a panel
// describing nothing.
test("a DRIVEN-open palette restores its geometry but never its open state", () => {
  const restored = deserializeWorkspace({
    palettes: {
      session: { x: 100, y: 200, edge: "left", collapsed: true, open: true },
    },
    hidden: false,
  });
  expect(restored.palettes.session).toEqual({
    x: 100,
    y: 200,
    edge: "left",
    collapsed: true,
    // …and NOT the `true` the blob carries.
    open: false,
  });
  // The rule is scoped to the palettes that declare it: `log` is summoned rather than
  // driven, so a user who left it open gets it back.
  const log = deserializeWorkspace({
    palettes: {
      log: { x: 100, y: 200, edge: null, collapsed: false, open: true },
    },
    hidden: false,
  });
  expect(log.palettes.log.open).toBe(true);
});

test("a blob written before a palette existed restores that palette's default", () => {
  // Exactly what is on disk for anyone who used the editor between Task 6 and Task 7:
  // a v2 workspace blob with a `controls` record and no `log` key at all. The version
  // did NOT change (nothing about the old shape became wrong), so this blob is read,
  // not orphaned — and every id it is missing has to arrive at its own default rather
  // than as `undefined`, which the layer would dereference on its first render.
  const restored = deserializeWorkspace({
    palettes: {
      controls: { x: 120, y: 60, edge: null, collapsed: false, open: true },
    },
    hidden: false,
  });
  expect(restored.palettes.controls.x).toBe(120);
  expect(restored.palettes.log).toEqual(defaultWorkspace().palettes.log);
});

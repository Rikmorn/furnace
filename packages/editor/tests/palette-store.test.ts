// The palette arrangement as pure data — no DOM here (safe in bare tests/, like
// persist.test.ts beside it). Every geometric rule the cockpit rests on is decided in
// this module: what a drag is allowed to do to a palette, when it docks, and what
// survives a hide-all. The LAYER only measures the cell and hands the numbers in.
import { expect, test } from "bun:test";
import {
  cellBounds,
  clampToCell,
  DESIGN_FLOOR_CELL,
  defaultWorkspace,
  deserializeWorkspace,
  movePalette,
  nudgePalette,
  PALETTE_IDS,
  PALETTES,
  type PaletteId,
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

/** The default arrangement with `entities` free-floating at (x, y) — the starting point
 *  for the move cases, which need a palette that is NOT already docked. */
function floatingAt(x: number, y: number): WorkspaceState {
  const base = defaultWorkspace();
  return {
    ...base,
    palettes: {
      ...base.palettes,
      entities: { ...base.palettes.entities, x, y, edge: null },
    },
  };
}

test("move clamps to the viewport bounds", () => {
  const start = floatingAt(400, 200);

  // Past the bottom-right corner: both axes pin to the maxima the layer measured.
  const far = movePalette(start, "entities", { x: 4000, y: 4000 }, BOUNDS);
  expect(far.palettes.entities.x).toBe(BOUNDS.maxX);
  expect(far.palettes.entities.y).toBe(BOUNDS.maxY);

  // Past the top-left corner: never negative, so the header always stays grabbable.
  const near = movePalette(start, "entities", { x: -500, y: -500 }, BOUNDS);
  expect(near.palettes.entities.x).toBe(0);
  expect(near.palettes.entities.y).toBe(0);

  // A palette LARGER than the cell (a narrow window, or a resize between sessions)
  // makes both maxima negative. It pins to the origin rather than off-screen: the
  // clamp's lower bound wins, so the header is still there to drag.
  const tiny = movePalette(
    start,
    "entities",
    { x: 300, y: 300 },
    { maxX: -120, maxY: -40 },
  );
  expect(tiny.palettes.entities.x).toBe(0);
  expect(tiny.palettes.entities.y).toBe(0);

  // Pure: the input state is not mutated.
  expect(start.palettes.entities.x).toBe(400);

  // A move that resolves to the placement already stored returns the SAME state. A drag
  // along a clamped edge produces one of these per pointer event; without the identity
  // return each one re-renders the layer and re-arms the persist debounce.
  expect(movePalette(far, "entities", { x: 4000, y: 4000 }, BOUNDS)).toBe(far);
  expect(movePalette(far, "entities", { x: 5000, y: 6000 }, BOUNDS)).toBe(far);
});

test("edge snap engages within SNAP_PX of the right/left edge and records edge", () => {
  const start = floatingAt(400, 200);

  // Inside the right gutter: pinned to the edge AND recorded as docked, so a window
  // resize keeps it on that edge instead of stranding it mid-canvas.
  const right = movePalette(
    start,
    "entities",
    { x: BOUNDS.maxX - (SNAP_PX - 1), y: 200 },
    BOUNDS,
  );
  expect(right.palettes.entities.x).toBe(BOUNDS.maxX);
  expect(right.palettes.entities.edge).toBe("right");

  const left = movePalette(
    start,
    "entities",
    { x: SNAP_PX - 1, y: 200 },
    BOUNDS,
  );
  expect(left.palettes.entities.x).toBe(0);
  expect(left.palettes.entities.edge).toBe("left");

  // Just OUTSIDE the gutter on both sides: free-floating, exactly where it was put.
  const freeRight = movePalette(
    start,
    "entities",
    { x: BOUNDS.maxX - (SNAP_PX + 1), y: 200 },
    BOUNDS,
  );
  expect(freeRight.palettes.entities.x).toBe(BOUNDS.maxX - (SNAP_PX + 1));
  expect(freeRight.palettes.entities.edge).toBeNull();
  const freeLeft = movePalette(
    start,
    "entities",
    { x: SNAP_PX + 1, y: 200 },
    BOUNDS,
  );
  expect(freeLeft.palettes.entities.edge).toBeNull();

  // Dragging a DOCKED palette off its edge un-docks it — the edge is a fact about
  // where it is now, never a latch that outlives the position.
  const undocked = movePalette(right, "entities", { x: 400, y: 200 }, BOUNDS);
  expect(undocked.palettes.entities.edge).toBeNull();

  // Both gutters overlap when the palette nearly fills the cell. The NEARER edge
  // wins and an exact tie goes left, so the outcome is decided rather than
  // order-of-comparison luck.
  const narrow = { maxX: SNAP_PX, maxY: 500 };
  expect(
    movePalette(start, "entities", { x: SNAP_PX / 2, y: 0 }, narrow).palettes
      .entities.edge,
  ).toBe("left");
  expect(
    movePalette(start, "entities", { x: SNAP_PX - 1, y: 0 }, narrow).palettes
      .entities.edge,
  ).toBe("right");

  // Vertical placement is never snapped: there are only two edges (the persisted
  // `edge` union says so), left and right.
  expect(
    movePalette(start, "entities", { x: 400, y: 2 }, BOUNDS).palettes.entities
      .y,
  ).toBe(2);
});

test("collapse is absolute; open=false removes from layout but keeps geometry", () => {
  const start = movePalette(
    floatingAt(400, 200),
    "entities",
    { x: 300, y: 120 },
    BOUNDS,
  );

  const collapsed = setPaletteCollapsed(start, "entities", true);
  expect(collapsed.palettes.entities.collapsed).toBe(true);
  expect(
    setPaletteCollapsed(collapsed, "entities", false).palettes.entities
      .collapsed,
  ).toBe(false);
  // Absolute, so a caller that already knows the state it wants (the status bar's ⚠
  // chip summoning the log; the rail chip expanding) needs no read first — and asking
  // for the state it is already in returns the SAME state rather than a new record
  // that would re-render the layer and re-arm the persist debounce.
  expect(setPaletteCollapsed(collapsed, "entities", true)).toBe(collapsed);
  // Collapsing is a chrome state, not a move: the geometry it will be restored to
  // has to survive the round trip untouched.
  expect(collapsed.palettes.entities.x).toBe(300);
  expect(collapsed.palettes.entities.y).toBe(120);
  expect(collapsed.palettes.entities.open).toBe(true);

  const closed = setPaletteOpen(collapsed, "entities", false);
  expect(closed.palettes.entities.open).toBe(false);
  // Same for closing: x/y/edge/collapsed all outlive it, so re-opening puts the
  // palette back where the user left it rather than at the default.
  expect(closed.palettes.entities.x).toBe(300);
  expect(closed.palettes.entities.y).toBe(120);
  expect(closed.palettes.entities.collapsed).toBe(true);
  expect(setPaletteOpen(closed, "entities", true).palettes.entities.open).toBe(
    true,
  );
});

test("hideAll stores prior state; restore returns the EXACT arrangement (D-3)", () => {
  const arranged = setPaletteCollapsed(
    movePalette(floatingAt(400, 200), "entities", { x: 260, y: 90 }, BOUNDS),
    "entities",
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
  expect(setPaletteOpen(start, "entities", true)).toBe(start);
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

test("reset returns the default arrangement — fresh records, NOTHING docked", () => {
  const fresh = defaultWorkspace();
  expect(fresh.hidden).toBe(false);
  // No default claims an edge any more. `controls` was the one that did, and it retired
  // with the FieldPanel stack in F4.5b — so the shipped arrangement leaves both full-height
  // dock slots free, and a docked palette is now always something the user chose. Asserted
  // over ALL of them rather than on the one that used to dock: a new palette that ships
  // docked has to argue for it here.
  for (const id of PALETTE_IDS)
    expect([id, fresh.palettes[id].edge]).toEqual([id, null]);
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
  expect(second.palettes.entities).not.toBe(fresh.palettes.entities);
  fresh.palettes.entities.x = 999;
  expect(defaultWorkspace().palettes.entities.x).toBe(
    PALETTES.entities.default.x,
  );
});

test("serialize/deserialize round-trips through UiState.workspace", () => {
  const arranged = setPalettesHidden(
    movePalette(floatingAt(400, 200), "entities", { x: 260, y: 90 }, BOUNDS),
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
      entities: {
        x: "left-ish",
        y: 90,
        edge: "right",
        collapsed: false,
        open: true,
      } as unknown as PaletteState,
      // Two RETIRED ids, and they are retired in different ways on purpose. `ghosts`
      // never existed — the synthetic case. `controls` is the REAL one: every blob
      // written before F4.5b dissolved the FieldPanel stack carries a `controls` record,
      // and the closed union is what makes it cost nothing rather than needing a
      // migration. Both must be ABSENT from the result, not merely defaulted — a store
      // that kept them would hand the layer an id `PALETTE_CHROME` has no entry for.
      controls: { x: 0, y: 0, edge: "right", collapsed: false, open: true },
      ghosts: { x: 10, y: 10, edge: null, collapsed: false, open: true },
    },
    hidden: true,
  });
  expect(salvaged.palettes.entities).toEqual(
    defaultWorkspace().palettes.entities,
  );
  expect(Object.keys(salvaged.palettes).sort()).toEqual([
    "entities",
    "flags",
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
  // Roughly what is on disk for anyone who used the editor before the log palette
  // existed: a v2 blob carrying one record and no `log` key at all. The version did NOT
  // change (nothing about the old shape became wrong), so this blob is read, not
  // orphaned — and every id it is missing has to arrive at its own default rather than
  // as `undefined`, which the layer would dereference on its first render. Distinct from
  // the retired-`controls` case above: that id is DROPPED, this one is FILLED IN.
  const restored = deserializeWorkspace({
    palettes: {
      entities: { x: 120, y: 60, edge: null, collapsed: false, open: true },
    },
    hidden: false,
  });
  expect(restored.palettes.entities.x).toBe(120);
  expect(restored.palettes.log).toEqual(defaultWorkspace().palettes.log);
});

// The Flags palette (F4.5b Task 13, D-F4.5-15). Its defaults are a claim about how the
// cockpit opens, and the two halves matter for different reasons.
test("the flags palette ships OPEN and floating", () => {
  const flags = defaultWorkspace().palettes.flags;
  // OPEN, unlike `log` and `history` beside it: the advisor runs on its own, so its
  // findings are the one thing on screen the user did not ask for. A palette they have
  // to go looking for is one that never gets read.
  expect(flags.open).toBe(true);
  // FLOATING (edge: null), the mock's arrangement — and not driven, so both its
  // geometry AND its open state are the user's to persist (contrast `session` below).
  expect(flags.edge).toBeNull();
  expect(PALETTES.flags.drivenOpen).toBeUndefined();
});

// --- the shipped defaults, compared to EACH OTHER ----------------------------
//
// Every default is chosen one palette at a time, and until now nothing compared them: the
// F4.5b machine smoke found the consequence on screen (the summoned History palette landed
// on the live session card's door rows) and the gate found the other by inspection (a long
// entity list reaches the Flags palette's default). These cases are that comparison, made
// once, over ALL of them — so the palette added next is measured against the four already
// here rather than against whichever corner its author remembered.

/** One palette's default claim on the cell: where it starts, how wide it renders, and how
 *  far down it may grow. `maxHeight: null` means it declares no extent budget — its content
 *  decides, so it may run to the bottom of the cell, and nothing below it in the same
 *  column can be proven clear of it. */
type DefaultClaim = {
  id: PaletteId;
  x: number;
  y: number;
  width: number;
  maxHeight: number | null;
};

const claims: DefaultClaim[] = PALETTE_IDS.map((id) => ({
  id,
  x: PALETTES[id].default.x,
  y: PALETTES[id].default.y,
  width: PALETTES[id].width,
  maxHeight: PALETTES[id].maxHeight ?? null,
}));

/** WHY this pair cannot collide, or `null` when nothing proves it — which is the failure
 *  the case below exists to produce. The KIND is named rather than a bare boolean because
 *  the two cases after it pin which proof each rider is paid by: a pair that starts passing
 *  for a different reason than the one its default was chosen for is worth reading. */
function separation(a: DefaultClaim, b: DefaultClaim): string | null {
  if (PALETTES[a.id].sharesCornerWith === b.id) return "declared";
  if (PALETTES[b.id].sharesCornerWith === a.id) return "declared";
  // DIFFERENT COLUMNS — the strongest proof available here, because it holds at every
  // height, and height is content: it is the one fact this module cannot know.
  if (a.x + a.width <= b.x || b.x + b.width <= a.x) return "columns";
  // SAME COLUMN, so the upper one has to say how far down it may grow, and stop above the
  // lower one's origin.
  const [upper, lower] = a.y <= b.y ? [a, b] : [b, a];
  if (upper.maxHeight !== null && upper.y + upper.maxHeight <= lower.y)
    return "extent";
  return null;
}

const pairs: (readonly [DefaultClaim, DefaultClaim])[] = claims.flatMap(
  (a, i) => claims.slice(i + 1).map((b) => [a, b] as const),
);

const proofFor = (a: PaletteId, b: PaletteId): string | null => {
  const [x, y] = [
    claims.find((c) => c.id === a),
    claims.find((c) => c.id === b),
  ];
  if (!x || !y) throw new Error(`no default claim for ${a} / ${b}`);
  return separation(x, y);
};

test("no two shipped defaults claim the same space", () => {
  // Computed from the shipped numbers rather than restated: a default moved onto another
  // reddens this, and the message NAMES the pair. Sabotage-proven by moving `history`
  // back into the session card's column, which reports `history × session`.
  const collisions = pairs
    .filter(([a, b]) => separation(a, b) === null)
    .map(([a, b]) => `${a.id} × ${b.id}`);
  expect(collisions).toEqual([]);
});

test("every shipped default fits the 1280×800 design floor", () => {
  // The pairwise case above is scale-free (both proofs are comparisons between defaults),
  // so this is the half that pins them to a real window: a third column is only a column
  // if the cell is wide enough to hold it.
  const overflow = claims
    .filter(
      (c) =>
        c.x + c.width > DESIGN_FLOOR_CELL.width ||
        c.y + (c.maxHeight ?? 0) >= DESIGN_FLOOR_CELL.height,
    )
    .map((c) => c.id);
  expect(overflow).toEqual([]);
});

test("the two gate riders are paid by the proof each default was chosen for", () => {
  // R21 — a long entity list reaching the Flags palette. They share the left column, so
  // the payment is an EXTENT: the entities list stops (and scrolls) above flags' origin
  // rather than growing through it.
  expect(proofFor("entities", "flags")).toBe("extent");
  // R27 — the summoned History palette landing on the live session card. Paid by COLUMNS
  // on purpose, and that is the whole design decision: the card's height is a form with an
  // expanding Advanced section, so any proof that depended on knowing it would be a guess.
  expect(proofFor("history", "session")).toBe("columns");
  // The one deliberate overlap in the arrangement, and the only pair allowed to answer
  // "declared": the log is summoned into the entities corner because a summon that lands
  // somewhere visible beats one tucked into whatever corner is free (it raises, and it
  // keeps the ⚠ chip lit while buried).
  expect(
    pairs
      .filter(([a, b]) => separation(a, b) === "declared")
      .map(([a, b]) => `${a.id} × ${b.id}`),
  ).toEqual(["entities × log"]);
});

// --- the keyboard move (D-26) and the resize projection ----------------------

test("a nudge steps by the delta and takes the DRAG's clamp with it", () => {
  const start = floatingAt(400, 200);

  expect(
    nudgePalette(start, "entities", { dx: 8, dy: 0 }, BOUNDS).palettes.entities
      .x,
  ).toBe(408);
  expect(
    nudgePalette(start, "entities", { dx: 0, dy: -32 }, BOUNDS).palettes
      .entities.y,
  ).toBe(168);

  // THE CLAMP, and it is the drag's rather than a second copy: a palette already against
  // the bottom cannot be stepped out of the cell. Without this a keyboard user walks a
  // palette off the screen one press at a time, with no drag to bring it back.
  const atBottom = movePalette(start, "entities", { x: 400, y: 4000 }, BOUNDS);
  expect(atBottom.palettes.entities.y).toBe(BOUNDS.maxY);
  expect(
    nudgePalette(atBottom, "entities", { dx: 0, dy: 32 }, BOUNDS).palettes
      .entities.y,
  ).toBe(BOUNDS.maxY);

  // …and the drag's EDGE SNAP with it: a step into the gutter docks, exactly as shoving
  // it there with the pointer does. One rule, so the keyboard cannot reach placements the
  // pointer cannot.
  const docked = nudgePalette(
    floatingAt(SNAP_PX + 4, 200),
    "entities",
    { dx: -8, dy: 0 },
    BOUNDS,
  );
  expect(docked.palettes.entities.edge).toBe("left");
  expect(docked.palettes.entities.x).toBe(0);
});

test("a nudge starts from where the palette IS, not from a stale stored x", () => {
  // Docked right against a WIDER cell than we are now in — a window that shrank between
  // sessions, or a dock performed before a resize. The renderer places a docked palette
  // FROM its edge and ignores the stored x, so that x is the one number on the record that
  // can disagree with the screen.
  const docked = movePalette(
    floatingAt(400, 200),
    "entities",
    { x: 900, y: 200 },
    { maxX: 900, maxY: 500 },
  );
  expect(docked.palettes.entities.edge).toBe("right");
  expect(docked.palettes.entities.x).toBe(900);

  // Now step it off that edge in a 700-wide cell. From the EDGE it is 700 − 40 = 660 and
  // it un-docks; from the stale 900 it is 860, which clamps to 700 and stays docked — the
  // palette would swallow the keypress and look broken.
  const stepped = nudgePalette(
    docked,
    "entities",
    { dx: -40, dy: 0 },
    { maxX: 700, maxY: 500 },
  );
  expect(stepped.palettes.entities.x).toBe(660);
  expect(stepped.palettes.entities.edge).toBeNull();
});

test("a shrunken cell projects a palette back into reach WITHOUT moving it", () => {
  // The F4.5a rider: a window that shrinks (or a blob restored into a smaller one) leaves
  // a palette outside the cell with no grip to grab. `deserializeWorkspace` cannot fix it
  // — bounds need a rendered size — so the layer projects at render time.
  const stranded: PaletteState = {
    x: 900,
    y: 400,
    edge: null,
    collapsed: false,
    open: true,
  };
  const shown = clampToCell(stranded, { maxX: 200, maxY: 100 });
  expect([shown.x, shown.y]).toEqual([200, 100]);
  // A VIEW of the record, not an edit of it. This is the whole mutate-vs-project decision:
  // storage still holds where the user put it.
  expect([stranded.x, stranded.y]).toEqual([900, 400]);

  // …so growing the window back returns the palette to where they put it, rather than
  // leaving it wherever the smallest window of the session happened to shove it. A
  // clamp that WROTE would have lost 900 permanently at the moment the window shrank.
  const grown = clampToCell(stranded, { maxX: 1000, maxY: 700 });
  expect([grown.x, grown.y]).toEqual([900, 400]);
  // Identity when nothing moved: the layer projects on every render, so a new record per
  // render would defeat the memo on everything downstream of it.
  expect(grown).toBe(stranded);

  // A DOCKED palette is placed from its edge, so the projection re-derives x from the
  // edge instead of clamping the stored one — and never clears `edge`. A projection that
  // ran the record through `movePalette` would un-dock it the moment the window grew,
  // because the stored x would then be far from the new right edge.
  const rightDocked: PaletteState = {
    x: 900,
    y: 40,
    edge: "right",
    collapsed: false,
    open: true,
  };
  const redocked = clampToCell(rightDocked, { maxX: 500, maxY: 700 });
  expect(redocked.x).toBe(500);
  expect(redocked.edge).toBe("right");
});

test("the projection's bounds keep the GRIP inside the cell, per palette width", () => {
  // The two axes are bounded by different facts, and the asymmetry is the honest one: the
  // width is declared (the layer renders it), so x gets the drag's own "the whole box
  // stays in" rule; the HEIGHT is content, so the most that can be promised is that the
  // header is still there to grab.
  const cell = { width: 1000, height: 600 };
  expect(cellBounds(cell, "entities")).toEqual({
    maxX: 1000 - PALETTES.entities.width,
    maxY: 600 - 32,
  });
  // Per palette, not one figure for all of them: a 380 px log and a 240 px history have
  // different right-most origins, and a shared number would strand one or clip the other.
  expect(cellBounds(cell, "history").maxX).toBe(1000 - PALETTES.history.width);
  expect(PALETTES.history.width).not.toBe(PALETTES.entities.width);
});

test("a closed flags palette stays closed across a restore", () => {
  // The other half of "not driven": a user who closes it has closed it. `session` is
  // the one palette whose `open` is forced back to its default here, and a flags entry
  // that accidentally acquired `drivenOpen` would re-open on every boot.
  const restored = deserializeWorkspace({
    palettes: {
      flags: { x: 10, y: 20, edge: null, collapsed: false, open: false },
    },
    hidden: false,
  });
  expect(restored.palettes.flags.open).toBe(false);
});

// The palette arrangement as pure data — no DOM here (safe in bare tests/, like
// persist.test.ts beside it). Every geometric rule the cockpit rests on is decided in
// this module: what a drag is allowed to do to a palette, when it docks, and what
// survives a hide-all. The LAYER only measures the cell and hands the numbers in.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cellBounds,
  clampBoxToCell,
  clampToCell,
  DESIGN_FLOOR_CELL,
  defaultWorkspace,
  deserializeWorkspace,
  GRIP_REACH_PX,
  growPalette,
  MIN_PALETTE_SIZE,
  movePalette,
  nudgePalette,
  PALETTE_IDS,
  PALETTES,
  type PaletteId,
  paletteBox,
  resizePalette,
  SNAP_PX,
  serializeWorkspace,
  setPaletteCollapsed,
  setPaletteOpen,
  setPalettesHidden,
  sizeBounds,
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

test("a DRIVEN-open palette restores the SIZE the user dragged", () => {
  // The rule is about ONE field. `open` is the editor's; everything else on the record is
  // the user's, and the size joined that list when palettes became resizable. A restore
  // that rebuilt this record from the default instead of overriding one field would
  // silently discard a card the user had widened to fit its form — and `session` is the
  // palette most likely to be widened, because its body is the only one that is a form.
  const restored = deserializeWorkspace({
    palettes: {
      session: {
        x: 100,
        y: 200,
        edge: null,
        collapsed: false,
        open: true,
        width: 420,
        height: 360,
      },
    },
    hidden: false,
  });
  expect(restored.palettes.session.width).toBe(420);
  expect(restored.palettes.session.height).toBe(360);
  expect(restored.palettes.session.open).toBe(false);
});

test("a hand-written null size fails the record rather than reading as unset", () => {
  // `isOptionalSize` is strict about what counts as absent, and the strictness is the claim
  // rather than an accident: nothing here ever writes a null (`JSON.stringify` omits an
  // undefined-valued property outright), so tolerating one would be a second spelling of
  // absence with no producer. A null in the blob is a hand edit or a foreign writer, which
  // is exactly what the whole-record fallback exists for — and reading it as "unset" would
  // silently accept a shape nothing in this module can produce.
  const restored = deserializeWorkspace({
    palettes: {
      // Boundary cast: the blob is JSON off localStorage, so its static type is what we
      // hope for rather than what a parse actually returns.
      flags: {
        x: 10,
        y: 20,
        edge: null,
        collapsed: false,
        open: true,
        width: null,
      } as unknown as PaletteState,
      history: { x: 30, y: 40, edge: null, collapsed: false, open: true },
    },
    hidden: false,
  });
  expect(restored.palettes.flags).toEqual(defaultWorkspace().palettes.flags);
  // One bad record costs only itself — the module's whole-record posture, unchanged.
  expect(restored.palettes.history.x).toBe(30);
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
        // An unbounded palette still has to get its GRIP inside the cell — that is the
        // floor its height has if it declares none, and it makes both axes the same
        // "does the box fit" question rather than one `>` and one `>=`.
        c.y + (c.maxHeight ?? GRIP_REACH_PX) > DESIGN_FLOOR_CELL.height,
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

test("an arrow can LEAVE a dock, even though one step is smaller than the gutter", () => {
  // The one place the keyboard CANNOT simply inherit the drag's rule, and it is a
  // difference in kind rather than in geometry: a pointer crosses the 24 px gutter in one
  // gesture, and an 8 px step never can. Without the departure enlargement below, a plain
  // arrow out of a dock re-snaps to the same edge and `movePalette` returns the identical
  // state — not a small move, a PERMANENT no-op with no re-render to hint at it, and ⇧ is
  // the only way out of a dock a keyboard user ever entered by accident.
  const docked = nudgePalette(
    floatingAt(SNAP_PX + 4, 200),
    "entities",
    { dx: -8, dy: 0 },
    BOUNDS,
  );
  expect(docked.palettes.entities.edge).toBe("left");

  const away = nudgePalette(docked, "entities", { dx: 8, dy: 0 }, BOUNDS);
  expect(away.palettes.entities.edge).toBeNull();
  // Just clear of the gutter, which is the smallest departure that IS one.
  expect(away.palettes.entities.x).toBe(SNAP_PX + 1);

  // The right edge answers identically — a rule that only knew about the left one would
  // pass every case above.
  const right = movePalette(
    floatingAt(400, 200),
    "entities",
    { x: BOUNDS.maxX, y: 200 },
    BOUNDS,
  );
  expect(right.palettes.entities.edge).toBe("right");
  const offRight = nudgePalette(right, "entities", { dx: -8, dy: 0 }, BOUNDS);
  expect(offRight.palettes.entities.edge).toBeNull();
  expect(offRight.palettes.entities.x).toBe(BOUNDS.maxX - (SNAP_PX + 1));

  // NARROW, and each of these is a way the enlargement could leak. Toward the edge it is
  // still a step (into the wall, so nothing moves and the state is returned unchanged);
  // ⇧ is already past the gutter and keeps its own size; a FREE palette never sees it; and
  // the Y axis never does, because there is no top or bottom dock to leave.
  expect(nudgePalette(docked, "entities", { dx: -8, dy: 0 }, BOUNDS)).toBe(
    docked,
  );
  expect(
    nudgePalette(docked, "entities", { dx: 32, dy: 0 }, BOUNDS).palettes
      .entities.x,
  ).toBe(32);
  expect(
    nudgePalette(floatingAt(400, 200), "entities", { dx: 8, dy: 0 }, BOUNDS)
      .palettes.entities.x,
  ).toBe(408);
  expect(
    nudgePalette(docked, "entities", { dx: 0, dy: 8 }, BOUNDS).palettes.entities
      .y,
  ).toBe(208);
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
  // width is a number this module can state without measuring (the layer renders exactly
  // it), so x gets the drag's own "the whole box stays in" rule; the HEIGHT is content, so
  // the most that can be promised is that the header is still there to grab.
  const cell = { width: 1000, height: 600 };
  const fresh = defaultWorkspace().palettes;
  expect(cellBounds(cell, "entities", fresh.entities)).toEqual({
    maxX: 1000 - PALETTES.entities.width,
    maxY: 600 - GRIP_REACH_PX,
  });
  // Per palette, not one figure for all of them: a 380 px log and a 240 px history have
  // different right-most origins, and a shared number would strand one or clip the other.
  expect(cellBounds(cell, "history", fresh.history).maxX).toBe(
    1000 - PALETTES.history.width,
  );
  expect(PALETTES.history.width).not.toBe(PALETTES.entities.width);
});

// --- the user's own size (the F4.5 gate ruling) ------------------------------
//
// The gate's defect was the Flags palette truncating 22 of its 25 coordinates, and the
// ruling made it one mechanism: a palette the user can size, whose size joins the D-3
// blob. The declared `width` and `maxHeight` stay — they are the DEFAULT and the proof
// the shipped arrangement rests on — and `paletteBox` is the one place the two are
// reconciled, which is what keeps the renderer and the projection reading one number.

test("an unsized palette renders its declared default, size and extent both", () => {
  const geom = defaultWorkspace().palettes.entities;
  // No user size on a fresh record — that is what "reset clears it" is, by construction
  // rather than by a clearing step, and what makes "has the user sized this?" answerable
  // without comparing floats to the declared numbers.
  expect(geom.width).toBeUndefined();
  expect(geom.height).toBeUndefined();
  expect(paletteBox("entities", geom)).toEqual({
    width: PALETTES.entities.width,
    height: null,
    // The extent is still a CEILING here: an entities palette with two rows is two rows
    // tall, capped at 320. Reading "the cap becomes the default size" as a literal height
    // would render every fresh palette as a mostly-empty 320 px box.
    extent: PALETTES.entities.maxHeight ?? null,
  });
  // A palette that declares no extent says so, rather than inheriting one. `session` is
  // the one that does not: it is a label-column FORM with an expanding Advanced section,
  // not a list, so there is no "ten rows" for a budget to be about — every other palette
  // holds a list and every other palette declares one.
  expect(
    paletteBox("session", defaultWorkspace().palettes.session).extent,
  ).toBeNull();
});

test("a user size overrides the width, and the extent stops being a ceiling", () => {
  const bounds = { maxWidth: 900, maxHeight: 700 };
  const sized = resizePalette(
    defaultWorkspace(),
    "entities",
    {
      width: 520,
      height: 600,
    },
    bounds,
  );
  expect(paletteBox("entities", sized.palettes.entities)).toEqual({
    width: 520,
    height: 600,
    // THE RULING, in one assertion: 320 was the default size, not a ceiling, so a user
    // who has sized this palette is not capped by it any more.
    extent: null,
  });
  // Purely additive on the record — a resize is not a move.
  const before = defaultWorkspace().palettes.entities;
  expect(sized.palettes.entities.x).toBe(before.x);
  expect(sized.palettes.entities.y).toBe(before.y);
  expect(sized.palettes.entities.edge).toBe(before.edge);
  // One axis at a time is a real case (the width handle on a palette never sized
  // vertically), so height stays null and the extent survives.
  const wideOnly = resizePalette(
    defaultWorkspace(),
    "entities",
    {
      width: 520,
      height: PALETTES.entities.maxHeight ?? 0,
    },
    bounds,
  );
  expect(paletteBox("entities", wideOnly.palettes.entities).height).toBe(320);
});

test("resize clamps to the grip floor and to the cell, and is identity when it changes nothing", () => {
  const start = defaultWorkspace();
  const bounds = { maxWidth: 900, maxHeight: 700 };

  // THE FLOOR, which is the scope guard's whole "keep the grip reachable": a palette
  // dragged to nothing would take its own header with it (the box is `overflow-hidden`),
  // and the header is the only thing that moves it back.
  const tiny = resizePalette(
    start,
    "entities",
    { width: 4, height: 4 },
    bounds,
  );
  expect(tiny.palettes.entities.width).toBe(MIN_PALETTE_SIZE.width);
  expect(tiny.palettes.entities.height).toBe(MIN_PALETTE_SIZE.height);

  // THE CEILING is the cell, for the same reason: the resize handle rides the palette's
  // far corner, so a palette sized past the cell puts the one control that could shrink
  // it out of reach.
  const huge = resizePalette(
    start,
    "entities",
    {
      width: 5000,
      height: 5000,
    },
    bounds,
  );
  expect(huge.palettes.entities.width).toBe(900);
  expect(huge.palettes.entities.height).toBe(700);

  // A cell smaller than the floor: the floor wins, exactly as `movePalette`'s clamp pins
  // to 0 when both maxima go negative. Un-grabbable-but-present beats absent.
  const cramped = resizePalette(
    start,
    "entities",
    {
      width: 300,
      height: 300,
    },
    { maxWidth: 10, maxHeight: 10 },
  );
  expect(cramped.palettes.entities.width).toBe(MIN_PALETTE_SIZE.width);

  // The sibling discipline: a resize that resolves to the size already stored hands back
  // the SAME state. A drag against a clamped edge produces one of these per pointer
  // event, and each new record re-renders the layer and re-arms the persist debounce.
  const sized = resizePalette(
    start,
    "entities",
    {
      width: 520,
      height: 600,
    },
    bounds,
  );
  expect(
    resizePalette(sized, "entities", { width: 520, height: 600 }, bounds),
  ).toBe(sized);
  expect(
    resizePalette(sized, "entities", { width: 9000, height: 9000 }, bounds),
  ).not.toBe(sized);
  // Pure: the input state is untouched.
  expect(start.palettes.entities.width).toBeUndefined();
});

test("the size a palette may reach is the cell it can still be grabbed in", () => {
  const cell = { width: 1000, height: 600 };
  const free = { ...defaultWorkspace().palettes.entities, x: 240, y: 100 };
  // A FREE palette grows right and down from where it sits, so the cell's far edges are
  // what it may reach.
  expect(sizeBounds(cell, free)).toEqual({ maxWidth: 760, maxHeight: 500 });

  // A DOCKED one is placed FROM its edge and ignores its stored x — the same fact
  // `clampToCell` and `nudgePalette` already turn on — so it may grow to fill the cell
  // whatever that stale x says. A bound computed from `x` would let a right-docked
  // palette that was docked in a wider window grow to a negative width.
  const docked = { ...free, x: 900, edge: "right" as const };
  expect(sizeBounds(cell, docked).maxWidth).toBe(1000);
  expect(
    sizeBounds(cell, { ...free, x: 0, edge: "left" as const }).maxWidth,
  ).toBe(1000);
});

test("the projection's bounds follow the LIVE width, not the declared one", () => {
  // THE INVARIANT the four placement rules rest on. `cellBounds` derives the projection's
  // bounds, `PaletteLayer.measureBounds` derives the drag's by MEASURING the palette, and
  // on x they have to agree exactly — which they do only while the number `cellBounds`
  // subtracts is the number the layer renders. `paletteBox` is that one number, and this
  // case is what catches a `cellBounds` that went back to reading `PALETTES[id].width`.
  const cell = { width: 1000, height: 600 };
  const fresh = defaultWorkspace().palettes.entities;
  expect(cellBounds(cell, "entities", fresh).maxX).toBe(
    1000 - PALETTES.entities.width,
  );

  const sized = resizePalette(
    defaultWorkspace(),
    "entities",
    {
      width: 520,
      height: 600,
    },
    { maxWidth: 900, maxHeight: 700 },
  ).palettes.entities;
  expect(cellBounds(cell, "entities", sized).maxX).toBe(1000 - 520);
  expect(cellBounds(cell, "entities", sized).maxX).toBe(
    cell.width - paletteBox("entities", sized).width,
  );
  // The Y axis is unchanged and deliberately weaker — the projection runs without
  // measuring anything, so a grip is the strongest honest promise on that axis even for a
  // palette whose height the user HAS set.
  expect(cellBounds(cell, "entities", sized).maxY).toBe(600 - GRIP_REACH_PX);
});

test("a user's size never enters the default-arrangement proof (D-3)", () => {
  // The pairwise check reasons about the SHIPPED defaults and must keep doing so: a user
  // arrangement is theirs to overlap, and a proof that read live sizes would redden on
  // somebody widening a palette in their own editor.
  const sized = resizePalette(
    defaultWorkspace(),
    "entities",
    {
      width: 1000,
      height: 1000,
    },
    { maxWidth: 4000, maxHeight: 4000 },
  );
  expect(sized.palettes.entities.width).toBe(1000);
  // The claims are computed from `PALETTES`, which the resize cannot reach…
  expect(claims.find((c) => c.id === "entities")).toEqual({
    id: "entities",
    x: 24,
    y: 24,
    width: 360,
    maxHeight: 320,
  });
  expect(proofFor("entities", "flags")).toBe("extent");
  // …while the PROJECTION, which is presentation rather than proof, follows the user.
  expect(
    cellBounds(
      { width: 1200, height: 900 },
      "entities",
      sized.palettes.entities,
    ).maxX,
  ).toBe(200);
});

test("a user size round-trips through the blob, and an old blob without one is the default", () => {
  const sized = resizePalette(
    defaultWorkspace(),
    "flags",
    {
      width: 460,
      height: 520,
    },
    { maxWidth: 900, maxHeight: 700 },
  );
  const blob = serializeWorkspace(sized);
  expect(JSON.parse(JSON.stringify(blob))).toEqual(blob);
  const back = deserializeWorkspace(JSON.parse(JSON.stringify(blob)));
  expect(back.palettes.flags.width).toBe(460);
  expect(back.palettes.flags.height).toBe(520);

  // EVERY blob written before this shipped is this case, and it must cost nothing: no
  // size means never resized means the declared default. That is the whole migration.
  const old = deserializeWorkspace({
    palettes: {
      flags: { x: 10, y: 20, edge: null, collapsed: false, open: true },
    },
    hidden: false,
  });
  expect(old.palettes.flags.width).toBeUndefined();
  expect(paletteBox("flags", old.palettes.flags).width).toBe(
    PALETTES.flags.width,
  );

  // A size that is not a number costs the record, not just the size — the module's
  // existing whole-record posture, so one bad palette still costs only itself.
  const corrupt = deserializeWorkspace({
    palettes: {
      // Boundary cast: the blob is JSON off localStorage, so its static type is what we
      // hope for rather than what a parse actually returns.
      flags: {
        x: 10,
        y: 20,
        edge: null,
        collapsed: false,
        open: true,
        width: "wide",
      } as unknown as PaletteState,
      history: { x: 30, y: 40, edge: null, collapsed: false, open: true },
    },
    hidden: false,
  });
  expect(corrupt.palettes.flags).toEqual(defaultWorkspace().palettes.flags);
  expect(corrupt.palettes.history.x).toBe(30);

  // Reset drops it, because a fresh record simply has no such field.
  expect(defaultWorkspace().palettes.flags.width).toBeUndefined();
});

test("a stored size below the floor is SHOWN at the floor, not clipped away", () => {
  // The read side of the resize's clamp, and it is a projection in exactly `clampToCell`'s
  // sense: `resizePalette` clamps what gets STORED, `paletteBox` pins what gets SHOWN.
  //
  // It is not dead code, because the writer is not the only source. `deserializeWorkspace`
  // deliberately does not clamp — a blob is hand-editable JSON off localStorage, and a size
  // written by a build whose floor was smaller is the same case. Without this a 4 px palette
  // renders as 4 px, which (the box being `overflow-hidden`) clips away its own header: the
  // grip that moves it, the chevron that rails it and the × that closes it, all at once.
  const stunted = deserializeWorkspace({
    palettes: {
      flags: {
        x: 10,
        y: 20,
        edge: null,
        collapsed: false,
        open: true,
        width: 4,
        height: 4,
      },
    },
    hidden: false,
  });
  // Restored verbatim — the record is the user's intent, and this module does not rewrite
  // it any more than `clampToCell` rewrites a stranded position.
  expect(stunted.palettes.flags.width).toBe(4);
  const box = paletteBox("flags", stunted.palettes.flags);
  expect([box.width, box.height]).toEqual([
    MIN_PALETTE_SIZE.width,
    MIN_PALETTE_SIZE.height,
  ]);
  // …and the projection agrees with what is rendered, which is the x-axis invariant: a
  // `cellBounds` computed off the raw 4 would let the palette hang a floor's width out of
  // the cell.
  expect(
    cellBounds({ width: 1000, height: 600 }, "flags", stunted.palettes.flags)
      .maxX,
  ).toBe(1000 - MIN_PALETTE_SIZE.width);
});

test("the size floor counts the same box on both axes", () => {
  // The palette section is `border border-border` — 1 px on ALL FOUR sides — under
  // `box-sizing: border-box`, so a 33 px header only fits inside a 35 px box. The WIDTH
  // figure has always counted those two pixels (`1 * 2` in its sum); the HEIGHT was the bare
  // header, so a palette dragged to its own floor clipped 2 px off the one control that
  // drags it back, under the section's `overflow-hidden`.
  //
  // Asserted as the RELATIONSHIP rather than as 35 and 99, so a header that grows a fourth
  // control moves both figures together instead of leaving one behind — which is exactly
  // how the two came apart.
  const SECTION_BORDERS = 1 * 2;
  expect(MIN_PALETTE_SIZE.height).toBe(GRIP_REACH_PX + SECTION_BORDERS);
  expect(MIN_PALETTE_SIZE.width).toBe(
    GRIP_REACH_PX + SECTION_BORDERS + 8 * 2 + 20 * 2 + 4 * 2,
  );
});

// --- a cell that cannot hold the palette --------------------------------------

test("a cell with no room to place a palette has no edge to dock it to", () => {
  // `edgeAt` reads a gutter off `maxX`, and `maxX` goes NEGATIVE the moment a palette is
  // wider than the cell — which the resize made newly reachable, because `maxX` now
  // subtracts the USER's width rather than a declared one under 380. The gutter test then
  // fails (`0 > 24` is false) and the tie-break inverts (`0 <= -300` is false), so a
  // free palette silently docked RIGHT: it lost its border and its rounded corner, started
  // rendering from `right: 0`, and re-docked on every further drag until the window grew
  // back past the stored width. A WRITE of `edge` into the persisted blob, from a gesture
  // that could not move the palette at all.
  const start = floatingAt(400, 200);
  const shoved = movePalette(
    start,
    "entities",
    { x: 300, y: 100 },
    { maxX: -300, maxY: 400 },
  );
  expect(shoved.palettes.entities.edge).toBeNull();
  expect(shoved.palettes.entities.x).toBe(0);

  // `maxX === 0` is the same case and not a boundary worth splitting: every x resolves to
  // 0, so "which edge did the user shove it toward" has no answer, and recording one is a
  // write of a fact the gesture did not contain.
  expect(
    movePalette(start, "entities", { x: 50, y: 100 }, { maxX: 0, maxY: 400 })
      .palettes.entities.edge,
  ).toBeNull();

  // One pixel of room is a cell that CAN place it, and it docks exactly as before — the
  // guard is about "no position to choose", not about narrow cells.
  expect(
    movePalette(start, "entities", { x: 0, y: 100 }, { maxX: 1, maxY: 400 })
      .palettes.entities.edge,
  ).toBe("left");
});

test("a palette wider than the cell is SHOWN narrower, and keeps the size the user set", () => {
  // `clampToCell`'s twin, and the same mutate-vs-project decision. Without it the handle —
  // welded to the box's far corner — sits outside the cell after a shrink, and `Shell` is
  // `fixed inset-0`, so nothing scrolls to reach it: the one control that could shrink the
  // palette is gone until the window grows back.
  const sized = resizePalette(
    defaultWorkspace(),
    "flags",
    { width: 1200 },
    { maxWidth: 1376, maxHeight: 700 },
  ).palettes.flags;
  expect(sized.width).toBe(1200);

  const cell = { width: 800, height: 600 };
  const shown = clampToCell(sized, cellBounds(cell, "flags", sized));
  // The origin projection pins it to 0 (the cell cannot hold the box at any x)…
  expect(shown.x).toBe(0);
  // …and the SIZE projection is what brings the far corner back inside.
  const box = clampBoxToCell(
    paletteBox("flags", sized),
    sizeBounds(cell, shown),
  );
  expect(box.width).toBe(800);
  // A VIEW, not an edit: storage still holds what the user dragged, so growing the window
  // back gives it to them. A clamp that WROTE would have lost 1200 at the moment of a
  // window resize the user never aimed at this palette.
  expect(sized.width).toBe(1200);
  expect(
    clampBoxToCell(
      paletteBox("flags", sized),
      sizeBounds({ width: 1400, height: 900 }, sized),
    ).width,
  ).toBe(1200);

  // Identity when nothing is clamped — the layer projects per render, so a fresh object
  // every time would defeat every memo downstream (`clampToCell`'s discipline).
  const roomy = paletteBox("flags", sized);
  expect(clampBoxToCell(roomy, { maxWidth: 2000, maxHeight: 900 })).toBe(roomy);

  // The FLOOR still wins over the cell, exactly as it does on the write side: a cell too
  // small for a usable palette gets an un-grabbable-but-present one rather than none.
  expect(clampBoxToCell(roomy, { maxWidth: 10, maxHeight: 900 }).width).toBe(
    MIN_PALETTE_SIZE.width,
  );
});

// --- one gesture, one axis ---------------------------------------------------

test("a step on ONE axis writes ONE axis — a width press never pins a height", () => {
  // `RESIZE_KEYS` hands this verb a per-key vector, so `ArrowRight` arrives as
  // `dh: 0`. Writing a height anyway made `paletteBox` return `extent: null` plus a fixed
  // number, and the palette stopped being content-sized FOREVER — from a press that moved
  // only x. The cost is loudest on the session card, whose body is a form with an
  // expanding Advanced section: widen it and expanding Advanced scrolls inside a short box
  // where before it grew the palette.
  //
  // A corner DRAG pinning both is still right, and still what happens — the difference is
  // that a gesture now says which axes it moved instead of the store assuming both.
  const start = defaultWorkspace();
  const measured = { height: 240, bounds: { maxWidth: 900, maxHeight: 700 } };

  const wider = growPalette(start, "entities", { dw: 8, dh: 0 }, measured);
  expect(wider.palettes.entities.width).toBe(PALETTES.entities.width + 8);
  expect(wider.palettes.entities.height).toBeUndefined();
  // …so the declared extent is still what governs its height, which is the whole point:
  // nothing about this palette's vertical behaviour changed.
  expect(paletteBox("entities", wider.palettes.entities).extent).toBe(320);

  // The other axis answers identically, and it is the case that proves the guard is a
  // per-axis one rather than "never write height".
  const taller = growPalette(start, "entities", { dw: 0, dh: 8 }, measured);
  expect(taller.palettes.entities.width).toBeUndefined();
  expect(taller.palettes.entities.height).toBe(248);

  // A press on an axis the user HAS already sized leaves that size alone rather than
  // clearing it — "the gesture did not move this axis" means keep, not reset.
  const both = growPalette(taller, "entities", { dw: 8, dh: 0 }, measured);
  expect(both.palettes.entities.height).toBe(248);
  expect(both.palettes.entities.width).toBe(PALETTES.entities.width + 8);
});

test("a step's start height is the RECORD's, and the measurement is only its fallback", () => {
  // `measured` carries two things and only one of them is a fallback. `measured.height` is
  // the palette's CONTENT height — the one size fact this module cannot state — and it is
  // needed exactly while the user has never set a height. `measured.bounds` is the cell,
  // and every call clamps to it.
  const measured = { height: 240, bounds: { maxWidth: 900, maxHeight: 700 } };

  // No stored height: the measurement is the only true answer, so the step comes off it.
  expect(
    growPalette(defaultWorkspace(), "entities", { dw: 0, dh: 8 }, measured)
      .palettes.entities.height,
  ).toBe(248);

  // With one stored, the measurement is IGNORED. A burst of presses has to compound off
  // the size the user is at rather than off whatever the box measures mid-gesture — and a
  // substitute for this fallback is invisible to a DOM that runs no layout, where every
  // measurement is zero and every result floors.
  const sized = resizePalette(
    defaultWorkspace(),
    "entities",
    { height: 500 },
    measured.bounds,
  );
  expect(
    growPalette(sized, "entities", { dw: 0, dh: 8 }, measured).palettes.entities
      .height,
  ).toBe(508);

  // …while `measured.bounds` applies to that same call, which is what "ignored entirely"
  // would have got wrong.
  expect(
    growPalette(
      sized,
      "entities",
      { dw: 0, dh: 8 },
      {
        height: 240,
        bounds: { maxWidth: 900, maxHeight: 300 },
      },
    ).palettes.entities.height,
  ).toBe(300);
});

test("a resize target may name ONE axis, and the other is untouched", () => {
  // `growPalette`'s half above goes through this verb, and a pointer that has moved on one
  // axis only uses it directly (`Palette.onHandleMove`). An absent axis is "leave it",
  // which is distinct from both "clamp it" and "clear it".
  const bounds = { maxWidth: 900, maxHeight: 700 };
  const sized = resizePalette(
    defaultWorkspace(),
    "flags",
    { width: 460, height: 520 },
    bounds,
  );
  const widerOnly = resizePalette(sized, "flags", { width: 500 }, bounds);
  expect([
    widerOnly.palettes.flags.width,
    widerOnly.palettes.flags.height,
  ]).toEqual([500, 520]);
  // …and on a palette that has no height, naming only the width still leaves it unset.
  const fresh = resizePalette(
    defaultWorkspace(),
    "flags",
    { width: 500 },
    bounds,
  );
  expect(fresh.palettes.flags.height).toBeUndefined();
  // The identity discipline survives it: a one-axis target that changes nothing is still
  // the same state, so a drag along a clamped edge does not re-arm the persist debounce.
  expect(resizePalette(widerOnly, "flags", { width: 500 }, bounds)).toBe(
    widerOnly,
  );
  // An EMPTY target is the degenerate case of the same rule.
  expect(resizePalette(widerOnly, "flags", {}, bounds)).toBe(widerOnly);
});

// --- ONE ceiling per palette, and it is the DECLARED one ---------------------

test("every palette that caps its height declares it, and a resize drops it", () => {
  // THE SECOND CEILING, which is the one that used to win. Three palette bodies capped
  // their own list with a Tailwind `max-h-64` (256 px) INSIDE a palette whose body is
  // already `min-h-0 flex-1 overflow-y-auto` — invisible to `paletteBox`, to
  // `separation()` and to the pairwise proof, and therefore invisible to the resize as
  // well. Dragging any of the three taller added empty space under a list still stopped
  // at ten rows, which falsifies the ruling's own clause for `log` (one of the two
  // palettes whose declared extent it says "stops being a ceiling").
  //
  // An extent has ONE home. These four are the palettes that hold a scrolling list; each
  // states its budget where the module can read it.
  const fresh = defaultWorkspace().palettes;
  expect(paletteBox("entities", fresh.entities).extent).toBe(320);
  expect(paletteBox("log", fresh.log).extent).toBe(320);
  expect(paletteBox("history", fresh.history).extent).toBe(320);
  // 350 rather than 320: this palette's body puts TWO rows above its list (the candidate
  // count, then the filter chips) where the others put one, so the same ten locator rows
  // need 30 px more palette. See `PALETTES.flags`.
  expect(paletteBox("flags", fresh.flags).extent).toBe(350);

  // …and every one of them drops that budget the moment the user sets a height. This is
  // the clause a cap inside the body defeated: dragging taller must show more ROWS.
  for (const id of ["entities", "flags", "history", "log"] as const) {
    const sized = resizePalette(
      defaultWorkspace(),
      id,
      { width: 400, height: 600 },
      { maxWidth: 900, maxHeight: 700 },
    );
    expect([id, paletteBox(id, sized.palettes[id]).extent]).toEqual([id, null]);
  }
});

/** Every module that renders a palette BODY, as source text.
 *
 *  A CLASS SCAN, and `frontend-focus-vocabulary.test.ts` makes the argument for the
 *  instrument at length: happy-dom runs no layout, so nothing in `bun test` can see a
 *  height. What a scan CAN hold is the authored fact, and a second ceiling is exactly
 *  that — a `max-h-*` written into a palette body, where the store can never see it.
 *
 *  Scoped to the two directories palette bodies live in rather than to a list of the five,
 *  so a body that delegates its list to a `field/` module (`EntitiesPalette` →
 *  `EntitiesList`) is covered too, and so is the sixth palette. */
const BODY_DIRS = ["shell", "field"] as const;

/** The three surfaces in `shell/` that are NOT palettes, and whose own caps are theirs.
 *  Named rather than pattern-matched: a cap is a decision, and a file that wants one has
 *  to appear on this line. */
const NOT_A_PALETTE = ["Toasts.tsx", "WorldDrawer.tsx", "ShortcutsDialog.tsx"];

test("no palette body caps its own height — the ceiling lives in PALETTES", () => {
  const root = join(import.meta.dir, "..", "src", "frontend", "components");
  const offenders = BODY_DIRS.flatMap((dir) =>
    readdirSync(join(root, dir))
      .filter((f) => f.endsWith(".tsx") && !NOT_A_PALETTE.includes(f))
      .filter((f) =>
        // Comments stripped first: this rule is a class NAME, and the prose in these files
        // discusses it. Stripping can only LOSE text, so it under-reports rather than
        // inventing an offender.
        /\bmax-h-/.test(
          readFileSync(join(root, dir, f), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^[ \t]*\/\/.*$/gm, ""),
        ),
      )
      .map((f) => `${dir}/${f}`),
  );
  expect(offenders).toEqual([]);
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

// The action TABLE: what each entry says it is, what it names, when it refuses, and what
// running it actually calls. Pure — `KeyboardEvent` is a type only here, so this file
// deliberately does NOT import the happy-dom harness (registering it from a top-level
// tests/ file poisons the daemon/bundle/GPU suites — see tests/chrome/keybindings-dom.ts).
//
// Its sibling `tests/keybindings.test.ts` owns the other half: which EVENT reaches which
// entry, and the gate that refuses it.
//
// ONE case here is not about the table at all: the single-funnel guard at the foot reads
// `src/` off disk, the way the two leakage guards do. It sits here rather than with them
// because the invariant it holds is this file's subject — who may call `ToolFamilyMember.arm`
// — and its own comment carries why a source scan is the only instrument for it.
import { afterEach, expect, type mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  ActionResult,
  RefusalClass,
} from "../src/action-registry/index.ts";
import type { FieldEntityInfo } from "../src/field-host/index.ts";
import {
  ACTION_GROUPS,
  ACTIONS,
  type ActionGroup,
  type ActionId,
  byId,
  capOf,
  clickGate,
  controlVerdict,
  type GateEnv,
  groupTitle,
  runAction,
  runMember,
  runNamed,
  TOOL_FAMILIES,
  type ToolFamily,
  type ToolFamilyMember,
} from "../src/frontend/lib/actions.ts";
import { notify } from "../src/frontend/lib/notify-store.ts";
// The traversal, shared with the two leakage guards — the RULE stays here, where the
// argument for it is.
import { walk } from "./_source-scan.ts";

/** A keypress with nothing standing in its way, and a control activation. The two caller
 *  classes, spelled once — `keybindings.test.ts` owns what each REFUSES; these cases are
 *  about what the funnel does once one of them is through. */
const KEY = {
  caller: "key",
  inTextInput: false,
  confirmOpen: false,
  looking: false,
} as const satisfies GateEnv;
const NAMED = {
  caller: "named",
  confirmOpen: false,
} as const satisfies GateEnv;

import { makeCtx, type makeHostSpy } from "./_actions-fixture.ts";

// The notify store is a module singleton (one editor, one log), so a sentence raised by one
// case would still be standing in the next — and half the funnel cases below assert that
// NOTHING was said. Cleared between, the way `world-actions.test.ts` clears it.
afterEach(() => notify.clear());

/** Every sentence the store is holding, newest first. */
const said = (): string[] => notify.getSnapshot().log.map((m) => m.text);

/** The {@link RefusalClass} a result refuses with, or what it did INSTEAD — `"ok"` or
 *  `"failed"`. One narrowing, spelled once, so a case that is about the class can name the
 *  class it expects instead of walking the union at every call; and answering the other two
 *  outcomes rather than `null` is what makes a failure message say which of them happened.
 *
 *  The RETURN TYPE is the vocabulary, not `string`: a case expecting a class that does not
 *  exist — a typo, or a name the union dropped — is then a compile error rather than a
 *  runtime diff nobody reads until it fires. */
const whyRefused = (result: ActionResult): RefusalClass | "ok" | "failed" => {
  if (result.ok) return "ok";
  if (result.kind !== "refused") return result.kind;
  return result.because;
};

const entity = (over: Partial<FieldEntityInfo> = {}): FieldEntityInfo =>
  ({
    entityId: 7,
    type: "generator",
    generator: "hall",
    params: {},
    seed: 1,
    region: { min: [0, 0, 0], max: [1, 1, 1] },
    opSpan: [2, 5],
    placed: [],
    ...over,
  }) as FieldEntityInfo;

// --- the table's own shape --------------------------------------------------

test("every action id is unique, and names its own group", () => {
  const ids = ACTIONS.map((a) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
  // `group.verb` is what makes an id readable in a menu-order assertion or a failure
  // message without a lookup — and the burger renders BY group, so an id whose prefix
  // lies puts the item somewhere its name does not predict.
  for (const a of ACTIONS)
    expect({ id: a.id, prefixed: a.id.startsWith(`${a.group}.`) }).toEqual({
      id: a.id,
      prefixed: true,
    });
});

test("every group an action names is in ACTION_GROUPS — nothing renders headless", () => {
  // Three surfaces render the table BY group and take the heading from this list (the
  // burger, the shortcuts overlay, the command palette). A group present in the union but
  // missing from the list would render its rows under a blank heading in one of them and
  // vanish entirely from another, and the type system cannot catch it: the list is
  // ordered, so it is an array rather than an exhaustive Record.
  const listed = ACTION_GROUPS.map((g) => g.id);
  expect(new Set(listed).size).toBe(listed.length);
  for (const a of ACTIONS)
    expect({ id: a.id, listed: listed.includes(a.group) }).toEqual({
      id: a.id,
      listed: true,
    });
  for (const g of ACTION_GROUPS) expect(g.title).toBeTruthy();
});

test("the two lookups THROW rather than answer nullably", () => {
  // Both exist so a surface naming one action or one group fails LOUDLY when the name
  // moves, instead of rendering an empty keycap or a heading-less menu section. Pinned
  // because a guard nothing exercises is a guard nobody knows is wrong: the previous
  // round shipped `ACTIONS.find(...)?.keys` and `ACTION_GROUPS.find(...)?.title`, both of
  // which render blank on a miss.
  expect(byId("view.commandPalette").id).toBe("view.commandPalette");
  // The cast IS the scenario, exactly as the `groupTitle` half below says of its own: `byId`
  // narrowed to `ActionId` in T3b2 Task 4, so the only caller that can still miss is one
  // naming an id that is deliberately not there.
  expect(() => byId("view.nope" as ActionId)).toThrow(/no action "view.nope"/);
  expect(groupTitle("tool")).toBe("Tools");
  // A group outside the union is the case the type system cannot reach and the array
  // cannot prove — the cast IS the scenario (a group added to `ActionGroup` and forgotten
  // in `ACTION_GROUPS` looks exactly like this at runtime).
  expect(() => groupTitle("nope" as ActionGroup)).toThrow(
    /not in ACTION_GROUPS/,
  );
});

test("the command palette is a registry action, not a surface with its own key", () => {
  const def = byId("view.commandPalette");
  // ⌘K on the same `chord` gate as ⌘S and ⌘Z — live inside a text field, because the
  // palette is how you get out of a panel you are typing in.
  expect({ keys: capOf(def), gate: def.gate, group: def.group }).toEqual({
    keys: "⌘K",
    gate: "chord",
    group: "view",
  });
  // Never refused and never inert: it reaches the whole table, and the state where
  // nothing can run is the state where seeing every verb and its reason helps most.
  expect(def.enabled(makeCtx())).toBe(true);
  const ctx = makeCtx();
  def.run(ctx);
  // Its OWN funnel, not `summonPalette` — it is a modal dialog, not a member of the
  // floating arrangement, so `⌘\` cannot hide it and nothing persists it.
  expect(
    ctx.run.openCommandPalette as ReturnType<typeof mock>,
  ).toHaveBeenCalledTimes(1);
  expect(
    ctx.run.summonPalette as ReturnType<typeof mock>,
  ).not.toHaveBeenCalled();
});

test("the shortcuts overlay is a registry action on a bare key, in its own Help group", () => {
  // The holistic gate's ruling 3: `?` opens the overlay "through the same bare-letter gate
  // as every other key". A registry action is the only thing that gate exists for — a
  // window listener of the burger's own would be a second key owner, which the ownership
  // rule at the top of `lib/actions.ts` forbids outright.
  const def = byId("help.shortcuts");
  expect({
    keys: capOf(def),
    gate: def.gate,
    group: def.group,
    // Never refused: an overlay that lists every binding is most useful in the state where
    // the user cannot work out which key does what.
    enabled: def.enabled(makeCtx()),
  }).toEqual({ keys: "?", gate: "typed", group: "help", enabled: true });

  // Its OWN funnel, like the ⌘K palette's beside it — the shell owns the dialog, so the
  // action cannot reach it any other way. NOT `summonPalette`: this is a modal dialog, not
  // a member of the floating arrangement, and NOT `openCommandPalette`, which is a
  // different surface (a run that raised the wrong one reads identically in the menu).
  const ctx = makeCtx();
  def.run(ctx);
  expect(
    ctx.run.openShortcuts as ReturnType<typeof mock>,
  ).toHaveBeenCalledTimes(1);
  expect(
    ctx.run.openCommandPalette as ReturnType<typeof mock>,
  ).not.toHaveBeenCalled();
  expect(
    ctx.run.summonPalette as ReturnType<typeof mock>,
  ).not.toHaveBeenCalled();
});

test("Help is a group of its OWN, so the overlay and ⌘K head it rather than filing it under View", () => {
  // A group rather than a `view` row, and the reason is the burger: `view` is rendered as a
  // SUBMENU from the table, so a shortcuts row in it would be the item's second home —
  // the burger renders this one itself (its select hands focus to the dialog, which a
  // registry row cannot express). One group, one home, no duplicate.
  expect(groupTitle("help")).toBe("Help");
  // LAST in the order every surface that lists all the groups uses. Asserted rather than
  // assumed: `ACTION_GROUPS`' own doc makes the order data, and Help trailing is what puts
  // the editor's verbs above the documentation about them.
  expect(ACTION_GROUPS.at(-1)?.id).toBe("help");
  // Exactly one action in it. The claim is not the number for its own sake — it is that
  // `help` is not a place where things get filed: a second verb landing here should be a
  // decision someone makes on purpose, in this test.
  expect(ACTIONS.filter((a) => a.group === "help").map((a) => a.id)).toEqual([
    "help.shortcuts",
  ]);
});

test("every displayed chord is unique — one key, one action", () => {
  const keys = ACTIONS.flatMap((a) => {
    const cap = capOf(a);
    return cap === undefined ? [] : [cap];
  });
  expect(new Set(keys).size).toBe(keys.length);
});

test("a binding and a gate are declared together — a binding with no gate could not be refused", () => {
  for (const a of ACTIONS)
    expect({
      id: a.id,
      paired: (a.keys === undefined) === (a.gate === undefined),
    }).toEqual({ id: a.id, paired: true });
});

test("every keyed action carries its keycap and its overlay sentence", () => {
  // The overlay renders `keys` + `hint`; an action reachable from the keyboard with
  // neither is a binding that cannot be discovered.
  for (const a of ACTIONS) {
    const cap = capOf(a);
    if (cap === undefined) continue;
    expect({ id: a.id, keys: cap, hint: typeof a.hint }).toEqual({
      id: a.id,
      keys: cap,
      hint: "string",
    });
    expect(cap).toBeTruthy();
  }
});

// --- labels contextualize ---------------------------------------------------

test("Undo and Redo name the step once the history seam reports one", () => {
  expect(byId("edit.undo").label(makeCtx())).toBe("Undo");
  expect(
    byId("edit.undo").label(
      makeCtx({ history: { undoLabel: "dig", redoLabel: null } }),
    ),
  ).toBe("Undo dig");
  expect(
    byId("edit.redo").label(
      makeCtx({ history: { undoLabel: null, redoLabel: "stamp hall" } }),
    ),
  ).toBe("Redo stamp hall");
});

test("the History item is LIVE and summons the palette (D-11)", () => {
  // It shipped in Task 7 DISABLED with its reason in the LABEL — a disabled Radix item
  // is `pointer-events-none`, so a `title` on one is never shown. Both halves are
  // asserted, because a live item still carrying the old label would read as unfinished.
  const history = byId("edit.history");
  expect(history.enabled(makeCtx())).toBe(true);
  expect(history.label(makeCtx())).toBe("History…");
  const ctx = makeCtx();
  history.run(ctx);
  expect(ctx.run.summonPalette).toHaveBeenCalledWith("history");
});

test("the entity verbs name what they would act on", () => {
  const ctx = makeCtx({ selectedEntity: entity() });
  expect(byId("edit.delete").label(ctx)).toBe("Delete hall #7");
  expect(byId("edit.duplicate").label(ctx)).toBe("Duplicate hall #7");
  expect(byId("edit.grab").label(ctx)).toBe("Move hall #7");
  // With nothing selected they are still named — a menu item with no noun still has to
  // say which verb it is.
  expect(byId("edit.delete").label(makeCtx())).toBe("Delete");
});

test("the world verbs carry their own blocked reason, because a disabled item has no tooltip", () => {
  // The reason names the way OUT (⌘S), not only the blocker — the menu item and the top
  // bar's tooltip both render this one string.
  expect(byId("world.bake").label(makeCtx())).toBe(
    "Bake — name the world first (⌘S)",
  );
  const named = makeCtx({
    world: { name: "attic", dirty: false, busy: false },
  });
  expect(byId("world.bake").label(named)).toBe("Bake");

  // A live session is the SECOND blocker, and it wins: bake exports from the committed
  // field and op log (`bakeFieldWorld(store, log, …)`), and a session's ghost is in
  // neither — so baking here writes a world without the thing on screen. The clause lives
  // HERE rather than on the top bar's button, which is what stopped the burger menu from
  // offering the same hazard one click away.
  const mid = makeCtx({
    world: { name: "attic", dirty: false, busy: false },
    session: { generator: "hall" } as never,
  });
  expect(byId("world.bake").enabled(mid)).toBe(false);
  expect(byId("world.bake").label(mid)).toBe("Bake — finish the session first");
  expect(byId("world.bake").enabled(named)).toBe(true);
});

test("the stamp family names the generator S would open, and follows the cursor", () => {
  expect(byId("tool.stamp").label(makeCtx())).toBe("Stamp Hall");
  expect(byId("tool.stamp").label(makeCtx({ stampCursor: "cave" }))).toBe(
    "Stamp Cave",
  );
});

// --- enabled ----------------------------------------------------------------

test("delete needs an entity AND no session", () => {
  const del = byId("edit.delete");
  expect(del.enabled(makeCtx())).toBe(false);
  expect(del.enabled(makeCtx({ selectedEntity: entity() }))).toBe(true);
  expect(
    del.enabled(
      makeCtx({
        selectedEntity: entity(),
        session: { generator: "hall" } as never,
      }),
    ),
  ).toBe(false);
});

test("grab needs an entity AND no session — beginMove REPLACES a live session", () => {
  const grab = byId("edit.grab");
  expect(grab.enabled(makeCtx())).toBe(false);
  expect(grab.enabled(makeCtx({ selectedEntity: entity() }))).toBe(true);
  expect(
    grab.enabled(
      makeCtx({
        selectedEntity: entity(),
        session: { generator: "hall" } as never,
      }),
    ),
  ).toBe(false);
});

test("duplicate needs an entity; undo/redo need a stack", () => {
  expect(byId("edit.duplicate").enabled(makeCtx())).toBe(false);
  expect(
    byId("edit.duplicate").enabled(makeCtx({ selectedEntity: entity() })),
  ).toBe(true);
  expect(byId("edit.undo").enabled(makeCtx())).toBe(false);
  expect(
    byId("edit.undo").enabled(
      makeCtx({ stats: { undoDepth: 2, redoDepth: 0 } as never }),
    ),
  ).toBe(true);
});

test("the session verbs need a session; Esc never disables", () => {
  expect(byId("session.rotate").enabled(makeCtx())).toBe(false);
  expect(byId("session.confirm").enabled(makeCtx())).toBe(false);
  expect(
    byId("session.confirm").enabled(
      makeCtx({ session: { generator: "hall" } as never }),
    ),
  ).toBe(true);
  // A MOVE keeps it LIVE and renames it, because `beginMove` does not focus the canvas:
  // a grab started from the Edit menu has no canvas listener to answer ⏎ with.
  const moving = makeCtx({
    session: { generator: "hall", moving: true } as never,
  });
  expect(byId("session.confirm").enabled(moving)).toBe(true);
  expect(byId("session.confirm").label(moving)).toBe("Drop the move");
  expect(byId("session.escape").enabled(makeCtx())).toBe(true);
});

test("the sticky swap is offered only where there is something to swap", () => {
  const swap = byId("tool.swapEffect");
  expect(swap.enabled(makeCtx())).toBe(true);
  const paint = makeCtx();
  expect(
    swap.enabled({ ...paint, tool: { ...paint.tool, effect: "paint" } }),
  ).toBe(false);
});

// --- run --------------------------------------------------------------------

test("the entity verbs go through the HOST, on the selected id", () => {
  const ctx = makeCtx({ selectedEntity: entity({ entityId: 12 }) });
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  byId("edit.duplicate").run(ctx);
  expect(host.duplicateEntity.mock.calls).toEqual([[12]]);
  byId("edit.grab").run(ctx);
  expect(host.beginMove.mock.calls).toEqual([[12]]);
});

test("delete asks first — the confirm carries the op count, and only its onConfirm deletes", () => {
  const ctx = makeCtx({
    selectedEntity: entity({ entityId: 3, opSpan: [4, 6] }),
  });
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  byId("edit.delete").run(ctx);
  expect(host.deleteEntity).not.toHaveBeenCalled();
  const request = (ctx.run.openConfirm as unknown as ReturnType<typeof mock>)
    .mock.calls[0]?.[0] as { message: string; onConfirm: () => void };
  expect(request.message).toContain("3 ops");
  request.onConfirm();
  expect(host.deleteEntity.mock.calls).toEqual([[3]]);
});

test("⏎ confirms through the MOVE-AWARE host verb, and the spy no longer offers the other one", () => {
  // `commitSession` ended a session BY MODE (`commitStamp` for a stamp, `applyReconfigure`
  // for a reconfigure) and had no production caller left — even the session card's footer
  // routes ⏎ through `confirmSession` (`SessionCard.tsx`'s `onConfirm`), because the button
  // wears the ⏎ keycap and must mean what the key means. T3c deleted it outright; this test
  // is why that was safe to do. `confirmSession` is the surviving verb: it
  // adds `dropMove`'s rules, and a grab started from the Edit menu or by `G` has no canvas
  // listener to answer ⏎ any other way.
  //
  // The routing is pinned HERE, at the table where it is decided, and not only downstream:
  // two chrome suites were caught asserting on `_stub-host.ts`'s `commitSession` mock — a
  // verb ⏎ never touches — and passing vacuously
  // (`chrome/native-select-key-gate.test.tsx`, `chrome/shell.test.tsx`).
  //
  // There is no `not.toHaveBeenCalled()` half and there cannot be: `makeHostSpy` stopped
  // carrying `commitSession` in the same change, so the vacuous assertion is now a type
  // error rather than a green test. That is the stronger form of the same claim.
  const ctx = makeCtx({ session: { generator: "hall" } as never });
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  byId("session.confirm").run(ctx);
  expect(host.confirmSession.mock.calls).toEqual([[]]);
});

test("the brush family arms on a bare press and steps on ⇧, in the binding table's order", () => {
  // Armed elsewhere (the pointer): the bare press returns LMB to the brush it remembers.
  const fromPointer = makeCtx({ gesture: "pointer" });
  byId("tool.brush").run(fromPointer);
  expect(
    (fromPointer.run.armBrush as unknown as ReturnType<typeof mock>).mock.calls,
  ).toEqual([["dig"]]);

  // Cycling walks dig → fill → paint → smooth → segment → dig.
  const armed = (effect: string, gesture: string | null) =>
    makeCtx({
      gesture: gesture as never,
      tool: { ...makeCtx().tool, effect: effect as never },
    });
  const steps: [string, string | null, string][] = [
    ["dig", null, "fill"],
    ["fill", null, "paint"],
    ["paint", null, "smooth"],
  ];
  for (const [from, gesture, to] of steps) {
    const ctx = armed(from, gesture);
    byId("tool.brushCycle").run(ctx);
    expect(
      (ctx.run.armBrush as unknown as ReturnType<typeof mock>).mock.calls,
    ).toEqual([[to]]);
  }
  // …smooth steps to the SEGMENT gesture, which is a gesture and not an effect.
  const fromSmooth = armed("smooth", null);
  byId("tool.brushCycle").run(fromSmooth);
  expect(
    (fromSmooth.run.setGesture as unknown as ReturnType<typeof mock>).mock
      .calls,
  ).toEqual([["segment"]]);
  // …and segment wraps back to dig.
  const fromSegment = armed("smooth", "segment");
  byId("tool.brushCycle").run(fromSegment);
  expect(
    (fromSegment.run.armBrush as unknown as ReturnType<typeof mock>).mock.calls,
  ).toEqual([["dig"]]);
});

test("the cell-select family arms box first and cycles box → wand → room", () => {
  const fresh = makeCtx({ gesture: "pointer" });
  byId("tool.select").run(fresh);
  expect(
    (fresh.run.setGesture as unknown as ReturnType<typeof mock>).mock.calls,
  ).toEqual([["box"]]);

  const onBox = makeCtx({ gesture: "box" });
  byId("tool.selectCycle").run(onBox);
  expect(
    (onBox.run.setGesture as unknown as ReturnType<typeof mock>).mock.calls,
  ).toEqual([["material"]]);

  const onVoid = makeCtx({ gesture: "void" });
  byId("tool.selectCycle").run(onVoid);
  expect(
    (onVoid.run.setGesture as unknown as ReturnType<typeof mock>).mock.calls,
  ).toEqual([["box"]]);
});

test("S opens the cursor's generator; ⇧S only MOVES the cursor", () => {
  const ctx = makeCtx({ stampCursor: "maze" });
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  byId("tool.stamp").run(ctx);
  expect(host.startStamp.mock.calls).toEqual([["maze"]]);

  byId("tool.stampCycle").run(ctx);
  expect(
    (ctx.run.setStampCursor as unknown as ReturnType<typeof mock>).mock.calls,
  ).toEqual([["cave"]]);
  // The cycle opens nothing — it is the one family whose ⇧ does not also arm, because
  // there is no armed stamp state to change until a session exists.
  expect(host.startStamp.mock.calls).toEqual([["maze"]]);
});

test("the view toggles report their own checked state and flip it", () => {
  const ctx = makeCtx();
  expect(byId("view.normals").checked?.(ctx)).toBe(false);
  byId("view.normals").run(ctx);
  expect(
    (ctx.run.view.setShading as unknown as ReturnType<typeof mock>).mock.calls,
  ).toEqual([["normals"]]);
  expect(byId("view.grid").checked?.(ctx)).toBe(true);
  byId("view.grid").run(ctx);
  expect(
    (ctx.run.view.setLayers as unknown as ReturnType<typeof mock>).mock
      .calls[0]?.[0],
  ).toMatchObject({ grid: false });
});

test("view.frameWorld runs the WORLD frame, not the selection frame beside it", () => {
  // ROUTING only — what the camera then does with the world's box is
  // `tests/field-host-camera.test.ts`'s, and this file cannot see it. The two camera verbs are
  // adjacent in the table, one letter apart in meaning, and only `view.frame` has a keycap, so
  // a run wired to the wrong host verb reads correctly in the View submenu and in ⌘K and is
  // wrong only on screen. BOTH calls are asserted because the failure that matters is the
  // SWAP: "frameWorld was called" alone stays green on a def that called both, and
  // `frameSelection` on an empty selection says "nothing to frame" — a sentence a user would
  // read as the world being empty.
  const ctx = makeCtx();
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  byId("view.frameWorld").run(ctx);
  expect(host.frameWorld.mock.calls).toEqual([[]]);
  expect(host.frameSelection).not.toHaveBeenCalled();
});

// --- the six axis views (F4.5c Task 5) ---------------------------------------

/** Each view's id beside the pair it MUST pass, written out longhand. Named for what it is
 *  — the EXPECTED pairing — rather than after the thing it checks: `axisView` is the
 *  registry's own factory, and one grep returning both would leave a reader deciding which is
 *  the source and which the assertion.
 *
 *  Deliberately not derived from anything the registry derives from: a helper that got a
 *  sign backwards would hand this file a matching expectation, and disagreeing with the
 *  table when the table is wrong is the only thing these cases are for. */
const EXPECTED_VIEWS: readonly (readonly [
  ActionId,
  "x" | "y" | "z",
  1 | -1,
])[] = [
  ["view.snapPosX", "x", 1],
  ["view.snapNegX", "x", -1],
  ["view.snapPosY", "y", 1],
  ["view.snapNegY", "y", -1],
  ["view.snapPosZ", "z", 1],
  ["view.snapNegZ", "z", -1],
];

test("each axis view snaps to ITS OWN axis and sign", () => {
  // The whole table in ONE expectation, one STRING per action. Six defs differing only by
  // two arguments is precisely the shape where a slip survives a loop that just asserts
  // "snapView was called" — and neither a per-row `expect` nor a row of tuples is enough
  // here, because the diff carries a single line of context and elides the id, leaving a
  // reader to count rows to find out WHICH of the six fired wrong. Flattened, the id and
  // the bad pair land on the same diff line. Rendering the whole CALL LIST rather than its
  // first entry is what also reddens a def that snapped twice, or not at all.
  const shows = (id: ActionId, calls: unknown): string =>
    `${id} → ${JSON.stringify(calls)}`;
  const observed = EXPECTED_VIEWS.map(([id]) => {
    const ctx = makeCtx();
    const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
    byId(id).run(ctx);
    return shows(id, host.snapView.mock.calls);
  });
  expect(observed).toEqual(
    EXPECTED_VIEWS.map(([id, axis, sign]) => shows(id, [[axis, sign]])),
  );
});

test("the six axis views sit in the view group, always enabled, keyless, and named the way the triad names them", () => {
  for (const [id] of EXPECTED_VIEWS) {
    const def = byId(id);
    // NO chord, and it is a design constraint rather than an omission: six keycaps the
    // charter's binding table never allocated, on a keyboard this editor keeps sparse.
    // The menu (and the command palette, which reads this same table) is the route, and
    // that route is the whole reason the triad's undersized tips stop being the sole one.
    expect({ id, group: def.group, keys: def.keys, cap: capOf(def) }).toEqual({
      id,
      group: "view",
      keys: undefined,
      cap: undefined,
    });
    // Live with no engine at all, like `view.frame` beside it: a view verb needs no
    // selection and no world, and a menu row greyed for no visible reason reads as broken.
    expect({ id, enabled: def.enabled(makeCtx({ host: null })) }).toEqual({
      id,
      enabled: true,
    });
  }
  // The literal vocabulary, pinned once. `AxisTriad` renders these same strings as each
  // tip's `aria-label` (both call `axisViewLabel`); that the two SURFACES agree is
  // `shell.test.tsx`'s case, and this is what either of them would have to change to.
  //
  // The WORDS, not `+X` / `-X`: six adjacent rows separated only by a punctuation mark that
  // a screen reader commonly drops at default verbosity would announce as three pairs, in
  // the group that exists as the reachable stand-in for a target too small to hit.
  const ctx = makeCtx();
  expect(EXPECTED_VIEWS.map(([id]) => byId(id).label(ctx))).toEqual([
    "View from positive X",
    "View from negative X",
    "View from positive Y",
    "View from negative Y",
    "View from positive Z",
    "View from negative Z",
  ]);
});

// --- the pending stamp arm shadows every other family (F4.5b Task 9, D-F4.5-7) --

test("a pending stamp presses the STAMP family and un-presses the arm underneath it", () => {
  const pending = { id: "maze", name: "Maze" };
  // `pointer` is the arm a stamp is most often picked from, and it is the one that
  // would still read as pressed: nothing about `gesture` changes while a stamp is
  // armed, so the two families would BOTH show pressed without the shadow.
  const armed = makeCtx({ gesture: "pointer", pendingStamp: pending });
  const family = (id: string) => {
    const f = TOOL_FAMILIES.find((t) => t.id === id);
    if (f === undefined) throw new Error(`no family "${id}"`);
    return f;
  };
  expect(family("stamp").armed(armed)).toBe(true);
  expect(family("pointer").armed(armed)).toBe(false);
  // …and with nothing armed the same ctx presses `pointer` — so the assertion above
  // is about the arm and not about a family that never presses.
  const idle = makeCtx({ gesture: "pointer", pendingStamp: null });
  expect(family("pointer").armed(idle)).toBe(true);
  expect(family("stamp").armed(idle)).toBe(false);

  // The rail names the generator the ARM holds, not the one ⇧S happens to point at:
  // the cursor moves independently and would otherwise name a different stamp than
  // the region being drawn for.
  expect(
    family("stamp").label(
      makeCtx({ stampCursor: "hall", pendingStamp: pending }),
    ),
  ).toBe("Stamp Maze");
  // Its member ticks agree with the label.
  const members = family("stamp").members(
    makeCtx({ stampCursor: "hall", pendingStamp: pending }),
  );
  expect(members.find((m) => m.id === "maze")?.armed).toBe(true);
  expect(members.find((m) => m.id === "hall")?.armed).toBe(false);
});

// --- the selection verbs (F4.5b Task 13) ------------------------------------
//
// The Field panel's selection footer dissolved with the panel. Its two verbs are in
// the table so the status-bar chip's popover and the Edit menu render ONE pair from
// one place — and so the chip cannot offer a verb the menu does not.

test("Clear names the selection it would drop, and refuses when there is none", () => {
  const clear = byId("edit.clearSelection");
  // Gated on there BEING one, unlike Esc's ladder (which is never refused because it
  // cancels whatever is most recent). A named menu item over an empty selection is a
  // verb with no object.
  const empty = makeCtx();
  expect(clear.enabled(empty)).toBe(false);
  expect(clear.label(empty)).toBe("Clear selection");

  const ctx = makeCtx({
    selection: {
      spec: { kind: "region", min: [0, 0, 0], max: [1, 1, 1] },
      count: 12,
      truncated: false,
      aabb: { min: [0, 0, 0], max: [1, 1, 1] },
    },
  });
  expect(clear.enabled(ctx)).toBe(true);
  // The count is what the user is about to lose, so it is in the name — the
  // `Delete hall #4` convention one group over.
  expect(clear.label(ctx)).toBe("Clear 12 selected cells");
  clear.run(ctx);
  expect(
    (ctx.host as unknown as ReturnType<typeof makeHostSpy>).clearSelection.mock
      .calls.length,
  ).toBe(1);
});

test("Reselect is ALWAYS live — it is for when nothing is selected", () => {
  // The asymmetry with Clear is the whole point: Reselect restores what the last Clear
  // or replace displaced, so the state it matters in is the one Clear refuses in. The
  // host no-ops on an empty slot.
  const reselect = byId("edit.reselect");
  const ctx = makeCtx();
  expect(reselect.enabled(ctx)).toBe(true);
  reselect.run(ctx);
  expect(
    (ctx.host as unknown as ReturnType<typeof makeHostSpy>).reselect.mock.calls
      .length,
  ).toBe(1);
});

test("the ids the status chip names are in the table", () => {
  // `StatusBar` looks its two buttons up by id and renders NOTHING for an id the table
  // has lost — the honest failure, and an invisible one. This is what makes it loud.
  for (const id of ["edit.clearSelection", "edit.reselect"])
    expect({ id, present: ACTIONS.some((a) => a.id === id) }).toEqual({
      id,
      present: true,
    });
});

// --- what a run ANSWERS, and what it takes (T3b2 Task 4) ---------------------
//
// The result channel is NEW for all 39 — before this task every `run` was `(ctx) => void`
// and nothing produced or read a verdict. These cases are what makes the two claims in
// `action-registry/result.ts` true rather than described: which failures are the ACTION's
// own (and are said, once, by the funnel), and which belong to a channel below it (and are
// carried to the caller without a second toast).

test("a hand-off verb answers ok — the host's own refusal is not this action's verdict", async () => {
  // Most of the table is one call into the host or into a chrome funnel — the membership is
  // greppable (`run: handOff(`) and is deliberately not counted here or in `handOff`'s own
  // note. `frameSelection` with
  // nothing selected is the sharp case: the host says "nothing to frame" on its OWN channel,
  // asynchronously, and a run that reported that as its verdict would be guessing at an
  // answer it never waited for.
  const ctx = makeCtx();
  expect(await byId("view.frame").run(ctx)).toEqual({ ok: true });
  expect(
    (ctx.host as unknown as ReturnType<typeof makeHostSpy>).frameSelection.mock
      .calls.length,
  ).toBe(1);
  expect(said()).toEqual([]);
});

test("the entity trio takes an entityId, and falls back to the SELECTION when it is not given", async () => {
  // THE INPUT CHANNEL. The chrome dispatches with nothing and gets the selected stamp; a
  // caller that names one acts on that instead. Both directions asserted on the same def,
  // because a run that ignored its input would pass the fallback half alone.
  const ctx = makeCtx({ selectedEntity: entity({ entityId: 12 }) });
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  expect(await byId("edit.duplicate").run(ctx)).toEqual({ ok: true });
  expect(await byId("edit.duplicate").run(ctx, { entityId: 40 })).toEqual({
    ok: true,
  });
  expect(host.duplicateEntity.mock.calls).toEqual([[12], [40]]);
  expect(await byId("edit.grab").run(ctx, { entityId: 41 })).toEqual({
    ok: true,
  });
  expect(host.beginMove.mock.calls).toEqual([[41]]);
});

test("with nothing selected and nothing named, the entity trio REFUSES with the sentence", async () => {
  // A backstop: `enabled` already refuses all three with no selection, so the chrome never
  // reaches it. What it is for is the caller that consults neither — which is the whole
  // reason a verdict exists at all.
  const ctx = makeCtx();
  for (const id of ["edit.duplicate", "edit.delete", "edit.grab"] as const)
    expect({ id, result: await byId(id).run(ctx) }).toEqual({
      id,
      result: {
        ok: false,
        kind: "refused",
        message: "no stamp selected — select one, or name an entityId",
        // `"inert"` — the class for a verb that cannot act on what it has, and the
        // backstop's whole content: no selection, and no id named either.
        because: "inert",
      },
    });
});

test("Delete refuses an entityId that is not the SELECTED one — the confirm describes the selection", async () => {
  // The one entity verb that cannot act on an unselected id, and the limit is the confirm
  // rather than the delete: the prompt names the generator and counts the ops, both off
  // `ctx.selectedEntity`. Duplicate and Grab need the id alone and take any (above).
  const ctx = makeCtx({ selectedEntity: entity({ entityId: 3 }) });
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  expect(await byId("edit.delete").run(ctx, { entityId: 99 })).toEqual({
    ok: false,
    kind: "refused",
    message:
      "select stamp #99 first — Delete confirms against the SELECTED stamp",
    // An ARGUMENT refusal wearing `"inert"`; `RefusalClass`'s docblock argues why there is
    // no `input` class and names this as one of the two that would move if one arrived.
    because: "inert",
  });
  expect(ctx.run.openConfirm).not.toHaveBeenCalled();
  expect(host.deleteEntity).not.toHaveBeenCalled();
});

test("Stamp takes a generatorId, and naming one does NOT move the ⇧S cursor", async () => {
  // THE EXEMPLAR. The cursor is what the status bar advertises, so a caller opening a
  // different generator must not silently re-aim the key a human is reading about.
  const ctx = makeCtx({ stampCursor: "maze" });
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  expect(await byId("tool.stamp").run(ctx, { generatorId: "cave" })).toEqual({
    ok: true,
  });
  expect(host.startStamp.mock.calls).toEqual([["cave"]]);
  expect(ctx.run.setStampCursor).not.toHaveBeenCalled();
  // …and with nothing named it is still the cursor's.
  await byId("tool.stamp").run(ctx);
  expect(host.startStamp.mock.calls).toEqual([["cave"], ["maze"]]);
});

test("Save as… opens the drawer with no name and WRITES with one", async () => {
  // Two behaviours on one verb, which is what "name a copy" means — and the reason this row
  // carries a `{name}` schema rather than staying the bare verb ⇧⌘S has always been.
  const ctx = makeCtx();
  expect(await byId("world.saveAs").run(ctx)).toEqual({ ok: true });
  expect(ctx.run.world.openDrawer).toHaveBeenCalledWith("save-as");
  expect(ctx.run.world.saveAs).not.toHaveBeenCalled();
  await byId("world.saveAs").run(ctx, { name: "attic" });
  expect(ctx.run.world.saveAs).toHaveBeenCalledWith("attic");
});

test("Make default names the OPEN world by default, and refuses an untitled one", async () => {
  const named = makeCtx({
    world: { name: "attic", dirty: false, busy: false },
  });
  expect(await byId("world.makeDefault").run(named)).toEqual({ ok: true });
  expect(named.run.world.makeDefault).toHaveBeenCalledWith("attic");
  await byId("world.makeDefault").run(named, { name: "cavern" });
  expect(named.run.world.makeDefault).toHaveBeenCalledWith("cavern");
  expect(await byId("world.makeDefault").run(makeCtx())).toEqual({
    ok: false,
    kind: "refused",
    message: "name the world first (⌘S)",
    because: "inert",
  });
});

// --- the ONE funnel (T3b2 Task 4) --------------------------------------------

test("the funnel gates, claims, checks, runs and SAYS — in that order", async () => {
  // `onClaim` is the key dispatcher's `preventDefault` seam and its position is the contract:
  // after the gate ALLOWS and before `enabled`, because at that point the key is claimed. A
  // disabled ⌘S must still suppress the browser's save-page dialog.
  const claims: string[] = [];
  const ctx = makeCtx();
  const result = await runAction(byId("edit.undo"), ctx, KEY, undefined, () =>
    claims.push("claimed"),
  );
  // `edit.undo` is DISABLED here (no undo depth), so the claim landed and the run did not.
  expect({ claims, result }).toEqual({
    claims: ["claimed"],
    // THE CANONICAL `"inert"`: the gate is open, the claim landed, and `enabled` is what
    // refused — so the reason a caller gets is the label, and the class says which kind of
    // reason a label is.
    result: { ok: false, kind: "refused", message: "Undo", because: "inert" },
  });
  expect(
    (ctx.host as unknown as ReturnType<typeof makeHostSpy>).undo,
  ).not.toHaveBeenCalled();
  // INERT SAYS NOTHING, which is the existing three-way policy: the label already carries
  // the reason on screen, so a toast would be a second wording of a sentence being read.
  expect(said()).toEqual([]);
});

test("a REFUSED action never reaches the claim — the character the user is typing survives", async () => {
  const claims: string[] = [];
  const result = await runAction(
    byId("view.frame"),
    makeCtx(),
    { ...KEY, inTextInput: true },
    undefined,
    () => claims.push("claimed"),
  );
  expect({ claims, refused: !result.ok }).toEqual({
    claims: [],
    refused: true,
  });
});

test("the gate's refusal is SAID once, and a held key cannot stack it", async () => {
  // `sayRefusal`'s de-duplication is against the LIVE toast stack, which is exactly the
  // shape a key repeating at the OS rate needs.
  const session = makeCtx({ session: { generator: "hall" } as never });
  const hint = "finish the session first — ⏎ applies it, Esc discards it";
  for (let i = 0; i < 3; i += 1)
    expect(await runAction(byId("tool.brush"), session, KEY)).toEqual({
      ok: false,
      kind: "refused",
      message: hint,
      because: "session",
    });
  expect(said()).toEqual([hint]);
});

test("the funnel SAYS a `refused` run result and stays QUIET on a `failed` one", async () => {
  // THE RECONCILIATION, as behaviour. A `refused` result is the action's own verdict and
  // nobody has said it yet — this is the sentence that used to be a `notify.error` inside the
  // verb. A `failed` result came from a layer that owns its own channel and has already said
  // it (`world-actions.ts`'s "bake failed: ENOSPC"), so repeating it here would be the
  // doubled toast the rule exists to prevent.
  const refuse = makeCtx({ world: { name: null, dirty: false, busy: false } });
  // Bake over an untitled world: `enabled` refuses it first, so reach the run's own backstop
  // through the verb the action dispatches into.
  (refuse.run.world.bake as unknown as ReturnType<typeof mock>).mockReturnValue(
    Promise.resolve({
      ok: false,
      kind: "refused",
      message: "name the world first (⌘S)",
      because: "inert",
    }),
  );
  const named = {
    ...refuse,
    world: { name: "attic", dirty: false, busy: false },
  };
  expect(await runAction(byId("world.bake"), named, NAMED)).toEqual({
    ok: false,
    kind: "refused",
    message: "name the world first (⌘S)",
    // The verb's OWN class, passed straight through: the funnel says a `refused` result out
    // loud and does not re-classify it.
    because: "inert",
  });
  expect(said()).toEqual(["name the world first (⌘S)"]);
  notify.clear();

  (refuse.run.world.bake as unknown as ReturnType<typeof mock>).mockReturnValue(
    Promise.resolve({
      ok: false,
      kind: "failed",
      message: "bake failed: ENOSPC",
    }),
  );
  expect(await runAction(byId("world.bake"), named, NAMED)).toEqual({
    ok: false,
    kind: "failed",
    message: "bake failed: ENOSPC",
  });
  expect(said()).toEqual([]);
});

test("a run that THROWS is surfaced, not thrown past the dispatcher", async () => {
  // The whole of what `failed` means, and the one `failed` no layer below has said — so this
  // is the one the funnel voices itself. Before it, a throw out of a run took its listener
  // with it: a sync throw out of the keydown handler, and an unhandled rejection once the
  // world verbs became async. Neither is visible and neither is answerable.
  const ctx = makeCtx();
  (
    ctx.run.openCommandPalette as unknown as ReturnType<typeof mock>
  ).mockImplementation(() => {
    throw new Error("boom");
  });
  const result = await runAction(byId("view.commandPalette"), ctx, NAMED);
  expect(result).toEqual({
    ok: false,
    kind: "failed",
    message: "Find a command… failed: boom",
  });
  expect(said()).toEqual(["Find a command… failed: boom"]);
});

// --- the MEMBER funnel (T4a Task 1) ------------------------------------------
//
// `runAction` above calls itself "the one funnel every surface dispatches through", and until
// this task that was untrue of one path: picking a member out of a tool family reached
// `ctx.run` or the host directly — ungated, unvoiced and answering nothing at all. Both
// surfaces refuse BEFORE the pick rather than inside it (the rail's flyout TRIGGER off the
// row's verdict, the palette's member rows through `disabled`), which is why it was filed as
// a false claim rather than a bug, and why it survived two rewrites of this code. What these
// cases pin is the claim and the caller that inherits it — T4's agent has no flyout to be
// refused by. The one route a HUMAN still had is `chrome/tool-rail.test.tsx`'s: the rail's
// check is a moment earlier than the pick, so a flyout left standing when a session opens is
// five buttons past their own gate.

/** A family by id, throwing on a miss — `familyOf`'s shape, read from outside. */
const family = (id: string): ToolFamily => {
  const found = TOOL_FAMILIES.find((f) => f.id === id);
  if (found === undefined) throw new Error(`no tool family "${id}"`);
  return found;
};

/** One member's ID, found by its LABEL and throwing on a miss: a member renamed in
 *  `FAMILY_ROWS` must fail these cases loudly rather than leave them asserting things about
 *  `undefined`.
 *
 *  BY LABEL and answering the ID, because the two are not the same string and only one of
 *  them is the funnel's argument (T4b). A `"rows"` member's id IS its label; a
 *  `"generators"` member's id is the generator id and its label is the generator's NAME —
 *  "Maze" versus `maze`. Reading the id out of the resolved list rather than spelling it here
 *  keeps that distinction `familyMembers`' to make, and keeps these cases naming members the
 *  way a human reading the flyout would. */
const memberIdNamed = (
  members: readonly ToolFamilyMember[],
  label: string,
): string => {
  const found = members.find((m) => m.label === label);
  if (found === undefined) throw new Error(`no member "${label}"`);
  return found.id;
};

test("a member pick ANSWERS, and arms exactly the member that was picked", () => {
  // BOTH halves of `familyMembers`, because they arm through different doors and only one of
  // them had a route through the table at all: a `"rows"` member pushes at `ctx.run`, a
  // `"generators"` member calls the host. Neither produced a verdict before this task.
  const ctx = makeCtx();
  const brush = family("brush");
  expect(
    runMember(brush, memberIdNamed(brush.members(ctx), "Paint"), ctx),
  ).toEqual({ ok: true });
  expect(ctx.run.armBrush).toHaveBeenCalledWith("paint");

  const stamp = family("stamp");
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  expect(
    runMember(stamp, memberIdNamed(stamp.members(ctx), "Maze"), ctx),
  ).toEqual({ ok: true });
  expect(host.startStamp.mock.calls).toEqual([["maze"]]);
  // `ok` on a HAND-OFF, per `ActionResult`'s module header: the host answers for itself,
  // later, on its own channel — and a pick that succeeded still succeeds SILENTLY.
  expect(said()).toEqual([]);
});

test("a member pick a live session refuses is `refused`, with the FAMILY's own sentence", () => {
  // The gate is the family's, which is what makes this need no descriptor row of its own:
  // arming Paint is arming the brush, so the refusal that stops `tool.brush` stops Paint —
  // in the same words the flyout button beside it is already showing.
  const session = makeCtx({ session: { generator: "hall" } as never });
  const hint = "finish the session first — ⏎ applies it, Esc discards it";
  const brush = family("brush");
  expect(
    runMember(brush, memberIdNamed(brush.members(session), "Paint"), session),
  ).toEqual({ ok: false, kind: "refused", message: hint, because: "session" });
  // The arm did not happen — the refusal is the whole verdict, not a message beside an
  // effect that landed anyway.
  expect(session.run.armBrush).not.toHaveBeenCalled();
  expect(said()).toEqual([hint]);
});

test("a member arm that THROWS is surfaced as `failed`, named after the MEMBER", () => {
  // `runAction`'s rule one layer down: the one `failed` no channel below has said is the one
  // the funnel builds out of a caught throw, so the funnel voices it. The member's label and
  // not the family's — "Brush failed" would name four other members along with the one that
  // did it.
  const ctx = makeCtx();
  const host = ctx.host as unknown as ReturnType<typeof makeHostSpy>;
  (host.startStamp as unknown as ReturnType<typeof mock>).mockImplementation(
    () => {
      throw new Error("boom");
    },
  );
  const stamp = family("stamp");
  expect(
    runMember(stamp, memberIdNamed(stamp.members(ctx), "Maze"), ctx),
  ).toEqual({ ok: false, kind: "failed", message: "Maze failed: boom" });
  expect(said()).toEqual(["Maze failed: boom"]);
});

// --- the member funnel takes an ID (T4b Task 1) ------------------------------
//
// T4a's own review filed two things about this funnel and both are here. It took the member
// OBJECT, so `runMember(brush, aStampMember, ctx)` compiled — gated against the brush and
// armed a stamp — and neither chrome surface can write that, which is exactly why it stayed
// open: the caller the funnel EXISTS for is the one with no flyout to pick from. And a stamp
// arm was `c.host?.startStamp(...)`, so with no engine the pick did nothing and the funnel
// still said `ok`: the one outright lie it could tell, and unreachable through the rail
// because an engine-less session lists no generators to draw a flyout from.

test("a member id no member answers to is `refused` as `member`, and names the ids that exist", () => {
  // THE IDS IN THE SENTENCE, spelled out here rather than derived from `brush.members(ctx)` —
  // an expectation built from the same list the code reads would pass whatever that list
  // said. A member renamed in `FAMILY_ROWS` reds this case, which is the point: the sentence
  // is the only way the caller this funnel exists for can learn what it should have asked.
  const ctx = makeCtx();
  expect(runMember(family("brush"), "Pain", ctx)).toEqual({
    ok: false,
    kind: "refused",
    message:
      'no "Pain" in the Brush tools — its members are [Dig, Fill, Paint, Smooth, Segment]',
    because: "member",
  });
  // Nothing was armed, and nothing was SAID: no human can name an id that is not in the list
  // they just clicked, so a toast here would be a sentence written for nobody.
  expect(ctx.run.armBrush).not.toHaveBeenCalled();
  expect(ctx.run.setGesture).not.toHaveBeenCalled();
  expect(said()).toEqual([]);
});

test("an unknown member id is answered BEFORE the family's gate — a bad request, not a bad moment", () => {
  // THE ORDERING, AS A DECISION. A live session refuses every brush pick, so gating first
  // would answer a typo with "finish the session first" — the caller finishes it, retries and
  // meets the same typo, having learnt the wrong fact first. `member` is also the one class
  // that does not depend on WHEN it was asked, which is what makes it worth reaching first.
  const session = makeCtx({ session: { generator: "hall" } as never });
  const brush = family("brush");
  expect(whyRefused(runMember(brush, "Pain", session))).toBe("member");
  // …and the family's gate is still there for an id that EXISTS, so this is an ordering pin
  // and not a hole in the gate.
  expect(
    whyRefused(
      runMember(brush, memberIdNamed(brush.members(session), "Paint"), session),
    ),
  ).toBe("session");
});

test("a stamp pick with no engine is `refused` — and a brush pick with no engine is not", () => {
  // DIGEST INPUT #2. `ACTION_OK` used to be this funnel's answer for an arm that no-opped
  // into a null host, which is a positive claim about an effect that never landed.
  //
  // THE SECOND HALF IS THE ARGUMENT for where the check lives. A blanket `ctx.host === null`
  // guard in `runMember` would close the lie and refuse Paint along with it — a pick that
  // works perfectly well before the engine is up, because a `"rows"` arm pushes at `ctx.run`
  // and never touches the host. The precondition belongs to the ARM, and this case reds if it
  // moves into the funnel.
  const ctx = makeCtx({ host: null });
  const stamp = family("stamp");
  expect(
    runMember(stamp, memberIdNamed(stamp.members(ctx), "Maze"), ctx),
  ).toEqual({
    ok: false,
    kind: "refused",
    message: "the engine is not up yet — Maze cannot open a session",
    because: "inert",
  });
  // AND IT IS SAID. The opposite answer to the member-miss case above, and the two are
  // decided separately because they are different questions: a miss is unreachable for a
  // human, where picking a stamp before the engine is up is something a human can do. Nobody
  // else says this sentence — the gate never refused and no layer below was reached — which
  // is `sayResult`'s idiom exactly.
  expect(said()).toEqual([
    "the engine is not up yet — Maze cannot open a session",
  ]);
  notify.clear();
  const brush = family("brush");
  expect(
    runMember(brush, memberIdNamed(brush.members(ctx), "Paint"), ctx),
  ).toEqual({ ok: true });
  expect(ctx.run.armBrush).toHaveBeenCalledWith("paint");
  // …and an arm that SUCCEEDS still succeeds silently, so the voicing above is the refusal's
  // and not a new sentence on every pick.
  expect(said()).toEqual([]);
});

// --- the DISPATCH env is COMPUTED (T4a Task 2) -------------------------------
//
// Two things lied here before this task, and they were one lie: `NAMED_CALL` hard-coded
// `confirmOpen: false`, so no named caller could ever be refused by a modal — and when the
// gate DID refuse silently it carried `hint: null`, so the funnel handed back the action's
// LABEL as the reason. Neither cost a human anything (a button under a dialog cannot be
// pressed, and the dialog itself says why), and both are the whole of what an agent would
// have read. The DISPATCH env is computed off the ctx now and every refusal states its own
// reason.
//
// The DISPLAY env is not, and that is a decision rather than the old hard-code surviving:
// `NAMED_RENDER` answers "how does this control look", where the funnels answer "may this
// run". The asymmetry has a pin of its own below, and the argument lives at `NAMED_RENDER`.

const MODAL = "a confirm dialog is open — answer it first";

test("a NAMED call while a modal is open is `refused` WITH the modal reason, and says nothing", async () => {
  // THE PATH THIS TASK MADE REACHABLE — that is the point of it. What this used to answer
  // with is `def.label(ctx)`: "Frame selection", as the reason a dialog was open.
  const modal = makeCtx({ isConfirmOpen: () => true });
  expect(await runNamed(byId("view.frame"), modal)).toEqual({
    ok: false,
    kind: "refused",
    message: MODAL,
    because: "modal",
  });
  // THE DISPLAY HALF DID NOT MOVE: the class is still silent, so the dialog on screen stays
  // the only thing saying why. The sentence is for the caller holding the Result.
  expect(said()).toEqual([]);
  // …and the verb did not run behind the refusal.
  expect(
    (modal.host as unknown as ReturnType<typeof makeHostSpy>).frameSelection,
  ).not.toHaveBeenCalled();
});

test("DISPLAY and DISPATCH differ on exactly one clause, and it is the modal one", async () => {
  // THE ASYMMETRY, AS A PROPERTY — pinned so it cannot be closed or widened silently. It is
  // deliberate (`NAMED_RENDER` in `actions.ts` carries the three reasons) and it is the whole
  // reconciliation of two things that read like a contradiction: the control renders runnable
  // while a dispatch of that same verb, on that same ctx, at that same instant, refuses.
  //
  // Invisible to a human, because a Radix modal takes pointer events off the body, so the
  // press this would license cannot be made. NOT invisible to an agent, which has no overlay
  // in front of it — and the agent is on the DISPATCH side, which is the side that refuses.
  const modal = makeCtx({ isConfirmOpen: () => true });
  expect(controlVerdict(byId("view.frame"), modal)).toEqual({ runnable: true });
  expect(clickGate(byId("view.frame"), modal).ok).toBe(true);
  expect(await runNamed(byId("view.frame"), modal)).toEqual({
    ok: false,
    kind: "refused",
    message: MODAL,
    because: "modal",
  });
  // ONE CLAUSE, not two: with no modal the two seams agree, so the case is not passing by
  // making the display gate answer `true` to everything.
  const plain = makeCtx();
  expect(controlVerdict(byId("view.frame"), plain)).toEqual({ runnable: true });
  expect(await runNamed(byId("view.frame"), plain)).toEqual({ ok: true });
});

test("a KEY refused by a text field answers with the TYPING reason — the label fallback is gone", async () => {
  // The other direction of the same removal, on the caller class that always could reach it.
  // `runAction` used to close with `refused(verdict.hint ?? def.label(ctx))`, so a caller
  // asking why `F` did nothing while they typed got back "Frame selection" — this row's
  // label, and no more of an answer here than it was under the modal above.
  expect(
    await runAction(byId("view.frame"), makeCtx(), {
      ...KEY,
      inTextInput: true,
    }),
  ).toEqual({
    ok: false,
    kind: "refused",
    message:
      "a text field has the keyboard — this key is a character being typed",
    because: "typing",
  });
  expect(said()).toEqual([]);
});

test("the named env is POLLED at dispatch, not snapshotted with the ctx", async () => {
  // WHY `isConfirmOpen` IS A CALL and not a boolean field. A modal goes up and down BETWEEN
  // renders, the way the right button does, so ONE ctx has to answer twice and differently —
  // a snapshot would freeze whichever answer the render that built it happened to see, which
  // is the bug `host.isLooking()` already exists to avoid.
  let open = false;
  const ctx = makeCtx({ isConfirmOpen: () => open });
  expect(await runNamed(byId("view.frame"), ctx)).toEqual({ ok: true });
  open = true;
  expect(await runNamed(byId("view.frame"), ctx)).toEqual({
    ok: false,
    kind: "refused",
    message: MODAL,
    because: "modal",
  });
});

test("a MEMBER pick answers the modal in the same words its family's row does", () => {
  // `runMember` reached the gate through `controlVerdict` for exactly one commit, and that
  // seam COLLAPSES a silently-refused gate onto the same `reason: null` the inert case
  // carries — so this pick would have answered "Brush", the family's label, as the reason a
  // dialog was open. Both funnels share one sequence now (`refuseOrClaim`), so there is no second
  // three-way left to disagree.
  const modal = makeCtx({ isConfirmOpen: () => true });
  const brush = family("brush");
  expect(
    runMember(brush, memberIdNamed(brush.members(modal), "Paint"), modal),
  ).toEqual({ ok: false, kind: "refused", message: MODAL, because: "modal" });
  expect(modal.run.armBrush).not.toHaveBeenCalled();
  expect(said()).toEqual([]);
});

// --- the refusal CLASS, whole (T4b Task 1) -----------------------------------
//
// `because` is the agent-facing half of a refusal: the message is prose written for a toast
// and is free to be reworded, so the CLASS is the part a caller is allowed to depend on. What
// the table below holds is the vocabulary itself — every class, reached through a funnel, and
// answering with its own name rather than with a neighbour's.

/** One dispatch per class, keyed BY the class. A `Record<RefusalClass, …>` rather than an
 *  array of cases, so the coverage is the type's to enforce: an eighth class added to the
 *  union without a route that produces it does not compile here, and no reviewer has to
 *  notice the gap. The dispatches are split across both funnels and both caller classes
 *  because that is where these refusals actually live — three of them are a KEY's alone. */
const REFUSALS: Record<
  RefusalClass,
  () => ActionResult | Promise<ActionResult>
> = {
  modal: () =>
    runNamed(byId("view.frame"), makeCtx({ isConfirmOpen: () => true })),
  typing: () =>
    runAction(byId("view.frame"), makeCtx(), { ...KEY, inTextInput: true }),
  looking: () =>
    runAction(byId("tool.stamp"), makeCtx(), { ...KEY, looking: true }),
  // The menu-only backstop: a verb with no `gate` cannot be run by a key, and a NAMED
  // caller runs it perfectly well — which is why the dispatch here is the KEY one.
  menuOnly: () => runAction(byId("world.new"), makeCtx(), KEY),
  session: () =>
    runAction(
      byId("tool.brush"),
      makeCtx({ session: { generator: "hall" } as never }),
      KEY,
    ),
  // `enabled` false with the gate OPEN — no undo depth on a fresh ctx.
  inert: () => runAction(byId("edit.undo"), makeCtx(), KEY),
  member: () => runMember(family("brush"), "no-such-member", makeCtx()),
};

test("every refusal class is REACHABLE through a funnel, and answers with its own name", async () => {
  // BY NAME, one row at a time, so a swapped pair reds as two named rows rather than as one
  // opaque object diff — the whole reason to assert the class beside the class it should be.
  for (const [expected, dispatch] of Object.entries(REFUSALS)) {
    const result = await dispatch();
    // `String(…)` and not a cast: `Object.keys`/`entries` widen a `Record`'s keys to `string`,
    // so the two sides of this comparison are the same value at different widths. Widening the
    // observed one is free and honest; asserting the key back down would be the assertion this
    // repo's rules exist to keep out, and there is nothing here for it to protect — the table
    // is keyed by `RefusalClass`, so a key that is not a class never compiled in the first
    // place.
    expect({ expected, got: String(whyRefused(result)) }).toEqual({
      expected,
      got: expected,
    });
  }
});

test("`member.arm` has exactly ONE caller in the editor — the funnel itself", () => {
  // A SOURCE SCAN, and for the ⌘K half it is the only instrument there is. The rail's
  // re-point is pinned by BEHAVIOUR (`chrome/tool-rail.test.tsx`'s stale-flyout case, which
  // reds on a bare arm); the palette's cannot be, because its rows are rebuilt from a live
  // ctx on every render and a `disabled` row registers no select listener at all — so a bare
  // arm and a funnelled one are indistinguishable from outside, which is exactly how the
  // bypass survived being rewritten twice. `no-bun-leakage.test.ts` and
  // `frontend-no-engine-leakage.test.ts` hold their invariants the same way and for the same
  // reason: the rule is about what the source may SAY.
  //
  // A PROXY, and named as one: it is the constraint's own grep, so a re-point that spells the
  // receiver differently (`m.arm(ctx)`) walks past it. What it catches is the shape a caller
  // reaching for a member actually writes, and it is the whole of what a regex can promise.
  const src = join(import.meta.dir, "..", "src");
  const callers = walk(src)
    .filter((f) => /\bmember\.arm\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(src, f))
    // SORTED, because `readdirSync` order is the platform's — `frontend-no-engine-leakage.
    // test.ts` sorts its own literal comparison for the same reason. Moot at one entry and
    // not moot the day a second legitimate caller is declared.
    .sort();
  // The funnel's own file, and NOT an empty list: a scan asserting `[]` would pass just as
  // happily with the funnel deleted.
  expect(callers).toEqual(["frontend/lib/actions.ts"]);
});

test("`clickGate` has exactly ONE caller in the editor — the DISPLAY seam it feeds", () => {
  // THE ASYMMETRY'S OTHER HALF, held by machine. The pin above catches the two envs COLLAPSING
  // into one, in either direction; it cannot catch a THIRD reader appearing. `clickGate` asks
  // `NAMED_RENDER`, which is modal-blind by decision, and it is exported (these suites need
  // the `hint` that `controlVerdict` collapses to `null`) — so nothing structural stops a
  // future surface writing `if (clickGate(def, ctx).ok) { …do the thing… }` and getting an
  // enforcement path that silently cannot see a modal. That is not a hypothetical shape: it is
  // what every one of the four display call sites looks like one line before it dispatches.
  //
  // The rule it holds is `NAMED_RENDER`'s closing line — anything that wants ENFORCEMENT goes
  // through a funnel, and this is not one. `member.arm`'s scan above carries why a source scan
  // is the instrument for a rule about what the source may SAY, and this is the same
  // instrument with the same limits: a PROXY, blind to a caller that spells the receiver
  // differently, and — because the definition and its one caller share a file — blind to a
  // second caller added INSIDE `actions.ts`. What it catches is the case the rule is about, a
  // surface reaching for the gate from outside the module that owns the funnels.
  const src = join(import.meta.dir, "..", "src");
  const callers = walk(src)
    .filter((f) => /\bclickGate\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(src, f))
    .sort();
  // Its own file — the declaration and `controlVerdict`'s call — and NOT an empty list, for
  // the reason the scan above gives.
  expect(callers).toEqual(["frontend/lib/actions.ts"]);
});

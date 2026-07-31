// The action TABLE: what each entry says it is, what it names, when it refuses, and what
// running it actually calls. Pure — `KeyboardEvent` is a type only here, so this file
// deliberately does NOT import the happy-dom harness (registering it from a top-level
// tests/ file poisons the daemon/bundle/GPU suites — see tests/chrome/keybindings-dom.ts).
//
// Its sibling `tests/keybindings.test.ts` owns the other half: which EVENT reaches which
// entry, and the gate that refuses it.
import { expect, type mock, test } from "bun:test";
import { ACTIONS, TOOL_FAMILIES } from "../src/frontend/lib/actions.ts";
import type { FieldEntityInfo } from "../src/viewport-host/index.ts";
import { byId, makeCtx, type makeHostSpy } from "./_actions-fixture.ts";

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

test("every displayed chord is unique — one key, one action", () => {
  const keys = ACTIONS.flatMap((a) => (a.keys === undefined ? [] : [a.keys]));
  expect(new Set(keys).size).toBe(keys.length);
});

test("match and gate are declared together — a matcher with no gate could not be refused", () => {
  for (const a of ACTIONS)
    expect({
      id: a.id,
      paired: (a.match === undefined) === (a.gate === undefined),
    }).toEqual({ id: a.id, paired: true });
});

test("every keyed action carries its keycap and its overlay sentence", () => {
  // The overlay renders `keys` + `hint`; an action reachable from the keyboard with
  // neither is a binding that cannot be discovered.
  for (const a of ACTIONS) {
    if (a.match === undefined) continue;
    expect({ id: a.id, keys: a.keys, hint: typeof a.hint }).toEqual({
      id: a.id,
      keys: a.keys,
      hint: "string",
    });
    expect(a.keys).toBeTruthy();
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

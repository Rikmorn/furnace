// The action TABLE: what each entry says it is, what it names, when it refuses, and what
// running it actually calls. Pure — `KeyboardEvent` is a type only here, so this file
// deliberately does NOT import the happy-dom harness (registering it from a top-level
// tests/ file poisons the daemon/bundle/GPU suites — see tests/chrome/keybindings-dom.ts).
//
// Its sibling `tests/keybindings.test.ts` owns the other half: which EVENT reaches which
// entry, and the gate that refuses it.
import { expect, type mock, test } from "bun:test";
import type { FieldEntityInfo } from "../src/field-host/index.ts";
import {
  ACTION_GROUPS,
  ACTIONS,
  type ActionGroup,
  byId,
  groupTitle,
  TOOL_FAMILIES,
} from "../src/frontend/lib/actions.ts";
import { makeCtx, type makeHostSpy } from "./_actions-fixture.ts";

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
  expect(() => byId("view.nope")).toThrow(/no action "view.nope"/);
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
  expect({ keys: def.keys, gate: def.gate, group: def.group }).toEqual({
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
    keys: def.keys,
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

test("⏎ confirms through the MOVE-AWARE host verb, and the spy no longer offers the other one", () => {
  // `commitSession` ends a session BY MODE (`commitStamp` for a stamp, `applyReconfigure` for
  // a reconfigure) and has no production caller left at head — even the session card's footer
  // routes ⏎ through `confirmSession` (`SessionCard.tsx`'s `onConfirm`), because the button
  // wears the ⏎ keycap and must mean what the key means. `confirmSession` is that verb: it
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
 *  — the EXPECTED pairing — rather than after the table it checks: `AXIS_VIEWS` is the
 *  registry's own const, and one grep returning both would leave a reader deciding which is
 *  the source and which the assertion.
 *
 *  Deliberately not derived from anything the registry derives from: a helper that got a
 *  sign backwards would hand this file a matching expectation, and disagreeing with the
 *  table when the table is wrong is the only thing these cases are for. */
const EXPECTED_VIEWS: readonly (readonly [string, "x" | "y" | "z", 1 | -1])[] =
  [
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
  const shows = (id: string, calls: unknown): string =>
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
    expect({ id, group: def.group, keys: def.keys, match: def.match }).toEqual({
      id,
      group: "view",
      keys: undefined,
      match: undefined,
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

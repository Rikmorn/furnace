// The tool registry's pins: the machinery, the two registrations the editor ships, and the
// dead-control answer they moved here to give.
//
// The last group is the one that matters most and is the easiest to write badly. The rule
// `toolCanActivateControl("brush", …)` now answers was a literal inside `availableParams`
// (`tool-params.tsx`), and a case that re-spelled that literal and compared the two would be
// a tautology wearing an assertion's clothes — the exact shape `action-table.test.ts`'s
// header says was deleted after T3b2's derive-and-diff gate had done its work. So the answer
// is pinned as a TABLE of expected verdicts instead: written out by hand, one row per
// (control, class count) pair that can differ, so a rewrite of the rule has to agree with the
// grid rather than with a copy of itself.
import { expect, test } from "bun:test";
import type { MaterialTable } from "@furnace/core/field";
import type { ParamId } from "../../src/shared/action-table.ts";
import {
  createToolRegistry,
  defineTool,
  type ToolCapabilityCtx,
  type ToolId,
  toolCanActivateControl,
  toolEntries,
} from "../../src/shared/tool-registry.ts";

/** A catalog with `n` classes. Only the LENGTH is read by anything under test, so the rows
 *  are the cheapest thing that satisfies the type. */
const classes = (n: number): MaterialTable["classes"] =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `class-${i}`,
    kind: "organic" as const,
    color: [0, 0, 0, 1] as [number, number, number, number],
  }));

const ctx = (control: ParamId, n: number): ToolCapabilityCtx => ({
  control,
  classes: classes(n),
});

// --- (1) the machinery -------------------------------------------------------

test("a duplicate registration THROWS — setup-loud, and it names the tool", () => {
  const registry = createToolRegistry();
  registry.define({ id: "brush" });
  expect(() => registry.define({ id: "brush" })).toThrow(
    `tool-registry: tool "brush" is already registered`,
  );
});

test("the editor's own registry is setup-loud too — re-registering a shipped tool throws", () => {
  // The module-scope table, not a fresh one: the guard has to hold for the instance the
  // editor actually runs on, and the two registrations at the bottom of the module are what
  // make this reachable without any setup of its own.
  //
  // IT LEAVES THE SINGLETON UNTOUCHED, which is what makes writing at it acceptable in a
  // suite Bun runs in ONE process (`TOOLS` is shared by every case in this file and by any
  // other file that imports the module). `define` CHECKS THEN THROWS — the `store.set` is
  // below the guard and unreachable on this path — so the failed registration is not a
  // partial write. That ordering is load-bearing for this case, not incidental: reverse the
  // two lines and this test would silently start mutating the table the cases below assert
  // on. Core's `Registry` carries a `reset()` for suites that need to undo a write; this one
  // deliberately has none, because nothing here ever completes one.
  expect(() => defineTool({ id: "segment" })).toThrow(
    `tool-registry: tool "segment" is already registered`,
  );
  expect(toolEntries().map((d) => d.id)).toEqual(["brush", "segment"]);
});

test("entries() is REGISTRATION order, and a fresh array each call", () => {
  const registry = createToolRegistry();
  // Deliberately NOT the order the editor registers in, so a case that accidentally read the
  // module-scope table would fail rather than agree.
  registry.define({ id: "segment" });
  registry.define({ id: "brush" });
  expect(registry.entries().map((d) => d.id)).toEqual(["segment", "brush"]);

  const first = registry.entries();
  first.length = 0;
  expect(registry.entries().map((d) => d.id)).toEqual(["segment", "brush"]);
});

test("canActivateControl defaults to TRUE — for a tool with no answer, and for an id with none", () => {
  const registry = createToolRegistry();
  registry.define({ id: "segment" });
  expect(registry.canActivateControl("segment", ctx("material", 0))).toBe(true);
  // Deliberately invalid input: `ToolId` makes an unregistered id unspellable, and the
  // runtime-quiet fallback is what a render is entitled to when one arrives anyway.
  expect(
    registry.canActivateControl("nope" as ToolId, ctx("material", 0)),
  ).toBe(true);
});

// --- (2) the two registrations the editor ships ------------------------------

test("the editor registers exactly `brush` and `segment`, in that order", () => {
  expect(toolEntries().map((d) => d.id)).toEqual(["brush", "segment"]);
});

test("EVERY `ToolId` is registered — the union and the registrations are one set", () => {
  // THE DRIFT THIS CLOSES, and it is the one failure the module's own header warns about
  // arriving by a different door. `ToolId` and the `defineTool` calls are two enumerations of
  // one set. Registering an id the union does not carry fails `bun run typecheck` and the
  // order case above; the OTHER direction was guarded by nothing — widen the union, forget
  // the registration, and `toolCanActivateControl("newTool", ctx)` takes the default and
  // answers `true`. That is the dead control back on screen with the whole suite green.
  //
  // The `Record<ToolId, true>` restates the union deliberately: TypeScript checks THAT for
  // exhaustiveness, so a member added to `ToolId` fails to compile here — which is the half
  // a runtime array cannot buy — and this case then proves the registrations cover it. Same
  // two-part shape as `action-table.ts`'s `FAMILY_IDS` guard, for the same reason.
  const declared: Record<ToolId, true> = { brush: true, segment: true };
  // Both sides widened to `string[]` deliberately — `Object.keys` gives `string[]`, and
  // narrowing it back with a cast would be the assertion asserting its own premise.
  const registered: string[] = toolEntries().map((d) => d.id);
  expect(registered.sort()).toEqual(Object.keys(declared).sort());
});

test("`segment` declares no capability — its strip renders the BRUSH's controls", () => {
  const segment = toolEntries().find((d) => d.id === "segment");
  expect(segment?.canActivateControl).toBeUndefined();
  expect(toolCanActivateControl("segment", ctx("material", 1))).toBe(true);
});

// --- (3) the dead-control answer, as a grid ----------------------------------

test("the brush kills the material control on a catalog with nothing to choose between", () => {
  // ONE row per (control, class count) that can differ. `material` is the only control whose
  // verdict moves, and 0/1/2 are the three counts that can move it: empty and single-class
  // catalogs have nothing to pick BETWEEN, two is the first that has.
  const grid: [ParamId, number, boolean][] = [
    ["material", 0, false],
    ["material", 1, false],
    ["material", 2, true],
    ["material", 7, true],
    ["radius", 0, true],
    ["radius", 2, true],
    ["mask", 0, true],
    ["mask", 2, true],
    ["hollow", 0, true],
    ["hollow", 2, true],
    ["strength", 0, true],
    ["strength", 2, true],
    ["iterations", 0, true],
    ["iterations", 2, true],
    ["mode", 0, true],
    ["mode", 2, true],
  ];
  // Asserted as ROWS rather than 16 bare booleans, so a failure names the control and the
  // count it disagreed about instead of printing `false !== true`.
  expect(
    grid.map(([control, n]) => [
      control,
      n,
      toolCanActivateControl("brush", ctx(control, n)),
    ]),
  ).toEqual(grid);
});

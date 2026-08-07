// The tool registry: which tools EXIST, and which of their controls are LIVE.
//
// Two questions, one table. `toolEntries()` answers the first — the enumeration T4's MCP
// surface needs, in registration order — and `toolCanActivateControl` answers the second,
// which is the dead-control question the strip used to answer with a literal of its own
// (`tool-params.tsx`'s `availableParams`, the ONE rule this absorbs).
//
// WHAT IT DELIBERATELY DOES NOT OWN. The registry owns EXISTENCE; `action-table.ts` next
// door goes on owning PRESENTATION — which member a family lists, in what order, under what
// label, with which params. Registration order here is not rail order and nothing may read
// it as one: the rail's columns are `FAMILY_ROWS`' array order and the strip's controls are
// `EffectRow.params.all`'s. Two tables, two questions, no join between them beyond the ids.
//
// ── WHY THIS IS ON THE FLOOR AND NOT UNDER `field-host/` ─────────────────────────────────
//
// The T3c plan names `field-host/tool-registry.ts`. It cannot be there, and three separate
// facts each decide it on their own:
//
//   1. THE CHROME HAS TO READ THE CAPABILITY ANSWER AT RUNTIME. `availableParams` runs in a
//      React render, and the chrome may not value-import anything whose specifier reaches under
//      `field-host/` — the barrel carries core, and a second core in the main bundle is what
//      `tests/frontend-no-engine-leakage.test.ts` exists to prevent. This is the same
//      argument `field-limits.ts` makes in its own header, and it reaches the same verdict:
//      which module a fact lives in is decided by which layer has to reach it.
//   2. THE DESCRIPTOR TABLE MUST BE DOM-FREE (foundations spec §3.3) so a daemon process can
//      import it for MCP. `field-host/` is the DOM-facing half of the editor by definition.
//   3. `action-registry/` — the other DOM-free node — is not available either: the file list
//      it may contain is PINNED by name in `frontend-no-engine-leakage.test.ts`, and adding
//      a fifth would rewrite that pin rather than satisfy it.
//
// So the floor: React-free and engine-value-free, both machine-enforced. Reachable by the
// chrome, by the host, and by an in-repo Node process (the daemon) through a RELATIVE path —
// not through the package specifier, since `package.json`'s `exports` map names only
// `./action-registry` and `./field-host`. Nothing needs the specifier today; if MCP ever
// wants one, that is a one-line `exports` addition rather than a move.
//
// ── THE TWO BUNDLES, WHICH IS WHAT MAKES ALL OF THIS STRUCTURAL ──────────────────────────
//
// The chrome and the host are not two directories in one bundle. They are two BUNDLES:
//   - The chrome is built from `src/frontend/index.html` plus the two worker entries
//     (`scripts/build-frontend.ts`). `field-host/` is not an entrypoint and nothing in that
//     graph imports it as a value.
//   - The host reaches the browser as `/engine.js`, a SEPARATE esbuild bundle the chrome
//     fetches and dynamically imports at runtime (`frontend/lib/engine.ts`'s `loadEngine`).
// So each graph gets its OWN module instance of this file, and therefore its own `TOOLS`
// Map. That is not an incidental packaging detail that a bundler flag could change — it is
// the project-first invariant's whole shape, and it is why "register from the host" below is
// not a solvable problem but an impossible one.
//
// ── WHY THERE IS NO `build` ON THE ROW ───────────────────────────────────────────────────
//
// The plan's `ToolDefinition` carries `build(deps): ToolInstance` beside the capability
// answer. The two cannot share a row, and it is the same layer fact read once more: `build`
// for the one tool that HAS a factory today is `createSegmentBrush`, a VALUE in `field-host/`
// and immovable — it value-imports `field-ghost.ts`, which value-imports
// `@furnace/core/field`.
// So a row carrying it can only be written in `field-host/`, where, by (1) above, the chrome
// can never read the capability answer sitting beside it.
//
// TWO WAYS OUT WERE CONSIDERED AND BOTH FAIL, and it is worth writing down which, because
// the second one is the one that looks like it works:
//
//   (i) REGISTER THE WHOLE ROW FROM THE HOST. Dead on arrival: per the two-bundles note
//       above, that registration never runs in the chrome's graph, so the strip would query
//       an empty table and take the default — a dead control back on screen with every test
//       green.
//  (ii) SPLIT THE REGISTRATION: the capability answer registered here as it is now, and the
//       host ATTACHES only the builder (`attachToolBuilder(id, fn)`). The chrome never reads
//       `build`, so its missing builder looks harmless. It is not, for two reasons that (i)
//       does not have:
//        (a) It makes the table's CONTENTS bundle-dependent while its TYPE says otherwise. A
//            chrome caller writing `entry.build(deps)` type-checks, and gets `undefined is
//            not a function` in the browser — with the whole suite green, because tests run
//            UN-BUNDLED in one process where the host's attach has run and the builder IS
//            present. A defect no test can reach is worse than one no test catches.
//        (b) It destroys the "filled once at import, never mutated" property the module-scope
//            note below leans on as its own safety argument. A table a host mutates at
//            construction is per-host state living at module scope, which is the bug that
//            property exists to exclude.
//
// A separate host-side registry keyed by the same ids was considered and rejected too: it
// converts a bundle-visibility problem into a drift class — two enumerations of one set with
// nothing pinning them equal, which is precisely the shape `4ed53447` had just removed.
//
// Which leaves a `build` with no caller that does not either cast or change behaviour. The
// builder half is deferred whole rather than half-built; T3c's registry answers who exists
// and who is live, and nothing else.
//
// ── THE INSTANCE IS MODULE SCOPE, AND THAT IS THE POINT ──────────────────────────────────
//
// {@link createToolRegistry} builds a fresh one — the machinery is a factory, on core's
// `createRegistry` precedent — but the editor's own registry is the module-scope one below,
// because a per-host instance is exactly the split brain described above: the chrome holds
// no host. NOTHING MACHINE-ENFORCES EDITOR MODULE GLOBALS TODAY (core pins its own in
// `packages/core/tests/architecture.test.ts`; the editor has no such list), so this note is
// the pin: the state here is a table filled once at import and never mutated afterwards, and
// the registrations sit in THIS file rather than in any consumer for the reason above.
//
// WHAT ACTUALLY GUARANTEES "FILLED ONCE AT IMPORT" is the import list two lines down: this
// module has ZERO value imports (both lines are `import type`, erased). No cycle can route
// back through it, so there is no order in which a consumer — `tool-params.tsx` reading it
// during a render, say — can observe `TOOLS` half-filled. A value import added here would
// cost that guarantee, whatever else it cost.
import type { MaterialTable } from "@furnace/core/field"; // type-only: erased
import type { ParamId } from "./action-table.ts";

/** The tools the editor has. Two today, and both of them write the field: the ordinary
 *  stroke brush, and the two-click swept capsule beside it.
 *
 *  NOT the rail's member list, which is longer and differently shaped — the four brush
 *  EFFECTS are modes of one tool, and the three cell-selection gestures select rather than
 *  tool. What makes something a member here is having an answer to give: `segment` is
 *  registered because it exists as a tool, `brush` because it owns the strip's controls. */
export type ToolId = "brush" | "segment";

/** Everything a capability query may branch on.
 *
 *  ONE control and the project's material classes, which is exactly what the rule this
 *  absorbs read. `control` is in here rather than the query being per-TOOL because the
 *  question the strip asks is per-CONTROL: a one-class catalog kills the swatches under fill
 *  and leaves radius, mask and hollow alone, and a tool-wide verdict could only kill all
 *  four or none. */
export type ToolCapabilityCtx = {
  /** The control being asked about — one knob on the brush strip. */
  readonly control: ParamId;
  /** The project's material classes, as the catalog resolved them. */
  readonly classes: MaterialTable["classes"];
};

/** What a tool is, to everything that is not the tool. */
export type ToolDefinition = {
  readonly id: ToolId;
  /** May this tool's control render LIVE against the current material classes?
   *
   *  The dead-control answer. A control that cannot do anything is worse than a missing one:
   *  it invites a press and then eats it, with nothing on screen saying why. Omitting the
   *  member says "all of them, always" — which is the honest answer for a tool with no
   *  catalog-shaped dependency, and keeps the common row down to its id.
   *
   *  `…Control`, NOT the bare `canActivate` the T3c plan and the foundations spec both name,
   *  and the suffix is doing real work. This asks about ONE CONTROL — {@link
   *  ToolCapabilityCtx} carries which — because that is the shape the rule it absorbs has.
   *  The per-TOOL question ("may this tool be armed at all?") is a different one that T4's
   *  MCP surface will want, and `canActivate` is the name it should get. Spending the obvious
   *  name on the narrower question is how the two would end up telling one story. */
  canActivateControl?(ctx: ToolCapabilityCtx): boolean;
};

/** A named-entry store over {@link ToolDefinition}, with setup-loud duplicate registration. */
export type ToolRegistry = {
  /** @throws {Error} on a duplicate id — a programming error at setup, so loud. */
  define(def: ToolDefinition): void;
  /** The registered tools in REGISTRATION ORDER (Map insertion order), a fresh array each
   *  call so mutating it never touches the registry.
   *
   *  Core's `Registry.entries()` returns `[name, entry]` pairs; these rows carry their own
   *  id, so a pair would spell it twice — the one deviation from that shape, and it is the
   *  same rule `action-table.ts` applies to its own derived members. */
  entries(): ToolDefinition[];
  /** {@link ToolDefinition.canActivateControl}, with the default applied. */
  canActivateControl(id: ToolId, ctx: ToolCapabilityCtx): boolean;
};

/**
 * Create a tool registry. The editor's own is the module-scope one behind
 * {@link defineTool}; this exists because the machinery is a factory on core's
 * `createRegistry` precedent, and because a unit test may drive it without touching the
 * registrations the editor ships.
 *
 * @returns An empty registry. Never fails.
 */
export function createToolRegistry(): ToolRegistry {
  const store = new Map<ToolId, ToolDefinition>();
  return {
    define(def) {
      // SETUP-LOUD. Two tools under one id is not a state any runtime branch could recover
      // from — one of them is unreachable and which one depends on import order. It fires at
      // module init, where a throw takes the shell down before first paint and fails the
      // suite in CI, which is the whole point of raising it here rather than returning false.
      if (store.has(def.id))
        throw new Error(
          `tool-registry: tool "${def.id}" is already registered`,
        );
      store.set(def.id, def);
    },
    // NO `get`. Core's registry has one because `getService` needs it; nothing here does —
    // the chrome asks {@link ToolRegistry.canActivateControl} and the enumeration asks
    // `entries()`, and a lookup nobody calls is surface a later reader has to decide whether
    // to trust.
    entries: () => [...store.values()],
    canActivateControl(id, ctx) {
      const def = store.get(id);
      // RUNTIME-QUIET, both ways. A tool with no answer says all its controls are
      // live; an id with no tool says the same. The second is unspellable through the union
      // above, and the reason it does not throw anyway is the caller: every one of them is
      // inside a React render, where a throw over one knob takes the whole strip down.
      if (def?.canActivateControl === undefined) return true;
      return def.canActivateControl(ctx);
    },
  };
}

/** The editor's tools. Private: the three functions below are the whole surface, so nothing
 *  can hand a caller a mutable handle to the table. */
const TOOLS = createToolRegistry();

/**
 * Register a tool.
 *
 * @param def - The tool.
 * @throws {Error} on a duplicate id (setup-loud — see {@link createToolRegistry}).
 */
export function defineTool(def: ToolDefinition): void {
  TOOLS.define(def);
}

/** The registered tools in registration order — the enumeration, fresh array each call.
 *
 *  REGISTRATION ORDER IS NOT PRESENTATION ORDER. Nothing that draws may read this as one;
 *  `action-table.ts` owns every order a user sees. */
export function toolEntries(): ToolDefinition[] {
  return TOOLS.entries();
}

/** May `id`'s control render live? `true` for a tool that declared no answer, and for an id
 *  that was never registered — see {@link createToolRegistry} for why neither throws. */
export function toolCanActivateControl(
  id: ToolId,
  ctx: ToolCapabilityCtx,
): boolean {
  return TOOLS.canActivateControl(id, ctx);
}

// ── the editor's two tools ───────────────────────────────────────────────────────────────
//
// REGISTERED HERE, in the module that declares the machinery, and not by the host or the
// chrome. The two-bundles note above is the whole reason: a `defineTool` call written in
// `field-host/` runs in the `/engine.js` graph and never in the chrome's, so the strip would
// query an EMPTY table and take the default — a dead control back on screen with every test
// still green. The registrations belong to the table for the same reason `FAMILY_ROWS`
// belongs to `action-table.ts`.

defineTool({
  id: "brush",
  // THE ONE RULE, moved rather than rewritten. It was `id === "material" ? classes.length > 1
  // : true` inline in `availableParams`, and it says: a swatch strip with nothing to choose
  // BETWEEN is a control that cannot do anything. One class means every press re-picks what
  // is already picked.
  //
  // Filtering here rather than at the strip's slice is what keeps it from costing a slot:
  // `availableParams` runs BEFORE the ≤4 cap is applied, so a material param a one-class
  // catalog cannot fill never eats one of the four and strands a real control behind the ⋯.
  canActivateControl: ({ control, classes }) =>
    control === "material" ? classes.length > 1 : true,
});

// NO `canActivateControl`, and that is a fact about the tool rather than an omission: the segment
// strip renders the armed EFFECT's params, because a segment click commits a brush op built
// from the live effect and material (`field-segment.ts`'s `segmentClick` → `commitToolOp`).
// So the controls under it are the BRUSH's controls and the brush's answer is the one that
// governs them. What this registration carries is existence.
defineTool({ id: "segment" });

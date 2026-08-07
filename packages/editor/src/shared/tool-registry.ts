// The tool registry: which tools EXIST, and which of their controls are LIVE.
//
// Two questions, one table. `toolEntries()` answers the first — the enumeration T4's MCP
// surface needs, in registration order — and `toolCanActivate` answers the second, which is
// the dead-control question the strip used to answer with a literal of its own
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
//   1. THE CHROME HAS TO READ `canActivate` AT RUNTIME. `availableParams` runs in a React
//      render and the chrome may not value-import anything whose specifier reaches under
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
// So the floor: React-free and engine-value-free, both machine-enforced, and importable by
// the chrome, the host and a bare Node process alike.
//
// ── WHY THERE IS NO `build` ON THE ROW ───────────────────────────────────────────────────
//
// The plan's `ToolDefinition` carries `build(deps): ToolInstance` beside `canActivate`. The
// two cannot share a row, and it is the same layer fact read once more: `build` for the one
// tool that HAS a factory today is `createSegmentBrush`, a VALUE in `field-host/`, so a row
// carrying it can only be written in `field-host/` — where, by (1) above, the chrome can
// never read the `canActivate` sitting beside it. Registering from the host into a
// module-scope table here does not rescue it: the chrome's bundle does not import
// `field-segment.ts`, so that registration would simply never run in the chrome's graph and
// every capability query would silently fall back to its default. A registry that answers
// differently depending on which bundle is asking is worse than no registry.
//
// Which leaves a `build` with no caller that does not either cast or change behaviour — and
// this repo does not ship surface with no caller. The builder half is deferred whole rather
// than half-built; T3c's registry answers who exists and who is live, and nothing else.
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
   *  catalog-shaped dependency, and keeps the common row down to its id. */
  canActivate?(ctx: ToolCapabilityCtx): boolean;
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
  /** {@link ToolDefinition.canActivate}, with the default applied. */
  canActivate(id: ToolId, ctx: ToolCapabilityCtx): boolean;
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
    // the chrome asks {@link ToolRegistry.canActivate} and the enumeration asks `entries()`,
    // and a lookup nobody calls is surface a later reader has to decide whether to trust.
    entries: () => [...store.values()],
    canActivate(id, ctx) {
      const def = store.get(id);
      // RUNTIME-QUIET, both ways. A tool with no `canActivate` says all its controls are
      // live; an id with no tool says the same. The second is unspellable through the union
      // above, and the reason it does not throw anyway is the caller: every one of them is
      // inside a React render, where a throw over one knob takes the whole strip down.
      if (def?.canActivate === undefined) return true;
      return def.canActivate(ctx);
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
export function toolCanActivate(id: ToolId, ctx: ToolCapabilityCtx): boolean {
  return TOOLS.canActivate(id, ctx);
}

// ── the editor's two tools ───────────────────────────────────────────────────────────────
//
// REGISTERED HERE, in the module that declares the machinery, and not by the host or the
// chrome. A `defineTool` call written in `field-host/` would never run in the chrome's
// bundle (nothing there imports the host), so the strip would ask an EMPTY registry and get
// the default — a dead control back on screen with every test still green. The registrations
// belong to the table for the same reason `FAMILY_ROWS` belongs to `action-table.ts`.

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
  canActivate: ({ control, classes }) =>
    control === "material" ? classes.length > 1 : true,
});

// NO `canActivate`, and that is a fact about the tool rather than an omission: the segment
// strip renders the armed EFFECT's params, because a segment click commits a brush op built
// from the live effect and material (`field-segment.ts`'s `segmentClick` → `commitToolOp`).
// So the controls under it are the BRUSH's controls and the brush's answer is the one that
// governs them. What this registration carries is existence.
defineTool({ id: "segment" });

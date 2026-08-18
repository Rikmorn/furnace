# packages/editor Layer Map — Extend-vs-Rework Audit for the Generation Cockpit

> Read-only audit feeding the Epic 3 (Generation Cockpit) refocus design, 2026-07-06 (branch
> `epic2-slice2.2.5b-phase-b2-topology-generator`). All claims verified in-session against the
> cited files unless labeled otherwise. Companion research lanes:
> `2026-07-06-epic3-cockpit-workflow-prior-art.md`, `2026-07-06-epic3-generator-entity-precedent.md`.

## 1. Inventory

**Commands — 17, all in `packages/editor/src/daemon/handlers.ts`** (verified against the registry; matches `docs/reference/editor-architecture.md` §4/§10.1): `scene.list`, `scene.read`, `scene.open`, `scene.get`, `scene.save`, `scene.validate`, `scene.introspect`, `scene.addEntity`, `scene.removeEntity`, `scene.setComponent`, `scene.removeComponent`, `scene.setResource`, `scene.removeResource`, `scene.setSettings`, `scene.batch`, `scene.undo`, `scene.redo`. All zod `strictObject`, single `dispatch()` choke point (handlers.ts:248). `tableEnum = ["geometries","shaders","materials"]` (handlers.ts:23) — textures/effects not command-mutable.

**Panels/UI surfaces:** exactly 3 dockview panels — `entities`, `viewport`, `inspect` — added once in `App.tsx` `onReady` (App.tsx:228–246), plus non-docked `Toolbar` (scene picker/save/undo/redo) and `StatusBar`. Module-level `COMPONENTS` map (App.tsx:25–29); state reaches panels via `EditorContext` through dockview portals, fresh context value per render (App.tsx:250).

**Viewport capabilities** (`src/viewport-host/index.ts`, 772 LOC): GPU-id picking (`loaded.pick`, per-click alloc/free), AABB selection highlight (depth-tested `drawLines`), translate-only gizmo (3-axis, anchor-relative-absolute, multi-select one-undo; no rotate/scale gizmo), orbit/pan/zoom camera + F-frame (`camera-control.ts`, pure math), render-on-demand (no rAF), live-preview seam (`previewEntity` w/ transform fast-path, `previewSettings`, `revertEntity`, `revertSettings`, `syncCommitted`). Renders `lights`+`ambient` but `effects: []` on a non-HDR context (index.ts:283–291).

**Document session** (`src/daemon/session.ts`, 269 LOC): one open document; transactional `apply` = clone → pure edit (`mutations.ts`) → registry `validateDocument` → commit/emit; snapshot undo capped at 100; dirty = canonical-serialize vs `savedText`; chokidar file watching with the conflict matrix (echo-suppress / conflict / invalid / clean-reload-as-undoable-mutation). SSE feed (`events.ts`, 46 LOC) is notification-only dirty-bits.

## 2. Layer map (src/ ≈ 4,170 LOC: daemon 1,272 · frontend 1,880 · viewport-host 1,019)

| Module | Layer | LOC | Notes |
|---|---|---|---|
| daemon: `server.ts`, `events.ts`, `errors.ts`, `config.ts`, `bundle.ts`, `registry-bundle.ts`, `watch.ts`, `main.ts` | **substrate** | ~570 | HTTP routes, SSE hub, error contract, config namespacing, both esbuild targets. Genuinely product-agnostic. |
| daemon: `session.ts` | substrate-with-product-coupling | 269 | Transactional/undo/watch pattern generic; coupled to `SceneDocument` + registry `validateDocument`. |
| daemon: `handlers.ts`, `mutations.ts`, `scenes.ts` | **product** (scene-inspector) | ~430 | The command *set* is entity/component/resource CRUD — but the registry *mechanism* is substrate; adding cockpit commands is additive. |
| viewport-host: `index.ts` | mixed | 772 | init/loadScene/resize/render skeleton + orbit wiring ≈ substrate (~250); preview/revert/gizmo/pick/commit loop = inspector product (~500). |
| viewport-host: `camera-control.ts`, `input-map.ts` | substrate | 84 | Pure orbit math — carries over untouched. |
| viewport-host: `gizmo.ts`, `box-edges.ts` | product | 163 | Manipulation-specific. |
| frontend: `lib/api.ts`, `lib/events.ts`, `lib/engine.ts`, `lib/cn.ts` | substrate | ~140 | Command client, SSE subscribe, `loadEngine()` dynamic import. |
| frontend: `components/*` (App, panels, Toolbar, StatusBar, Viewport) + `lib/state.ts` | **chrome** | ~830 | Dockview shell + reducer; ~half of App.tsx is reusable plumbing (refreshSession/echo dedup), the rest is inspector-shaped. |
| frontend: `inspector/**` | **product** | 901 | Reflection-driven SchemaForm + 12 field renderers + echo-guard/scrub/vec-fan/euler libs. Pure property-editor. |

**Rough proportions: ~30% substrate (~1,250 LOC), ~55% scene-inspector product (~2,300), ~15% chrome shell (~620).** The substrate layers are clean, small, well-tested (30 test files; ~15 cover daemon substrate + guardrails), and product-agnostic; the bulk of the LOC is the property-editing product.

## 3. Cockpit reuse map (generate → reroll → freeze/curate → bake → walk)

**Carries as-is:** daemon server/routes/SSE/error-contract/config (~570 LOC); command registry + `dispatch` mechanism (new cockpit commands are just `handlers.set(...)` entries); both bundling targets (`bundle.ts`, `registry-bundle.ts`); `loadEngine()` seam + the two leakage-guard tests; orbit camera math; viewport-host init/resize/render-on-demand skeleton; GPU picking (useful for "click a room → inspect its provenance/seed").

**The plug-in answer — the generator is reachable through the existing seam, cheaply.** `bundle.ts:26–43` builds a *virtual stdin entry* with `resolveDir: root` that already imports arbitrary consumer code (`extensionsEntry` from `furnace.config.json`'s `editor.extensions` block, config.ts:5–8) into the browser engine bundle. Nothing restricts that entry to side-effect registration — it can re-export consumer symbols (e.g. `buildWorldGraph`, `layoutWorld`, `realizeRegion`), or a cockpit-host protocol can let extensions register named generator functions. `layoutWorld` is pure TS (no GPU/Rapier/wall-clock) and `realizeRegion` already runs in-browser in `main.ts`, so browser-side generate-and-render is feasible today. **Missing wiring, trivially added:** `packages/dungeon/package.json` has no `@furnace/editor` devDep, no `edit` script, no `furnace.config.json` (verified; hello-world has all three).

**Needs rework:**
- `ViewportHost` is `SceneDocument`-centric — `loadScene(doc)` is the only content entry point. A generated `RegionData` world is *not* a scene document; the cockpit host needs either an imperative "render these meshes/instanced groups" mode or a generator→document path.
- The scene format cannot express the generated world: `grep -rn instanced packages/core/src/scene/` → zero hits, and `renderLoaded` passes no `instanced` param (index.ts:275–292) — all scatter (the 5-layer cave showcase) is invisible through the document pipeline. No fog in scene settings either. "Bake to document, view in editor" under-renders badly today.
- Bake-to-disk (`.fmesh` + region docs) needs daemon-side FS commands — new command surface, but that's exactly what the registry mechanism is for.
- Document session semantics: reroll previews should not be undoable document mutations; a cockpit needs an ephemeral generation-state channel beside (not inside) the session. The SSE hub itself is generic and fine.

**Dead weight for the cockpit:** the 901-LOC inspector module (reflection forms — possibly partial reuse for gen-params), gizmo/box-edges manipulation loop, the entity/component CRUD command set.

## 4. Known gaps

Backlog `docs/backlog/editor-and-tooling/` (14 entries; 7 editor-core, 7 adjacent/unrelated):
- `editor-interaction-model-redesign.md` — **the master entry**: 7 gate-evidence items; editor shelved pending target-app needs.
- `editor-M5B-viewport-interaction.md` (gone) — deferred: resource live-preview cascade (`rebuildResource`), WASD fly-camera, hierarchy tree; reopened ⑫ (no-op commit suppression regression, reverted). *(The tracker was un-merged at genre-contracts; the fly-camera landed in Slice 3.2, the cascade and the hierarchy tree are closed by the scene deletion, and the ⑫ successor is `no-op-revision-suppression.md`.)*
- `docs/backlog/editor-and-tooling/editor-seams-and-preview-deferrals.md` § *Editor viewport HDR context + post-chain preview* — non-HDR context, `effects: []` deferral.
- `docs/backlog/editor-and-tooling/editor-chrome-authoring-gaps.md` (gone) § *Editor authoring of the `textures` + `effects` resource tables* — `tableEnum` blocks texture/effect mutation. *(That section was removed at foundations T2 when `@furnace/core/scene` and the `scene.*` command family were deleted — a gap between two deleted things — and the tracker itself was un-merged at genre-contracts.)*
- `editor-ai-integration-milestone.md` — MCP mount, `viewport.capture`, embedded agent (descoped from M4).
- `session-concurrent-open-race-hardening.md` — two await-point races in `session.ts`, benign single-user, load-bearing under continuous interaction/second writer (a cockpit's reroll loop qualifies).
- `editor-backend-architecture.md` — decision history (fourth pillar, MCP-first, dual-mode).

**Pain 1 corroborated — panel restore:** `App.tsx:228–246` adds panels only in `onReady`; no `addPanel` affordance afterward, no layout persistence, no `onDidRemovePanel` handling anywhere in `src/frontend`. Redesign entry item 7 documents it verbatim ("closing a panel requires a full page refresh").

**Pain 2 corroborated — error-prone property editing:** redesign entry items 1–6 (resource edits don't cascade; light edits don't stick in Safari; schema accepts loader-invalid combos; sea-of-numbers NumberField; no alpha in ColorField; reflection ceiling). The fragility signature in code: **three stacked echo-suppression mechanisms** — canonical `savedText` watcher-echo suppression (session.ts), `lastLoaded (path,revision)` SSE dedup + `suppressEcho` (App.tsx:34–46,103–124), and the focused-input `shouldReseed` guard (`inspector/lib/echo-guard.ts`) — plus the ColorField blur→change Safari saga (arch doc §11.9). **Doc↔code drift found (verified):** arch doc §11.6 claims `revertSettings` is "wired to the InspectPanel.tsx onCancel handler", but `revertSettings` has zero call sites outside its definition (viewport-host/index.ts:91,731); `InspectPanel.tsx:176–179` settings `onCancel` is a no-op with a stale "M5A gap … 5B" comment, and `EditorActions` (App.tsx:142–171) never exposes it — a previewed settings change still sticks after Escape. The inspector has no field-render test harness (the process gap that let the ColorField bug through — noted in the redesign entry).

## 5. Honest risk list (for a cockpit on this substrate)

1. **The document pipeline can't represent the generated world.** No instancing, no fog in the scene format (verified above); HDR post (`bloom→tonemap`) deferred on a non-HDR viewport context. A cockpit preview through `loadScene(doc)` would show bare geometry minus all scatter and mood. The realistic path is an imperative cockpit-host render mode (consumer `realizeRegion` output → `frame.render({meshes, instanced})` with an HDR context) — a new host, not an extension of `loadScene`.
2. **Transient generation state has no home.** The daemon's only state container is the document session (mutation→validate→undo→SSE). Reroll previews as document mutations would spam the 100-deep undo stack and the dirty/conflict machinery; keeping them browser-side only loses the "freeze/bake" handoff. A cockpit needs a designed ephemeral-session concept; the session's two known await races become load-bearing exactly then.
3. **The inner loop hits the staleness gap.** No extension-file watching (arch doc §3/§9): editing generator TS requires browser refresh (engine bundle) or scene re-open (registry). For a cockpit whose core loop is "tweak generator → reroll", today's substrate makes every code tweak a manual full refresh — and the panel-restore bug makes refresh the norm anyway. Fixable (esbuild watch + SSE "rebuilt" event), but day-one work.
4. **Chrome scales badly and is the confirmed pain locus.** Fresh context value per render re-renders every portaled panel on any state change (App.tsx:250 — intentional at 3 panels); no layout persistence/restore; no component test harness. A cockpit adds panels (seed/params, graph view, provenance, bake queue) — extending this chrome multiplies known fragility; this is the layer where rework is cheapest and most justified.
5. **Preview-path perf with generated content is unmeasured.** `previewEntity` does `structuredClone(committedDoc)` + `rebuildEntity` per non-transform edit (index.ts:709–714); `pick` allocates/frees all GPU transient resources per click; render-on-demand re-renders the full scene per pointermove during orbit. Fine for bowling-scale docs; a generated wing (hundreds of boxes + Surface-Nets meshes + instanced groups) needs measuring before curation UX is built on it.

**Bottom line:** substrate (~30% of LOC) is sound and cockpit-ready, including the load-bearing answer that project-first bundling can reach the dungeon's generators exactly the way it reaches extensions (one config line + one devDep away). The product layer (~55%) is scene-inspector-shaped and mostly dead weight or partial-reuse for a cockpit. The chrome (~15%) is small but is where both named pains live, plus one doc↔code drift (`revertSettings` unwired) worth fixing or re-documenting regardless of direction.

**Fed:** the Epic 3 Generation-Cockpit refocus, cited by name in `docs/learnings/seals/2026-07-04-epic2-2.2.5b-phase-b1-built-interfaces.md` and in `docs/reference/editor-architecture.md`.

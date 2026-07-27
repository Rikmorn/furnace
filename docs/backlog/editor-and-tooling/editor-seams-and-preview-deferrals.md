# Editor seams, contracts, and preview-fidelity deferrals

Tracker for the editor's BOUNDARY items: the project-first `editor-extensions` seam
(what it re-exports vs what the cockpit actually consumes, and what it would take to make
the generation contract explicit rather than an ad-hoc cast), the preview surface's
dockview/WebGPU lifecycle problem, and the two render-path fidelity deferrals in the
viewport host, and the field worker protocol's un-guarded generator evaluate. Merged so
there is **one place to check whenever you touch the project-first bundle boundary
(`packages/dungeon/src/editor-extensions.ts`, `packages/editor/src/daemon/bundle.ts`), the
viewport host's render path (`packages/editor/src/viewport-host/index.ts`), or the field
worker protocol (`packages/editor/src/frontend/lib/field-protocol.ts`)**. Sections keep
their original content.

## `editor-extensions.ts` re-exports more than the editor consumes

**Context.** Surfaced at the W4 sweep. `packages/dungeon/src/editor-extensions.ts` is the
editor's project-first bundle entry. The editor's LIVE `ext.*` surface is **six** members
across **three** boundary casts (re-counted 2026-07-26, F4 tranche B — was five across two):

- main thread (`WorldPanel.tsx`'s boundary cast): `realizeRegion`, `MaterialCache`, `worldDir`
- generation worker (`generation-protocol.ts`'s `WorkerEngine`): `runWorld`, `bakeWorldFiles`
- analyzer worker (`analyzer-protocol.ts`'s `AnalyzerEngine`, F4): `analyzerVerify`

These re-exports have **zero consumers**: `caveDressing`, `caveProxy`, `DEFAULT_WORLD`,
`validateWorldSpec`, **`AGENT`**, and the type re-exports (`BakeFile`, `WorldManifest`,
`WorldRegionEntry`, `WorldConnectorEntry`, plus F4's `AnalyzerVerifyOptions` / `VerifyLane` /
`VerifyLaneOutcome` / `VerifyOutcome` / `VerifyReason` / `VerifyVerdict`). (`DEFAULT_WORLD`
and `BakeFile` each appear once more in the editor — both in *comments*, not imports.
`AGENT` is a NEW zero-consumer value re-export: the editor gets the same agent profile as
DATA, by fetching and parsing `catalog/agent.json`, because the advisor's premise must not
depend on the project shipping a bundle entry. The F4 verdict types are likewise unreachable
— the editor declares its own structural twin, `VerifyVerdictWire`, for the reason the
`WorldSpecLike` / `BakeFileLike` mirrors already exist.)

The editor has **no `@furnace/dungeon` dependency** and cannot import the types at all; it
declares its own structural mirrors (`WorldSpecLike`, `BakeFileLike`). The module header's
rationale — that the re-exports "prove the graph is browser-bundlable" — does not cover them:
**type re-exports are erased and force nothing into a bundle**, and `themes/cave.ts` is
already pulled into the graph by `world-build.ts`, so `caveDressing`/`caveProxy` prove nothing
the existing import doesn't.

W4 did **not** trim them because the 3.3 spec explicitly enumerated them as "the world seam
stays" — so this is a **deliberate, recorded deferral, not an oversight**. Recording it here
so the next boundary pass doesn't have to re-derive which members are load-bearing.

**Trigger to revisit:** the next pass on the project-first boundary contract (couples to
the *Generation session as a generic editor facility* section below — the same seam, from
the contract side).

**Reference:** `packages/dungeon/src/editor-extensions.ts` (the seam),
`packages/editor/src/frontend/components/WorldPanel.tsx` (main-thread cast — three members),
`packages/editor/src/frontend/lib/generation-protocol.ts` (`WorkerEngine` — two members),
`packages/editor/src/frontend/lib/analyzer-protocol.ts` (`AnalyzerEngine` — one member),
`docs/reference/editor-architecture.md` §13.2 + §19 (the as-built seams).

## Generation session as a generic editor facility

**Context.** Slice 3.1's spec (Decision 3) noted that the generation session / orchestration layer will eventually become a **generic editor facility** — a reusable cockpit into which *any* project plugs its own generator — rather than something the dungeon owns. For 3.1 it stays **dungeon-owned** and is reached entirely through the consumer's `editor-extensions.ts` seam: the engine bundle re-exports that module as an `extensions` namespace (`export * as extensions`, see `editor-architecture.md` §3a/§13.2), and the cockpit calls the generator through it. The set the editor calls is SIX members — `realizeRegion` / `MaterialCache` / `worldDir` (main thread), `runWorld` / `bakeWorldFiles` (generation worker), and F4's `analyzerVerify` (analyzer worker) — and is therefore a **de-facto protocol**: today it is narrowed at three boundary casts — the WorldPanel's main-thread seam (`WorldPanel.tsx`), the generation worker's `WorkerEngine` (`generation-protocol.ts`) and the analyzer worker's `AnalyzerEngine` (`analyzer-protocol.ts`) — with no formal contract. F4 adding a third cast rather than a formal contract is the entry's own trigger firing without being acted on, and is worth saying: the implicit protocol is now growing per-worker. Nothing in the editor is dungeon-specific — the panel drives the generic preview host (`createPreviewHost`) with whatever realize code the namespace provides — but the *shape* of the protocol is implicit rather than declared.

Promoting this to a facility means: (1) declaring the generator-consumer contract explicitly (the names + signatures the panel depends on), so a project satisfies it by implementing an interface rather than by matching an undocumented cast; (2) deciding where per-project config is declared — today the editor hand-mirrors the dungeon's knob shapes in its own `world-draft.ts` (region presets + the Add-region field set) rather than reading them off the seam (the measured `COCKPIT_*` envelope/budget knobs this entry originally named retired with the attempts orchestration at the W4 sweep); and (3) confirming the preview-host mood constants (fog / ambient / headlamp — currently hand-tuned to the dungeon's `main.ts`) are either generic defaults or consumer-supplied.

**Trigger to revisit.** A second project wants cockpit generation (forcing the contract to be explicit rather than dungeon-shaped), OR the Slice 3.3 generator-entity / socket work formalizes the generation contract (at which point the panel↔generator protocol should be defined alongside it, not left as an ad-hoc cast). The field charter's brush editor re-shapes this contract — fold into that brainstorm if it lands first.

**Reference.** `packages/dungeon/src/editor-extensions.ts` (the seam — the re-export surface the cockpit consumes; its over-wide re-export set is tracked separately in the *`editor-extensions.ts` re-exports more than the editor consumes* section above); `packages/editor/src/daemon/bundle.ts` (the `export * as extensions` namespace re-export); `packages/editor/src/frontend/components/WorldPanel.tsx` + `src/frontend/lib/generation-protocol.ts` + `src/frontend/lib/analyzer-protocol.ts` (the three boundary casts that narrow the untyped namespace); `docs/reference/editor-architecture.md` §13.2 + §19 (the as-built seams).

## Generation preview should be its own dockview panel, not a viewport takeover

Found at the Slice 3.2.2 editor gate (2026-07-09). The generation cockpit preview renders
on a SECOND canvas that shares the Viewport panel and swaps in via `visibility` when
`state.generationActive` (`packages/editor/src/frontend/components/Viewport.tsx` ~:143–160).
Activating a preview therefore HIDES the scene viewport — "it takes over the viewport tab."
The user wants preview as its own surface so the scene stays visible while previewing.

**Why this isn't a mechanical "add a panel".** The visibility-swap exists for a hard reason
stated in the code: a `display:none` canvas has zero client size, and core `bindToCanvas`
throws when a host inits (or resizes) on a zero-size surface. dockview BACKGROUNDS inactive
tabs with `display:none`, so the moment preview becomes a tab stacked behind Viewport,
whichever panel is backgrounded goes zero-size — reopening the exact failure the swap was
built to dodge, now against dockview's less-controllable tab lifecycle. A correct
implementation must handle init-on-first-show, pause-render-on-hide, and resize/re-bind on
re-show for the preview host.

**And a tab alone doesn't satisfy the ask.** Tabs in one dockview group are mutually
exclusive — activating a "Preview" tab still hides the Viewport. To genuinely keep the scene
visible, preview must be a separate side-by-side GROUP: TWO live WebGPU canvases rendering at
once (double GPU cost, two render loops) plus the zero-size problem for whichever group is
collapsed.

**So this is a mini-slice, not a fix:** (1) a UX decision — swappable tab vs side-by-side
group; (2) a WebGPU-canvas-lifecycle spike for the chosen shape (init / pause / resize under
dockview panel visibility, the availability-class probe before committing); then (3) build.
User-approved deferral at the 3.2.2 gate ("backlog 3, we can handle it after this").

**Trigger to revisit:** immediately after Slice 3.2.2 seals — the user flagged it as the next
thing to pick up.

**Reference:** `packages/editor/src/frontend/components/Viewport.tsx` (the two-canvas
visibility swap + the zero-size init comment), `packages/editor/src/frontend/components/App.tsx`
(dockview panel registration, `previewHostRef`), `packages/editor/src/frontend/lib/panels.ts`
(`PANELS` registry), sibling `generation-cockpit-ux-gate-findings.md`.

## Editor viewport HDR context + post-chain preview

> Epic 3 disposition (2026-07-06, corrected at the 3.1 seal): **NOT** subsumed — this entry stays OPEN. Slice 3.1 added a **separate** generation-session-only HDR preview host (`packages/editor/src/viewport-host/preview-host.ts`; editor-architecture.md §13.1) for the cockpit. That host does **not** change the main scene-editing viewport host (`renderLoaded` in `index.ts`), which is still non-HDR and still passes `effects: []`. This entry's gap — the scene's post chain in the *normal editing viewport* — is unchanged by 3.1.

The editor viewport-host (`packages/editor/src/viewport-host/index.ts`, `renderLoaded`) now renders the scene's **lights** and **ambient** — the lit-viewport payoff — but passes `effects: []` to `frame.render`: the scene's **post chain is deferred**. The host's GPU context is **non-HDR** (`init()` requests the default `hdr: false`).

This is a **fidelity** deferral, not a crash workaround. A scene's post chain (e.g. `bloom → tonemap`) is authored for the *consumer's* HDR pipeline, where the renderer draws the scene into an `rgba16float` intermediate and the tonemap pass maps that HDR target down to the LDR swap chain. The `frame.render` HDR↔effects contract is (verified in `packages/core/src/frame/render.ts`): it throws **only on the inverse** — `hdr === true` **and** an empty effect chain (an `rgba16float` scene target with no pass to reach the LDR swap chain). A **non-HDR** context with effects does **not** throw. So the editor *could* pass `l.effects` against its LDR target without crashing — but the HDR-authored chain would run against an LDR scene target and produce **wrong output**, not the real preview. Hence `effects: []`.

**Trigger to revisit:** when the editor viewport gains an **HDR context** (host `init()` requests `hdr: true`, scene target becomes `rgba16float`). At that point pass `l.effects` instead of `[]` in `renderLoaded`. Note: under HDR, `frame.render` *requires* a non-empty effect chain — a post-chain scene satisfies that, but an HDR editor context viewing a scene with **no** post chain would need a default final pass (e.g. `post.tonemap`) to avoid the throw.

(Separately: the editor's `scene.setResource` command currently only authors `geometries | shaders | materials` — `src/daemon/handlers.ts` `tableEnum`. The core format now also has `textures` + `effects` tables, but the editor cannot yet mutate them via command. Extending the command surface to author textures/effects is adjacent to this entry but distinct — it is the authoring path, not the render path.)

**Reference:** `docs/reference/editor-architecture.md` (§1, §11 — editor-host render path), `packages/editor/src/viewport-host/index.ts` (`renderLoaded`, the `effects: []` comment block), `packages/core/src/frame/render.ts` (the HDR↔effects throw contract).

## The stamp-preview worker evaluates generators OUTSIDE core's guard seam

Surfaced by F4 Task 6 (`GeneratorDef.emits`, D-F4-15). Core has ONE evaluate seam,
`evaluateGenerator` (`packages/core/src/field/generators.ts`), which enforces both of a
`GeneratorDef`'s declarative facts before returning: `contextFree` (evaluate must get a
`ctx` when it reads the field) and now `emits` (the result must not carry a channel the
declaration forbids). `commitGenerator` and `reconfigureGenerator` both go through it, so
every path that puts a result into the op log is covered.

The editor's stamp preview does not. `handleStampPreview`
(`packages/editor/src/frontend/lib/field-protocol.ts` ~:297) calls `def.evaluate(...)`
**directly** and hand-rolls the ctx pairing inline (`def.contextFree ? undefined : { store }`),
so it skips both guards. It cannot use the seam today: `evaluateGenerator` is deliberately
**not** on the public field index — it is in-core surface, reached from core's own tests only
by source path.

**Blast radius today is small and bounded:** preview writes to a scratch store and posts a
ghost mesh, never to the op log, so a lying def shows a wrong ghost and the subsequent commit
still throws setup-loud. The real cost is that the ctx rule now has **two spellings in two
packages** — core's guard and the preview's inline conditional — which is the parallel-path
smell, and `emits` has none on the preview side at all.

Fixing it is a design decision, not a mechanical edit: either (a) promote `evaluateGenerator`
to the public field index (new public API surface — and the current comment says its
in-core-ness is intentional), or (b) give core a preview-shaped public entry point that wraps
the seam, or (c) accept the duplication and pin the preview's ctx conditional with a test that
fails when core's rule changes.

**Trigger to revisit:** the next task that touches `handleStampPreview`'s evaluate call or
adds a third `GeneratorDef` declarative fact — a third fact makes the duplication a real
maintenance hazard rather than a tidiness one. Also fold in if the field module gets a
public-surface pass.

The concrete third-fact candidate is already visible: **`usesSeed`**. `hallGenerator.evaluate`
opens with `void seed` — hall's structure is params-determined (the donor contract), and its
TSDoc reserves the seed for future skin variants, so nothing consumes it *today*. Meanwhile
`packages/editor/src/frontend/components/field/StampInspector.tsx` (:133-169) renders the seed
input and the ⚄ re-roll button **unconditionally**, with no generator-dependent guard
(verified). So the editor offers a control that changes nothing on hall — the same class of
gap the editor's `placesArchetypes` schema sniff existed to paper over, and the same class of
fix `emits` is. (That sniff is GONE: F4 tranche B Task 12 deleted it for
`placesProps(def.emits)` in `field-placements.ts`. Named here only as the precedent — do not
grep for it.) Surfaced
by the F4 Task 6 review; deliberately NOT built, since D-F4-15 scoped exactly one fact. Note
it is a genuinely *harder* fact than `emits`: `emits` is checkable against the result, whereas
"does evaluate read `seed`" is not observable from one call — it would be a declaration on
trust, or inferred from evaluating twice at different seeds. If `usesSeed` lands, it lands
through the same seam this entry is about — do the two together.

**Reference:** `packages/core/src/field/generators.ts` (`evaluateGenerator`, the two guards),
`packages/core/src/field/index.ts` (what the field module does and does not export),
`packages/editor/src/frontend/lib/field-protocol.ts` (`handleStampPreview`),
`packages/core/src/field/types.ts` (`GeneratorDef.emits` TSDoc, which states the guard is the
committer's and that direct `evaluate` calls skip it).

## LoadedScene → frame.render clearColor: tuple↔Vec4 ergonomics seam

`LoadedScene.settings.clearColor` resolves to a hand-authored RGBA tuple `[number, number, number, number]` (via `t.vec4()` = a zod tuple — the INPUT-side vec type), but `frame.render`'s `RenderOptions.clearColor` is `Vec4` = `Float32Array` (the STORAGE-side vec type). So any consumer driving `frame.render` directly from a loaded scene's settings must convert tuple→Float32Array. The M3 editor's `ViewportHost` is the **first** such consumer and absorbs this with a module-private `toVec4()` helper (`packages/editor/src/viewport-host/index.ts`) using the public `vec4.fromValues`; a grep this session found no prior precedent in core/hello-world/cookbook.

This is consistent with the engine's deliberate storage-vs-input vec distinction (tuple for bounded hand-authored input, Float32Array for storage/compute), so it is **not** a bug — but it is a recurring conversion every `LoadedScene`-driven render site will hand-roll. Options if it proliferates: (a) have `loadScene` resolve `settings.clearColor` to a `Vec4` on the `LoadedScene` (engine-internal resolved data is storage-side), keeping the document/input tuple as-is; (b) export a tiny `clearColorToVec4` helper from core; (c) leave per-consumer conversion as the documented recipe. Option (a) is the cleanest single-source-of-truth move but is an engine change with its own review.

**Trigger to revisit:** A second `LoadedScene.settings`-driven `frame.render` site appears (e.g. Plan B's React chrome wiring, or a cookbook scene-render demo), OR an engine session is already touching `loadScene`/`SceneSettings` resolution.

**Reference:** `packages/editor/src/viewport-host/index.ts` (`toVec4` boundary helper), `packages/core/src/scene/builtins.ts` (`SceneSettings.clearColor = t.vec4().optional()`), `packages/core/src/frame/render.ts` (`RenderOptions.clearColor: Vec4`). Surfaced by the M3 Plan A Task 6 implementer + holistic review. See the storage-vs-input vec convention.

# Backlog index

**GENERATED — `bun run docs:index`. Do not edit by hand.** One line per entry, from its
`summary:` frontmatter. Conventions, the entry shape, and the pruning rules live in
`docs/reference/docs-system.md`; `ls docs/backlog/<topic>/` is the other index and cannot
go stale.

A backticked status suffix marks an entry that is not `open`. A `→ slug` suffix names the
work item that reads it — those entries are protected from consolidation.

## ai-agents (2)

- [llm-as-planner-experiments](ai-agents/llm-as-planner-experiments.md) — hand a foundation model structured scene state and execute the JSON actions it returns through the classical layer (A*, animation, physics) — far future
- [webnn-tensor-npu-acceleration](ai-agents/webnn-tensor-npu-acceleration.md) — browser-native tensor / NPU acceleration via the WebNN API, waiting on ML inference being on the path

## dungeon (22)

- [backing-masonry-fallback](dungeon/backing-masonry-fallback.md) — fallback if a void ever flashes through the proud-panel reveal gaps: stamp backing masonry behind each panel run
- [cave-chamber-floor-reconciliation](dungeon/cave-chamber-floor-reconciliation.md) — cave passages clamp their own delivered rise in extreme-aspect regions, leaving a floor discontinuity where a switchback meets its chamber
- [charmover-stepup-into-low-ceiling-guard](dungeon/charmover-stepup-into-low-ceiling-guard.md) — CharacterMover commits to a step-up without checking headroom, so a tight ceiling produces a climb-and-fall wedge
- [connector-geometry-stitching](dungeon/connector-geometry-stitching.md) — nothing blends the cave isosurface to a mouth's masonry collar — the rock contact is masked by interpenetration alone
- [content-vocabulary-is-the-differentiation-ceiling](dungeon/content-vocabulary-is-the-differentiation-ceiling.md) — four material classes and two prop archetypes cap how many places can read as distinct; cycle 2 measured material as the discriminating variable
- [disjoint-region-check-is-aabb-conservative](dungeon/disjoint-region-check-is-aabb-conservative.md) — the disjoint-region assert tests region AABBs, so it rejects geometrically legal layouts — a hard error once a human is dragging placements
- [door-opening-standard-is-not-universal](dungeon/door-opening-standard-is-not-universal.md) — two door heights ship — the grid stamp's 3.0 m and the organic collar's 2.8 m — so the single door-class portal standard is false
- [dungeon-register-cites-deleted-epic2-architecture](dungeon/dungeon-register-cites-deleted-epic2-architecture.md) — eleven dungeon backlog entries cite Epic 2 modules that were deleted; each needs a live-or-not disposition, not a citation re-point
- [field-mesher-degenerate-triangles](dungeon/field-mesher-degenerate-triangles.md) — the Surface-Nets mesher emits zero-area triangles and non-manifold edges on symmetric surfaces — harmless to render, risky for a cooked collision mesh
- [grid-vocabulary-consolidation](dungeon/grid-vocabulary-consolidation.md) — tracker: a third grid vocabulary costs five edit sites, three of them pure TypeScript union tax, plus duplicated door and dressing constants
- [jit-runtime-regions](dungeon/jit-runtime-regions.md) — attach construction-guaranteed regions to a baked world at play time for an endless feel — needs a socket contract and runtime realize plus collider attach
- [maze-cells-upper-bound](dungeon/maze-cells-upper-bound.md) — MazeParams.cells has no ceiling — a fat-fingered value expands to a 64 MB grid and hangs the tab, with no budget or fail-fast
- [organic-cave-mouth-offaxis-rimride](dungeon/organic-cave-mouth-offaxis-rimride.md) — off-axis lanes inside the organic cave hit ~0.80 m floor steps that trip the launch guard and wedge the voxel-proxy mover
- [pit-detector-has-no-width](dungeon/pit-detector-has-no-width.md) — detectPits ignores free width, so a 0.25 m well between two prop colliders is flagged as a trap the 0.60 m capsule cannot even enter
- [post-t2-scripts-pile](dungeon/post-t2-scripts-pile.md) — packages/dungeon/scripts/ accumulated one-off bake, measure and probe scripts whose referents partly died with dungeon v1 — wants a sweep
- [scatter-props-pinch-passages](dungeon/scatter-props-pinch-passages.md) — catalog scatter at authored densities pinches passages below the capsule's width bar — 29–47 advisor flags per config against 0–3 bare
- [scatter-spacing-max-dead-config](dungeon/scatter-spacing-max-dead-config.md) — ScatterLayerSpec.spacing.max is inert — scatter() reads only spacing.min, so every authored max-gap range does nothing
- [substrate-palette-rle-storage](dungeon/substrate-palette-rle-storage.md) — the substrate grid is dense Uint8Array behind an accessor wall — the seam a palette or RLE encoding slots into when streaming makes size matter
- [traversal-verbs-on-character-mover](dungeon/traversal-verbs-on-character-mover.md) — crouch, jump, mantle, climb, rope and swim layered on CharacterMover, plus the jump-vs-ground-snap and single-ray edge-drop fixes each will need
- [visual-polish-pass](dungeon/visual-polish-pass.md) — tracker for the dungeon look-not-structure work: a richer rim-collar case set and a material/UV atlas for the masonry kit
- [walked-world-has-a-hole-to-empty-space](dungeon/walked-world-has-a-hole-to-empty-space.md) — an owner walk saw through a baked world into void; the location was never captured, and no analyzer pass detects open-to-nothing at all
- [world-spec-no-portal-error-is-unactionable](dungeon/world-spec-no-portal-error-is-unactionable.md) — realizeWorldSpec's no-portal-0 throw names only the symptom — it never says doors come from connectors, so the message offers no next step

## editor-and-tooling (27)

- [action-run-input-is-schema-untyped](editor-and-tooling/action-run-input-is-schema-untyped.md) — `action_run` declares an empty input schema, so MCP clients stringify object args and an agent cannot name — or bake — a world
- [advisor-answers-volume-not-questions](editor-and-tooling/advisor-answers-volume-not-questions.md) — the walkability advisor's flags answer has no filter or rollup, relays a kind that can never be actionable, and seeds reachability only from `playerStart` → door-set
- [agent-can-add-but-cannot-revise](editor-and-tooling/agent-can-add-but-cannot-revise.md) — the agent door grew a read half and a write half but never a revise half — no select, no delete, no camera aim, no spawn control
- [backchannel-refusals-blur-two-causes](editor-and-tooling/backchannel-refusals-blur-two-causes.md) — the backchannel reports a chrome refusal and a daemon fault under one `internal` code, and a shutdown leaves a pending ask to its timeout
- [chrome-focus-and-dismissal-follow-ons](editor-and-tooling/chrome-focus-and-dismissal-follow-ons.md) — where editor keyboard focus lands when a surface closes, and which surface owns a key while several are open — five follow-ons to the F4.5c focus seam
- [chrome-legibility-gaps](editor-and-tooling/chrome-legibility-gaps.md) — places where the editor chrome knows something the user cannot see — an off-screen live session, an unexplained refusal, a permanently inert control, no onboarding
- [chrome-shape-follow-ons](editor-and-tooling/chrome-shape-follow-ons.md) — editor chrome that works but whose shape is a bet — the action gate still inside `lib/actions.ts`, a counter riding the context, helpers awaiting a third occurrence
- [edit-apply-reports-nothing-about-what-it-wrote](editor-and-tooling/edit-apply-reports-nothing-about-what-it-wrote.md) — `edit_apply` answers a bare ok, so a brush op that changed zero samples is indistinguishable from one that worked → door-set
- [editor-backend-architecture](editor-and-tooling/editor-backend-architecture.md) — decision history for the editor as a fourth furnace pillar — MCP-first capability layer, local daemon by default, artifact-as-interchange dual mode
- [editor-chrome-authoring-gaps](editor-and-tooling/editor-chrome-authoring-gaps.md) — editor chrome that is wrong rather than merely missing — inspector fields that mis-handle their schema type, palette focus, readouts that go stale
- [editor-M5B-viewport-interaction](editor-and-tooling/editor-M5B-viewport-interaction.md) — viewport and hierarchy work fenced out of the M5B editor milestone — gizmo-controller extraction, non-drag pointer gestures, and two items closed by the scene deletion
- [editor-seams-and-preview-deferrals](editor-and-tooling/editor-seams-and-preview-deferrals.md) — the editor's boundary items — the project-first `editor-extensions` seam, the preview panel and render-path fidelity deferrals, the worker's unguarded generator evaluate
- [editor-test-harness-fragility](editor-and-tooling/editor-test-harness-fragility.md) — what the editor's `bun test` harness cannot do deterministically — happy-dom/GPU/daemon collisions in one shared process, a flaky daemon test, coverage the worker seam still hides
- [entity-list-has-no-legible-order](editor-and-tooling/entity-list-has-no-legible-order.md) — the entities list is newest-first now, but still cannot say which stamps arrived since you last looked, or who added them
- [field-capability-sweep-deferrals](editor-and-tooling/field-capability-sweep-deferrals.md) — fourteen editor capabilities adjudicated together at the F4.5 sweep and deferred — resize handles, multi-select, camera bookmarks, walk mode, autosave, mirror, per-prop editing
- [field-host-internals](editor-and-tooling/field-host-internals.md) — how `field-host/` is built inside — `remeshOne` swallowing GPU setup failures, eight in-source deferrals, an analyzer re-analysis halo resting on an unstated precondition
- [field-tool-follow-ons](editor-and-tooling/field-tool-follow-ons.md) — deferred gaps in the field editing tools — props drawn as collision proxies, stamp-session and reconfigure divergences, the segment brush, the void cast's worker monopoly
- [in-scene-ui-and-text-rendering](editor-and-tooling/in-scene-ui-and-text-rendering.md) — the UI cases screen-space projection does not cover — per-pixel-occluded in-scene UI, an SDF font atlas, and the browser tech that would collapse the design space
- [latchentities-walks-the-oplog-per-reader](editor-and-tooling/latchentities-walks-the-oplog-per-reader.md) — `latchEntities` walks the whole op log once per reader — up to four whole-world walks where the old provider did one
- [outbound-llm-editor-features](editor-and-tooling/outbound-llm-editor-features.md) — the other arrow — the editor itself calling a model over a selection, and the provider-location, key-management and context-packaging decisions that needs
- [pending-zero-cannot-say-the-advisor-is-off](editor-and-tooling/pending-zero-cannot-say-the-advisor-is-off.md) — the flags answer's `pending: 0` conflates "the advisor settled" with "the advisor never ran", and nothing pins the counter's wire
- [read-only-chrome-for-an-unclaimed-session](editor-and-tooling/read-only-chrome-for-an-unclaimed-session.md) — a second editor tab that has not claimed the session is a full editor the agent cannot see — read-only is a per-control design pass, not a flag
- [t3-fold-ins-dropped](editor-and-tooling/t3-fold-ins-dropped.md) — four small T3 fold-ins planned, never executed and never recorded as dropped — a naked-cast comment, chip primitives, a duplicated world-name regex, a wire type test
- [the-door-charges-per-question-and-assumes-a-filesystem](editor-and-tooling/the-door-charges-per-question-and-assumes-a-filesystem.md) — the agent door bills one round trip per ray, and `project_get` answers a filesystem path — so a remote agent cannot read the project catalog at all
- [where-am-i-position-legibility](editor-and-tooling/where-am-i-position-legibility.md) — the status bar names the selection's position now, but the camera's own pivot is still unreadable and nothing goes to a coordinate
- [wire-contracts-are-hand-mirrored](editor-and-tooling/wire-contracts-are-hand-mirrored.md) — three of the four daemon↔chrome contracts are declared twice and kept in step by hand — `WorldRow`'s only guard is a comment saying "grep both"
- [world-verb-follow-ons](editor-and-tooling/world-verb-follow-ons.md) — the `world.*` family's edges — a tracked-precheck failure that refuses the save instead of escalating into the overwrite confirm, name-commit cue gaps, an unbootable `legacy` kind

## engine-architecture (38)

- [catalog-collision-schema](engine-architecture/catalog-collision-schema.md) — catalog `collision` schema: whether `collisionExtentY` survives `collisionCenter`, and whether the box-only kind should escalate to a mesh kind
- [cave-generator-topology-richness](engine-architecture/cave-generator-topology-richness.md) — richer cave-generator topology dials so a stamped cave reads as a web of caves rather than one tunnel
- [cookbook-debt-kcc-collision-events-shader-composition](engine-architecture/cookbook-debt-kcc-collision-events-shader-composition.md) — cookbook debt against one-demo-per-Tier-1-feature: ten Tier-1 names with no demo and no recorded decision, plus KCC, collision events and shader composition
- [core-internal-structure-debt](engine-architecture/core-internal-structure-debt.md) — core files whose internal shape is wrong (a four-codec `field/artifact.ts` past 1.3K lines, and siblings) — fix on the next substantial touch rather than extend
- [field-bake-has-no-content-hash](engine-architecture/field-bake-has-no-content-hash.md) — a baked field stores no hash of (ops + mesher version), so nothing can detect that a bake is stale
- [field-compaction-downstream-of-live-entity](engine-architecture/field-compaction-downstream-of-live-entity.md) — compacting ops downstream of a live generator entity silently changes what a later reconfigure of that entity produces
- [field-log-entries-anchored-by-index](engine-architecture/field-log-entries-anchored-by-index.md) — undo/redo entries address `log.ops` by index, which is why compaction refuses any live history — and where a less conservative guard could start
- [field-op-vocabulary-has-no-architectural-altitude](engine-architecture/field-op-vocabulary-has-no-architectural-altitude.md) — field ops are only sphere/box/capsule, so stairs, ramps and polyline passages are hand-computed box arithmetic at the caller
- [field-read-surface-gaps](engine-architecture/field-read-surface-gaps.md) — field read-surface gaps: `analyzeWorld`'s per-chunk revalidation, a weaker-than-necessary reachability answer, a record with no public reader, and a ray that returns only the first hit → door-set
- [field-reconfigure-and-parse-edges](engine-architecture/field-reconfigure-and-parse-edges.md) — reconfigure and parse legs that are exact only under preconditions nothing enforces: flood masks, empty evaluations, and unre-checked op-log payload interiors
- [field-snapshot-record-lifecycle](engine-architecture/field-snapshot-record-lifecycle.md) — field snapshot records have no invalidation or pruning story, so a record staled by an edit is consumed silently
- [field-variant-hash-low-bits](engine-architecture/field-variant-hash-low-bits.md) — `variantHash` mixes only the low 16 bits of each int input, so kit variant tints alias beyond ~32 km
- [frame-surface-gaps](engine-architecture/frame-surface-gaps.md) — what `frame.*` cannot express yet: unexposed `GPURenderPipeline` state, a pass-target union, multi-camera frames, and a scalable clock
- [geometry-primitive-gaps](engine-architecture/geometry-primitive-gaps.md) — missing render primitives (box/parallelepiped, cone/open cylinder, tunable tessellation) and the render-vs-collider parity principle that governs them
- [input-module-pass](engine-architecture/input-module-pass.md) — deferred `@furnace/core/input` work: per-ctx scoping instead of a module singleton, pointer lock and relative motion, configurable `preventDefault`, stuck-key recovery
- [jolt-backend-swap](engine-architecture/jolt-backend-swap.md) — swapping the physics backend to Jolt, or exposing backend choice, for single-scene multicore and ghost-free mesh collision
- [kit-lattice-excludes-a-walkable-stair](engine-architecture/kit-lattice-excludes-a-walkable-stair.md) — the 0.5 m kit lattice and the agent's 0.4 m step height do not overlap, so no kit-class stair is walkable
- [lattice-aligned-box-op-writes-nothing](engine-architecture/lattice-aligned-box-op-writes-nothing.md) — a box fill whose faces land exactly on the sample lattice writes nothing into already-solid cells and still answers ok
- [lighting-and-shading-capability-gaps](engine-architecture/lighting-and-shading-capability-gaps.md) — what the shipped Blinn-Phong forward path cannot express: PBR, area/IES lights, cookies, ambient authoring sugar, many-light scaling, fog modes
- [multi-context-and-worker-gpu](engine-architecture/multi-context-and-worker-gpu.md) — more than one `gpu.Context`: an OffscreenCanvas worker context, and what a resource created against one device may do against another
- [oplog-entry-assembly-duplicated-three-ways](engine-architecture/oplog-entry-assembly-duplicated-three-ways.md) — three hand-rolled copies of "apply a list, build one `ops` log entry" — rule of three met, the helper's shape still a design question
- [oplog-group-apply-is-not-a-transaction](engine-architecture/oplog-group-apply-is-not-a-transaction.md) — a group apply's pass 2 does not roll the store back, so an applier throw mid-group leaves a partial write
- [physics-tracks](engine-architecture/physics-tracks.md) — the two-track physics posture (ADR 0001) and its residue: deferred determinism/networking concerns, the unbuilt GPU track, and the unfinished body-mutation surface
- [post-chain-follow-ons](engine-architecture/post-chain-follow-ons.md) — post-chain follow-ons above the shipped linear T2 chain: a runtime render graph, a node-graph editor, effect-input composability, effect variants, two profiling-gated hot-path items
- [procedural-generation-direction](engine-architecture/procedural-generation-direction.md) — procedural generation beyond textures: meshes and geometry, a richer noise/pattern module, and GPU-generated content
- [public-api-naming-audit](engine-architecture/public-api-naming-audit.md) — audit every coined public name against industry vocabulary and run the rename batch before the first npm publish, while renames are still free
- [registry-schema-cannot-encode-cross-field-constraints](engine-architecture/registry-schema-cannot-encode-cross-field-constraints.md) — registry definers take a flat `ZodRawShape`, so cross-field, one-of and discriminated-union constraints survive only as throws inside `evaluate` that no emitted schema or editor form can see
- [render-code-hygiene-on-next-touch](engine-architecture/render-code-hygiene-on-next-touch.md) — render- and material-path extract-on-next-touch hygiene: `frame/render.ts` length, duplication, dead machinery, over-long parameter lists
- [render-submission-batching](engine-architecture/render-submission-batching.md) — per-draw submission cost in `frame`: sorting draws by pipeline, per-object uniform writes, instance-attribute uploads, line-pass count
- [resize-unclamped-zero-size-canvas](engine-architecture/resize-unclamped-zero-size-canvas.md) — an unclamped canvas resize can feed zero-size depth/MSAA texture creation — a probe, not yet reproduced
- [resource-lifetime-ownership-and-tracking](engine-architecture/resource-lifetime-ownership-and-tracking.md) — who owns a GPU resource: teardown cascade policy, ownership roots, allocations the resource manager cannot see, and the ctxId wraparound defect in the handle encoding
- [scatter-variants-not-bound-to-archetype](engine-architecture/scatter-variants-not-bound-to-archetype.md) — scatter's `variants` param ignores the archetype's own mesh count, so a default-params scatter bakes a world that refuses to load
- [shader-substrate-follow-ons](engine-architecture/shader-substrate-follow-ons.md) — what the `Shader` substrate deliberately did not ship: WGSL→TS schema codegen with a staleness gate, `// @include` composition, a reload path, a refcount on the resource
- [shadow-follow-ons](engine-architecture/shadow-follow-ons.md) — shadow follow-ons on the Stage-4 single-map substrate: cascades and point cubes, auto-fit, resolution/kernel, per-mesh opt-in, instanced and transparent casters
- [stamps-not-authored-to-connect](engine-architecture/stamps-not-authored-to-connect.md) — generator doors are validated only within their own stamp, so nothing checks that two placed stamps' doorways actually meet → door-set
- [stats-and-memory-accounting](engine-architecture/stats-and-memory-accounting.md) — stated limits of `stats`: no GPU-side timing at all, two unspecified ways to mark a frame boundary, and `memory.textureBytes` undercounting mipmapped textures by ~33%
- [unbuilt-tier-2-modules](engine-architecture/unbuilt-tier-2-modules.md) — the Tier 2 cross-cutting modules decided on but never built — animation, assets, glTF, audio, event bus, ECS storage, jobs, transform hierarchy, wasm hot loop, debug draw
- [vec-primitives](engine-architecture/vec-primitives.md) — vector primitives: centralizing the `Vec3Tuple` input type, `Float32Array` authoring ergonomics, the missing `vec2` module, opt-in hot-path assertions

## infrastructure (11)

- [bare-line-refs-escape-the-citation-check](infrastructure/bare-line-refs-escape-the-citation-check.md) — the docs file:line citation check cannot see bare `:N` continuation refs, so a whole class of line citations rots unflagged
- [bun-dev-server-prewarm-workaround](infrastructure/bun-dev-server-prewarm-workaround.md) — cookbook's dev server prewarms every route to dodge a Safari first-click failure in Bun 1.3.14 — revert it on the next Bun bump
- [bun-isolate-top-level-await-tdz](infrastructure/bun-isolate-top-level-await-tdz.md) — bun test --isolate evaluates importers before an async module's top-level await settles, leaving const bindings in TDZ — two in-repo workarounds to revert when upstream fixes it
- [bun-parallel-worker-panic](infrastructure/bun-parallel-worker-panic.md) — two distinct instability sightings in full-suite runs at one-worker-per-core — a Bun panic (SIGTRAP) and a hang; neither reproduced at the ruled --parallel=4
- [docs-registers-findability](infrastructure/docs-registers-findability.md) — charter: how a growing body of deferred-work markdown stays findable, with the evidence that a file-count threshold is the wrong instrument → docs-system-rung-5
- [engine-architecture-topic-dir-wants-sharding](infrastructure/engine-architecture-topic-dir-wants-sharding.md) — `engine-architecture/` is the crowded topic dir and was deferred for sharding once, in a report nothing tracked cited
- [github-actions-ci](infrastructure/github-actions-ci.md) — no CI exists — a GitHub Actions pipeline running check, typecheck, and tests on PR
- [harness-cli-follow-ons](infrastructure/harness-cli-follow-ons.md) — two `@furnace/tools` deferrals: the `furnace.config.json` schema, and the Bun ↔ wasm-bindgen wrapper generator's maintenance surface
- [npm-publish-and-distribution](infrastructure/npm-publish-and-distribution.md) — publishing `@furnace/tools` and `@furnace/core` to npm: release flow, `dist/tools/` staging, and the biome-style per-platform binary migration
- [seal-entries-are-growing-into-essays](infrastructure/seal-entries-are-growing-into-essays.md) — individual seal files have grown from a paragraph to ~1000-word essays — the failure the seal record was split to escape, one level down
- [skill-cycle-worlds-have-no-durable-home](infrastructure/skill-cycle-worlds-have-no-durable-home.md) — world-building cycle bakes stay local and gitignored by owner ruling, so a cycle's run numbers cannot be re-derived off the authoring machine

## native-runtime (12)

- [device-lost-handling](native-runtime/device-lost-handling.md) — no recovery when the GPU device is lost — the engine just stops rendering, silently
- [furnace-native-js-package](native-runtime/furnace-native-js-package.md) — split the runtime contract's OS-bridge APIs (fs, dialogs, window, lifecycle) into a sibling `@furnace/native` package so core stays browser-pure
- [ios-android-native-implementation](native-runtime/ios-android-native-implementation.md) — iOS and Android native targets, gated on WebGPU-in-WebView maturity and on each platform needing its own runtime backend
- [linux-cef-support](native-runtime/linux-cef-support.md) — no Linux native host — GTK WebKit's WebGPU is weak and the workable path (CEF) pulls a whole Chromium runtime in as a build dependency
- [mac-app-code-signing-and-notarization](native-runtime/mac-app-code-signing-and-notarization.md) — the `.app` bundle is only ad-hoc signed, so Gatekeeper refuses it on any machine but the build one — wants a real codesign + notarization chain
- [native-window-focus-triggers-server-respawn](native-runtime/native-window-focus-triggers-server-respawn.md) — refocusing the native wry window makes the binary spawn a second dev server / Bun child, which blocks reliable native HMR testing
- [plugin-api-spec](native-runtime/plugin-api-spec.md) — the plugin mechanism is settled (Rust crates compiled to wasm) but the `Plugin` trait, payload schemas, lifecycle hooks, and JS IPC contract are unspecified
- [robust-child-process-cleanup-on-rust-panic](native-runtime/robust-child-process-cleanup-on-rust-panic.md) — the native binary's best-effort `Drop` can leak the Bun child on a Rust panic or SIGKILL — signal handling is incomplete
- [runtime-contract-spec](native-runtime/runtime-contract-spec.md) — the JS ↔ native-shell runtime contract exists in principle only: method list, signatures, IPC protocol, error and async semantics all still need their own spec session
- [webview-console-log-bridge-to-host-stdout](native-runtime/webview-console-log-bridge-to-host-stdout.md) — `console.log` from inside the native WebView never reaches host stdout, so every manual verification needs Safari Web Inspector open
- [window-resize-swap-chain-recreation](native-runtime/window-resize-swap-chain-recreation.md) — the WebGPU swap chain is not recreated on native window resize, so the render is squished
- [windows-native-implementation](native-runtime/windows-native-implementation.md) — no Windows native target — the wry runtime should cross-compile, but the build pipeline, templates, and platform builder are macOS-only

## testing-and-quality (11)

- [in-suite-pool-stress-test](testing-and-quality/in-suite-pool-stress-test.md) — nothing in the suite pushes one resource-pool slot past the 16-bit generation-counter wrap, so the overflow warn and wrap semantics go unexercised
- [mitata-microbenchmarks](testing-and-quality/mitata-microbenchmarks.md) — adopt mitata as a hot-loop microbenchmark harness once there are hot loops worth measuring
- [record-draw-non-finite-coverage](testing-and-quality/record-draw-non-finite-coverage.md) — the NaN/Infinity arm of `_recordDraw`'s finite-triangles guard has no test — only the negative-value arm is covered
- [resize-cascade-test-coverage](testing-and-quality/resize-cascade-test-coverage.md) — no regression test for canvas-resize-between-renders-then-dispose, the scenario that would catch a cascade callback capturing a stale texture entry
- [suppressed-non-null-assertions-survive-the-error-gate](testing-and-quality/suppressed-non-null-assertions-survive-the-error-gate.md) — 20 `biome-ignore`d non-null assertions in core scene GPU tests were never in the warning count the noNonNullAssertion escalation swept, and the suppression path stays open
- [svelte-formatting-prettier-or-biome-upgrade](testing-and-quality/svelte-formatting-prettier-or-biome-upgrade.md) — `.svelte` files go unformatted because biome's support is partial — needs Prettier or a biome upgrade before Svelte content grows
- [test-mock-context-helper](testing-and-quality/test-mock-context-helper.md) — 8 test files build fake contexts with an `as Context` cast that silently swallows every new `InternalState` field — wants a typed `createTestContext()` helper
- [two-gpu-fixtures-duplicated](testing-and-quality/two-gpu-fixtures-duplicated.md) — core and dungeon carry duplicate bun-webgpu fixtures; both are guarded since 2026-08-13, so what remains open is whether two fixtures should exist at all
- [typescript-third-bypass-class-exhaustive-record-keys](testing-and-quality/typescript-third-bypass-class-exhaustive-record-keys.md) — convention call: whether `Object.keys` over an exhaustive `Record` becomes a third documented compiler-bypass class in the typescript rules
- [uncaptured-error-test-silent-pass](testing-and-quality/uncaptured-error-test-silent-pass.md) — the uncaptured-error GPU tests guard every assertion behind an error-count check, so on a sync-throw backend they pass green having asserted nothing
- [visual-regression-testing](testing-and-quality/visual-regression-testing.md) — a Playwright pixel-snapshot harness for the browser render path, plus the reference-image comparison that rides on it

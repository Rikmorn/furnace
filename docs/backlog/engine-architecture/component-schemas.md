# Type-strict component schemas + behavior contract

**Status:** **Active — editor-epic M1 (component contract) + M6 (behavior runtime), design resolved 2026-06-09.** Full design + bowling mapping + SOTA grounding in the (gitignored) spec `docs/superpowers/specs/2026-06-09-editor-M1-scene-format-and-behaviors-design.md`. The serialized format that carries these components is in `scene-serialization-interchange.md`. **Lifecycle:** promote to a canonical `docs/reference/` doc and delete this backlog entry in the post-ship documentation phase.

The original question — "what does `defineComponent(...)` look like?" — resolved to the **hybrid** option below, now extended with the full behavior contract.

## Resolved decisions (2026-06-09)

- **Schema-as-first-class (hybrid confirmed).** A component/behavior type declares its `params` as one schema. That single declaration yields **both** the compile-time TS type (mapped type) **and** the runtime validator — no validator-vs-type drift. This reuses furnace's existing `<L>` layout-typing (`Shader<L>` / `Binding<L>` / `MaterialDescriptor<L>`), extended to entities.
- **Component = `{ type, params }`.** Built-in types (`transform`, `meshRenderer`, `rigidBody`, `light`, `camera`) are core-registered; custom types register via an extension. **Discovery is Branch A** (epic §7): extensions self-register by being imported before `loadScene`; one registry, two readers (editor reflects `params`; the core loader instantiates). The loader **fails loud and early at the boundary** when a referenced type isn't registered.
- **Behaviors add `state` + lifecycle.** Beyond `params` (authored, serialized data), a behavior has **`state`** (runtime-only, transient, never serialized) and logic. Full lifecycle, **built fully because it is a contract**:
  `state()` (data init, no services) → `init(bx)` (one-time wired setup, refs resolved) → `onEnable(bx)` → `update(bx)` (variable rate) / `lateUpdate(bx)` (after all updates) / `fixedUpdate(bx)` (fixed rate, before `physics.step`) → `onDisable(bx)` → `dispose(bx)` (teardown).
  Ordering guarantees: **all `state()` before any `init()`**; `update`→`lateUpdate` are two passes; disabled behaviors skip the per-tick hooks; `scene.reset()` re-runs `state()`. The two rates map onto furnace's loop: `update` = `frame.loop` callback, `fixedUpdate` = inside `frame.fixedClock`'s tick. (Naming `update`/`fixedUpdate` is the dominant cross-engine convention — Unity + Bevy verbatim.)
- **`requires` + typed `EntityRef`.** A behavior declares `requires: ["transform", "rigidBody"]` (sibling components it needs) and typed entity-reference params `ref(["transform","meshRenderer"])`. Both are **validated once at the load boundary**, after which `self` and `get(ref)` are fully typed — **zero runtime checks inside the hooks** ("parse, don't validate"). This is a deliberate divergence from Unity/Godot/PlayCanvas/Bevy (all bind scenes weakly at runtime), uniquely enabled by furnace being TS-first.
- **Behaviors are local.** A behavior touches its own entity + explicitly-referenced entities only — never a queried population, and **no entity spawn/destroy in v1**. Population operations are engine primitives now (`scene.reset()`, the renderer iterating meshes) or proper ECS **systems** later (the SoA half, deferred). Re-rack is `scene.reset()`, not a querying manager behavior.
- **Three designed-for seams (not built in v1, shaped to slot in):** `swap(old)` hot-reload (editor HMR, M5+); collision callbacks (`physics.step` already returns `CollisionEvent[]`; dispatch + enter/stay/exit diffing is a separate subsystem); hierarchy-cascading active-state (the `onEnable`/`onDisable` hooks exist; cascade semantics are a scene-graph concern).

## Connection to ECS storage layout

Still holds: SoA (`ecs-data-oriented-soa-layout.md`) requires knowing component shape; the schema-as-first-class descriptor supplies it. The format is **storage-agnostic** (logical composition, not storage layout), so SoA can land later with no format change. SoA remains **deferred** — the composition half of ECS is what M1 builds.

**Reference:** the M1 design spec (above); `scene-serialization-interchange.md` (the format); `ecs-data-oriented-soa-layout.md` (deferred storage half); `editor-and-tooling/editor-backend-architecture.md` (Branch-A discovery, decisions 5–6).

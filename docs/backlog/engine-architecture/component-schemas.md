# Type-strict component schemas (ECS prerequisite)

When the ECS module lands (`docs/backlog/engine-architecture/ecs-data-oriented-soa-layout.md`), components will need typed schemas — both for TypeScript ergonomics at consumer call sites and for runtime properties the engine needs (SoA storage layout, query type-narrowing, serialization, hot-reload of component data).

Options to consider:
- **TypeScript generics only**: `defineComponent<{ x: number, y: number }>("position")`. Compile-time only; no runtime validation.
- **Schema-as-first-class**: `defineComponent("position", { x: f32, y: f32, z: f32 })`. Runtime metadata available; storage layout derived automatically; can validate at boundary (e.g., when loading from a save file).
- **Hybrid**: TS types for the developer experience + runtime descriptor for the engine's needs. Probably the right answer.

Connects to ECS storage layout — SoA requires knowing component shape; structuring by component types determines memory layout.

**Trigger to revisit:** When ECS is brainstormed. This is essentially the "what does `defineComponent(...)` look like?" question, settled together with ECS itself.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Deferred decisions"; ECS backlog at `docs/backlog/engine-architecture/ecs-data-oriented-soa-layout.md`.

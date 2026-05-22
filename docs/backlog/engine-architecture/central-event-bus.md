# `@furnace/core/bus` — central pub/sub event bus

Cross-module event channel built on the Tier 1 `events` primitive. Lets unrelated subsystems coordinate without knowing about each other: physics emits `"collision"` → audio listens and plays a hit sound; gameplay emits `"player.died"` → UI listens and shows a death screen; network emits `"snapshot.received"` → world-state listens and applies the snapshot.

Distinct from per-module `onX` events (which the producer module owns directly) — the bus is for events whose producers and consumers are independent and whose event set is open-ended.

Open design questions to settle when this is brainstormed: synchronous fan-out vs queued/frame-bounded delivery (Bevy-style `Events<T>` with double-buffering vs Three.js-style immediate dispatch); typed event registry (`bus.on<CollisionEvent>("collision", fn)`) vs free-form; multi-listener ordering semantics; back-pressure (what if listeners are slow?); listener removal patterns (handle-based vs callback identity).

**Trigger to revisit:** First time two unrelated subsystems need to coordinate via events — likely when physics and audio both land in Tier 2.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Events architecture".

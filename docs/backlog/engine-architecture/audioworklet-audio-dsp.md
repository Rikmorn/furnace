# AudioWorklet + audio DSP

Audio is a separate workstream entirely — runs on `AudioWorklet`, a dedicated high-priority audio thread outside the JS event loop (per `docs/reference/engine-architecture.md` §10). Lands as the `@furnace/core/audio` Tier 2 module.

Likely depends on a wasm-backed DSP implementation (Rust → wasm, AudioWorklet hosts the wasm). Connects naturally to the central event bus (`docs/backlog/engine-architecture/central-event-bus.md`) — e.g., physics emits collision events, audio listens and plays hit sounds.

**Trigger to revisit:** When audio is on the roadmap.

**Reference:** Core architecture design § "Tier 2 modules".

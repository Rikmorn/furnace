# `@furnace/core/jobs` — unified job/scheduler abstraction

A `jobs.schedule(work, { dependsOn })` API that abstracts GPU compute dispatches, sync wasm calls, and Web Worker message passes behind one submission surface. The scheduler picks the substrate based on the job's nature; consumer declares dependencies and the scheduler builds a DAG.

The metaphor is right (main thread = orchestrator, work happens on substrates) but browser tech doesn't give us a unified API today — each substrate has different semantics (GPU = fire-and-forget through `queue.submit`; Web Workers = `postMessage` with structured clone or SharedArrayBuffer; AudioWorklet = continuous processing; wasm = sync function calls). The job system would be the abstraction layer that hides those differences.

Real engineering required: dependency graph that spans substrates; data marshalling between threads (`SharedArrayBuffer` setup, structured-clone serialization); completion signalling across substrates (GPU `onSubmittedWorkDone` vs Worker `postMessage` reply vs sync wasm); handling failures partway through a chain.

**Trigger to revisit:** When the consumer surface accumulates 4-5 distinct kinds of "heavy" work that would benefit from unified scheduling — likely after physics, audio, animation, and one of (AI / pathfinding / large-data processing) arrive.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Tier 2 cross-cutting patterns".

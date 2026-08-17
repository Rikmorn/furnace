# Modern Game Engine Architecture — Exploration Notes

*Conversation captured 2026-05-14. Architectural thinking that informed furnace's engine direction — covering ECS, event-loop architecture, GPU vs CPU work, game AI, and LLM-as-planner agent architectures. The specific reference implementation we studied while shaping these notes is consolidated separately at `docs/research/2026-05-21-shallot.md`.*

**A note on confidence**: comparisons to Babylon, Unity, Unreal, and discussion of broader research directions are mostly general/training knowledge — flagged inline where relevant. The GPU physics landscape and ML/game-AI research areas move fast; expect some staleness.

---

## Table of contents

1. [The web-tech-first + Rust hot loops pattern](#1-the-web-tech-first--rust-hot-loops-pattern)
2. [What wasm-pack emits, and what's *not* in wasm](#2-what-wasm-pack-emits-and-whats-not-in-wasm)
3. [WebGPU as a cross-platform native abstraction](#3-webgpu-as-a-cross-platform-native-abstraction)
4. [GPU-resident physics — the architectural tradeoff](#4-gpu-resident-physics--the-architectural-tradeoff)
5. [Is there really no GPU physics engine out there?](#5-is-there-really-no-gpu-physics-engine-out-there)
6. [Vision matters — hobby vs niche-finder vs big-engine competitor](#6-vision-matters--hobby-vs-niche-finder-vs-big-engine-competitor)
7. [OSS adoption realism](#7-oss-adoption-realism)
8. [Pattern summary — web-tech first, Rust where needed](#8-pattern-summary--web-tech-first-rust-where-needed)
9. [ECS refresher — what changed since 2000](#9-ecs-refresher--what-changed-since-2000)
10. [The event loop and how it doesn't bottleneck the engine](#10-the-event-loop-and-how-it-doesnt-bottleneck-the-engine)
11. [Job systems and synchronization](#11-job-systems-and-synchronization)
12. [AI in games — classical vs ML, GPU vs CPU](#12-ai-in-games--classical-vs-ml-gpu-vs-cpu)
13. [Could a tiny LLM replace state machines / pathfinding?](#13-could-a-tiny-llm-replace-state-machines--pathfinding)
14. [LLM-as-planner — the actual architecture that works](#14-llm-as-planner--the-actual-architecture-that-works)
15. [The two tiers of `@furnace/core` (as-built)](#15-the-two-tiers-of-furnacecore-as-built)

---

## 1. The web-tech-first + Rust hot loops pattern

**Core idea:** A Bun/TypeScript engine at its core, with Rust used selectively for hot-path or platform-specific pieces. Two places Rust enters:

- **wasm hot loops** — Rust crates compiled via `wasm-pack` (or raw `cargo build --target wasm32-unknown-unknown --release` + `wasm-opt`) and imported by the engine like any other JS module. Workloads: scene-graph matrix math, audio DSP — tight CPU-bound loops where SIMD-style throughput matters and the GPU isn't a fit.
- **Native shell** — a separate `cargo build --release` binary providing the OS-level window + WebGPU surface for desktop targets. Same TS engine code runs inside it as runs in a browser tab.

**How the two halves connect:** an orchestrator script (Bun) shells out to `cargo` / `wasm-pack` / `wasm-opt`, fixes up the generated `pkg/` (sets `sideEffects: false`, lints the output), and then the TS source imports the produced wasm packages like any other JS module. No FFI, no NAPI native node addon, no `build.rs` glue — just **Rust → wasm → JS module → `import` from TS**.

For a concrete worked example of this layout — file paths, build orchestration, what the actual `wasm-pack` import looks like in TS — see `docs/research/2026-05-21-shallot.md` § "Engine library + wasm hot loops".

## 2. What wasm-pack emits, and what's *not* in wasm

**The emitted `.js` file** is a thin **loader/glue** — it `fetch`es the `.wasm`, instantiates it, and re-exports the Rust functions as JS bindings. Actual work is in the `.wasm` binary; the `.js` is just the bridge.

**What typically lives in wasm in a setup like this:**
- ✅ **`transforms`** — scene-graph matrix math (positions, quaternions, scale → matrices). Hot per-frame CPU loop.
- ✅ **`audio`** — DSP for synthesis/effects. Likely consumed in the AudioWorklet.
- ❌ **Graphics is *not* in wasm.** WebGPU runs the GPU-heavy work on the **GPU** via WGSL shaders, not on the CPU via wasm. Rendering doesn't benefit from wasm because the bottleneck is GPU command submission, not CPU speed.

A separate Rust crate compiled as a **native binary** (not wasm) covers running the engine outside the browser as a desktop app — that's a different concern from browser-side perf.

**Mental model:** TS for orchestration + WebGPU for graphics/physics + wasm for tight CPU-bound loops the GPU can't do (scene-graph transforms, audio DSP) + a native Rust binary for the desktop host. Not "wasm does the heavy stuff" — more "each tool where it actually wins."

---

## 3. WebGPU as a cross-platform native abstraction

WebGPU is designed as a cross-platform abstraction that compiles down to **Metal on macOS/iOS, Vulkan on Linux/Android, DirectX 12 on Windows**. The spec is intentionally close to the lowest common denominator of those three so the translation is thin.

Nuances:
1. **WebGPU isn't browser-only.** Browsers use one of two implementations: Chrome uses **Dawn** (C++, Google), Firefox uses **wgpu** (Rust, Mozilla). Both can be embedded in non-browser apps. `wgpu` in particular is a popular standalone Rust crate.
2. **For a Bun-based engine**, `bun-webgpu` provides a Bun-native binding to `wgpu`. So the native picture looks like: Bun executes the TS, `bun-webgpu` provides the WebGPU API surface, `wgpu` translates to Metal/DX12/Vulkan, the native shell crate provides the OS-level window + surface. Same TypeScript engine code runs identically in the browser and on the desktop, only the bootstrap differs.
3. **The tradeoff WebGPU makes**: deliberately conservative API, doesn't expose every native feature (raytracing extensions still patchy, mesh shaders not there yet). Fine for most game/visualisation work, hits ceilings on cutting-edge AAA techniques.

Architectural payoff: write the engine once in TS+WGSL, get browser + native desktop targets nearly for free, with Rust filling the two gaps (windowing/host, plus CPU hot loops) that the JS/WebGPU side can't cover.

---

## 4. GPU-resident physics — the architectural tradeoff

If you want physics that scales with thousands of bodies *and* shares the GPU with the renderer, the choice is GPU-resident physics — and that essentially forces you to write the solver yourself.

**The two paths:**

- **Wrap a mature CPU engine** (Babylon's approach with Havok wasm, Rapier wasm): mature, deterministic, broad feature coverage. But every frame copies state CPU↔GPU. That bus traffic kills throughput once entity counts get serious.
- **Write GPU-resident physics**: same buffers physics writes are read by the renderer. No bus traffic. But you re-implement broadphase, narrowphase, solver, constraints, raycast — every stage. Multi-year maturity debt against Havok forever.

**Why you can't bolt GPU acceleration onto Havok/Rapier as a plugin** — those engines are designed around CPU memory layouts (cache-friendly arrays of bodies, sequential narrowphase passes). If the thesis is "physics belongs on the GPU alongside the renderer," you basically *have* to write it yourself.

**The pipeline if you went this route** — every stage you'd find in Bullet or Rapier, as WebGPU compute shaders:

- Broadphase: LBVH (Linear Bounding Volume Hierarchy) build + GPU traversal
- Narrowphase: SAT (Separating Axis Theorem), convex hull construction (QuickHull or similar)
- Solver: constraint solver on GPU
- Integration & misc: interpolation, character controller, raycast

**Tradeoff summary:** architectural purity now, multi-year maturity debt forever. Bet only pays off if the engine finds a niche where GPU-resident physics matters more than feature breadth.

For one worked example of an engine that took this route, see `docs/research/2026-05-21-shallot.md` § "Hand-rolled GPU-resident physics".

**What furnace settled on (physics pivot, 2026-06-01):** furnace took the *wrap-a-mature-CPU-engine* path for its first physics need — **Rapier** (wasm) behind a clean `physics` API, JS-authoritative transforms. The GPU-resident route above is **deferred, not chosen**: it is the right tool only for visual/throughput sim (particles, cloth, debris) where no CPU logic reacts per frame — not interactive gameplay rigid bodies, where the GPU is weakest at stable stacking and the WebGPU readback wall + cross-GPU non-determinism rule it out. This two-track boundary is the canonical decision in **ADR 0001** (`docs/reference/adr/0001-physics-two-track-architecture.md`); the deferred GPU track is tracked in `docs/backlog/engine-architecture/gpu-resident-physics-track.md`, and the shipped CPU track is the bowling demo's `physics` module (`docs/reference/core-modules.md`).

---

## 5. Is there really no GPU physics engine out there?

Categorized landscape (mostly general knowledge):

**Mature GPU physics, but CUDA-locked**
- **PhysX 5** — NVIDIA's rewrite, GPU rigid bodies, soft bodies, cloth, fluids. CUDA = NVIDIA only.
- **NVIDIA Flex** — superseded by PhysX 5.
- **NVIDIA Warp / Newton** — Python-driven, research/robotics oriented.

**ML/robotics GPU physics — wrong target audience**
- **Brax** (Google), **MuJoCo MJX**, **Isaac Sim / Isaac Lab** (NVIDIA), **Genesis** (Carnegie Mellon, 2025). JAX/XLA or CUDA, Python APIs, designed for RL sample throughput, not interactive frame rates. Not embeddable in a browser.

**Game-engine GPU physics — partial only**
- **Unreal Chaos** — cloth and Niagara particles on GPU, **rigid bodies still CPU**.
- **Unity DOTS Physics** — explicitly CPU (DOTS thesis = cache-friendly CPU layouts).
- **Bullet 3 OpenCL backend** — abandoned.

**WebGPU specifically — essentially nothing.** Research demos exist, no maintained library.

**Structural point:** Even if a perfect "GPU Rapier in WebGPU" existed, dropping it in wouldn't be like adding Cannon to Babylon. GPU physics needs to share the GPU with the renderer — same device, same queue, often the same buffers. That couples it to engine resource management. CPU physics is a clean black box; GPU physics is plumbing.

So **no shippable option exists** that satisfies "WebGPU, browser + Bun-native, drop-in library." Hand-rolling is less NIH than it looks.

---

## 6. Vision matters — hobby vs niche-finder vs big-engine competitor

"Big-engine competitor vs hobby" is a false binary. Successful engines live in the middle:

- **Bevy** — years of "hobby project" status, won by being the best answer for "ECS + Rust + open source."
- **PlayCanvas** — owned "interactive web 3D for ads/configurators," acquired by Snap.
- **Three.js** — most-deployed 3D engine in the world, has nothing approaching Babylon's feature set.
- **Defold, Heaps, MonoGame, LÖVE** — all real engines, none competing with Unreal.

**Plausible niches for a WebGPU-first engine that don't require closing the Havok gap:**
- **Embodied AI / robotics sim in browser** — GPU-resident physics maps onto RL training with thousands of parallel agents.
- **Procedural / generative content tooling** — fits the "procedural-first" framing.
- **Demoscene / creative coding / installations** — same niche Three.js dominates.

The interesting question is not "hobby vs competitor" but **"what niche does this architecture make uniquely good at?"** That determines whether the physics gap is existential or irrelevant.

---

## 7. OSS adoption realism

"People will pick it up and contribute" is the romantic version. The mechanical version:
- Contribution follows usage
- Usage follows the project solving a real problem better than alternatives
- That gate is much higher than "good code"

Most technically excellent solo projects on GitHub never get a second contributor — not because the code isn't good, but because there's no acute reason to switch from what people already use. Bevy got contributors because Rust gamedev had no good answer. Three.js got contributors because WebGL had no other reasonable interface.

**Author stamina matters more than code quality.** OSS projects die from maintainer burnout, not technical deficiency. Solo engine of this scope needs 3-5 years of sustained commitment before network effects kick in. Hard to read from a repo.

---

## 8. Pattern summary — web-tech first, Rust where needed

The thesis isn't quite "maximum performance" — it's "**modern foundations without legacy compatibility tax**":
- Dropped: WebGL fallback, OOP scene graph, CPU physics, React, Webpack, npm
- Kept: TypeScript public surface, web platform reach, Bun DX
- Added: Rust *only* where the platform genuinely can't deliver (CPU SIMD loops, native windowing)

**This pattern shows up across modern tooling:**
- **Figma**: C++/WASM rendering, JS UI
- **VS Code / Cursor**: Electron shell, Rust acceleration (ripgrep, rust-analyzer)
- **1Password 8**: Rust core, Electron UI
- WebGPU game engines like the one in `docs/research/2026-05-21-shallot.md`: Bun + TS + WebGPU shell, Rust hot loops + native window

The pattern: **web platform is the lowest-friction surface for tooling; the gap that remains gets filled with Rust because Rust integrates cleanly with wasm.** C++ used to fill that gap but the tooling is worse.

**Why Svelte for the editor specifically** (note: rare choice — most engine editors are React or native):
- Compiles to direct DOM updates, no virtual-DOM reconciler. Every ms the UI doesn't take is one the engine gets.
- Svelte 5 runes/signals model = fine-grained reactivity, maps cleanly to ECS (components are values, UI subscribes to specific values).
- Coexists with WebGPU render loop on the same machine without fighting for main-thread time.

---

## 9. ECS refresher — what changed since 2000

The ECS argument in 2000 was **composition over inheritance**: stop building `Goblin extends Enemy extends Character extends GameObject` hierarchies. Still true, but no longer the primary motivation.

**Modern motivation: data-oriented design and CPU caches.**

Numbers that drive this:
- L1 cache hit: ~1 ns
- Main memory fetch: ~100 ns
- A 4 GHz CPU executes ~400 instructions in the time it takes to fetch one uncached byte
- 25 years ago this gap was 5-10x. Now it's 50-100x. That changes which abstractions are free.

**OOP layout (one enemy in memory):**
```
Enemy { vtable*, pos: Vec3, vel: Vec3, hp: int, ai: AI*, mesh: Mesh*, ... }
```
Scattered heap allocations. Iterating "all enemies" = pointer chase per entity, virtual dispatch, cache lines wasted because you only wanted `pos` and `vel`.

**ECS layout (struct-of-arrays):**
```
positions_x: [x0, x1, x2, ..., xN]   // contiguous Float32Array
positions_y: [y0, y1, y2, ..., yN]
velocities_x: [vx0, vx1, ...]
velocities_y: [vy0, vy1, ...]
```
Physics system: `for i in 0..N: positions_x[i] += velocities_x[i] * dt`. Each cache line holds 16 floats. Prefetcher predicts perfectly. SIMD processes 4-8 entities per instruction. GPU warps coalesce 32 thread reads into one memory transaction.

**The reference example** (`docs/research/2026-05-21-shallot.md` § "ECS with struct-of-arrays layout") shows this concretely: `posX`, `posY`, `posZ` as separate `Float32Array`s, not `Vec3` objects. Pure SoA. Wasm sweeps linearly; GPU ingests coalesced.

**Secondary modern benefits:**
- **Auto-parallelization** — systems declare which components they read/write, scheduler proves non-conflict and runs in parallel
- **Query specificity** — "entities with Position AND Velocity AND Collider but NOT Frozen" is trivial
- **Serialization/hot-reload** — components are POD

**Honest downsides:**
- Cognitive cost — "where is the player's jump logic?" harder to answer
- One-off behavior (boss fights, cutscenes) doesn't decompose nicely
- Most production engines are hybrid (Unity = GameObject + DOTS, Unreal = Actor + Mass)

The thing that mattered in 2000 (composition) is now a side effect. The thing that matters today (memory layout) is the whole game.

---

## 10. The event loop and how it doesn't bottleneck the engine

A well-architected real-time JS app puts hot work *off the event loop*. The event loop's job is **orchestration**, not computation.

Where work actually happens:

**GPU (most of it).** WebGPU command buffer build → upload changed uniforms → submit to GPU queue → return. GPU runs rasterization, shading, compute (physics, transforms post-processing) entirely parallel to the event loop. CPU mostly waits. **Why GPU-resident physics matters**: the moment physics is CPU, you copy state to GPU every frame, and *that* copy serializes the two pipelines.

**Wasm (CPU hot loops).** Runs on the event loop's thread, but pre-compiled machine code with no GC, no JIT warmup, no JS object overhead, operating on flat linear memory. Transforms for 10,000 entities = sub-millisecond. Pure JS would be 10-50x slower.

**AudioWorklet (separate thread).** Web Audio's `AudioWorklet` runs DSP on a dedicated high-priority audio thread, not the event loop. Where the audio wasm executes.

**requestAnimationFrame, not setInterval.** RAF is the pacemaker — browser calls callback once per display refresh (~16.67ms at 60Hz) right before paint. Discrete chunk of work, not a tight loop. JS freed between frames.

**Web Workers + SharedArrayBuffer** for genuinely CPU-parallel work (when needed).

**Where the event loop *does* bite you:**
- **GC pauses** — even with work offloaded, allocating JS objects every frame triggers GC eventually. 1-10ms pauses = missed frames. Hot paths obsessively avoid allocation.
- **Synchronous blocking** — any heavy sync work freezes next RAF.
- **Microtask floods** — mishandled promises can starve RAF.

The principle: event loop = scheduler dispatching to faster substrates (GPU, wasm, workers). It only becomes a perf cliff when used *as* the computation engine. Performance comes from architecture, not from the language being fast. Same answer Figma reached (JS + WASM), VS Code reached (JS + native), and most modern web-tech apps converge on.

---

## 11. Job systems and synchronization

The web platform doesn't ship a Unity-style job system primitive. You build one from:

**CPU↔CPU**
- **Web Workers** — real OS threads, separate JS context, default communication via `postMessage` (slow path)
- **SharedArrayBuffer + Atomics** — substrate for real threading. Requires page to be cross-origin isolated (COOP+COEP headers) due to Spectre concerns.
- **AudioWorklet** — special case, dedicated audio thread

**GPU-internal** (most of the parallelism)
- WebGPU dispatches workgroups; GPU hardware scheduler maps to execution units
- **Workgroup-local sync**: `workgroupBarrier()` in WGSL + `var<workgroup>` shared memory
- **Cross-workgroup sync within a pass**: atomics on `var<storage>` buffers (slow but available)
- **Cross-pass sync**: WebGPU **infers barriers from buffer usage** — you declare data flow, runtime inserts memory barriers automatically

**CPU↔GPU** (asymmetric)
- **CPU → GPU is fire-and-forget**. `device.queue.submit()` returns immediately. CPU can build frame N+1 while GPU renders frame N.
- **GPU → CPU is slow**. `buffer.mapAsync()` might take 1-3 frames latency. **Why GPU-resident state matters** — keep state on the GPU permanently; renderer reads the same buffer the solver writes to; CPU never sees positions.

**Three idiomatic patterns for shared state**, in increasing pain order:

1. **Stateless / embarrassingly parallel** — each job reads inputs, writes its own output region. 90% case. Design goal.
2. **Read-shared, write-private** — many jobs read same state, each writes own slice. Most ECS systems per frame.
3. **Atomic coordination** — building shared data structures (broadphase pairs, BVHs, sorts). Slow, unavoidable for some workloads.

**The dependency graph is the real abstraction:** ECS systems declare "I read A, B; I write C." Two systems parallelizable iff their read/write sets don't conflict. Scheduler builds DAG, runs independent systems in parallel. This is what Bevy, Unity DOTS, Unreal Mass do. ECS pairs well with parallel scheduling because component access is **statically declarable**. OOP's "any method can mutate any field" makes this analysis impossible.

**Summary:** WebGPU handles cross-pass GPU sync automatically. ECS handles cross-system CPU sync automatically (when implemented). The hard engineering work isn't sync primitives — it's **designing data flow so coordination points are rare and predictable**.

---

## 12. AI in games — classical vs ML, GPU vs CPU

**Two different things called "AI":**

**Classical game AI** (what's shipped today): behavior trees, FSMs, GOAP, utility AI, pathfinding, flocking. Tiny compute per agent, heavy branching, serial decision flows. **Opposite** of GPU-friendly. Sits on CPU not because it can't go on GPU, but because GPUs are bad at branchy serial code (warp divergence).

**ML inference** (the GPU-friendly kind, rare in games): DLSS, OptiX denoising, NVIDIA ACE, learned motion matching, behavioral cloning.

**Why GPU AI cores aren't a factor for web-platform engines:**
- **WebGPU doesn't expose tensor cores** — you can run matmul via WGSL compute, but using general shading units, not specialized tensor hardware. 10-100x slower than tensor cores would be.
- **WebNN** (Web Neural Network API) is the proposed standard exposing NPU/tensor-core acceleration. In Chrome partially, not universal.
- **Apple Neural Engine, AMD AI Engine, Intel NPU** — accessible via native SDKs, not WebGPU.

**Simulation vs AI have opposite shapes:**
- **Simulation** (physics, fluids, particles) = wide and uniform = perfect for GPU
- **Game AI** = deep and branchy = bad for GPU

**Exceptions where game AI does go on GPU:**
- Crowd simulation / boids — many agents, identical update
- Influence maps — grid of values, parallel updates
- Massively parallel pathfinding (RTS unit counts) — research-y

Unifying principle: **GPU AI works when the same logic runs across many agents simultaneously.** Different decision trees per agent = CPU.

**Deeper truth:** AI in games is **content-expensive, not compute-expensive**. Writing 200 behavior tree nodes, tuning utility weights, hand-crafting animation states — that's the cost. Compute is trivial. So engines provide *authoring tools* (visual editor, debugger, profiler), not raw AI compute.

---

## 13. Could a tiny LLM replace state machines / pathfinding?

**Initial framing pushback:** the architecture you want isn't an LLM specifically. LLMs are *language* models trained on next-token prediction over text. For "given world state, pick action," you want a **policy network** (RL output) or a **world model** (game dynamics).

- Useful policy network: ~1-10M parameters. <1ms inference even on CPU.
- Useful tiny LLM: 100M-1B parameters minimum. 10-100ms inference on GPU.

**What's actually shipping in this direction:**
- **NVIDIA ACE / Inworld AI** — LLM-driven NPC dialogue. Cloud-hosted. Limited but real shipped product.
- **Ubisoft's Learned Motion Matching** — neural net replaces hand-tuned animation state machine. Shipped.
- **F1 game / Forza Drivatars** — neural driving AI from behavioral cloning. Shipped since ~2018.
- **Stanford Generative Agents paper** — 25 LLM-driven Sims-style NPCs. Famous demo, very expensive.

**Where neural fits poorly:**
- **Pathfinding via neural net** — bad fit. A* is exact, deterministic, debuggable, works on any new map. Neural pathfinder is approximate, needs retraining, fails OOD.
- **State machines via neural net** — possible but reliability problem. FSM rule "if HP<30%, flee" fires 100%. Neural net fires 99.3% with occasional weird outputs designers can't debug.
- **Dialogue via LLM** — *this* is the clear win. Hand-authored dialogue trees are content-expensive and rigid.

**Real hard problems (not silly ones):**
1. **Determinism** — replay safety needs bit-exact reproduction. Float matmul varies across GPU vendors. Solvable (greedy decoding, fixed-point) but expensive.
2. **Debuggability** — when goblin walks into wall, behavior tree = step through; neural net = inspect attention weights. Designers reject what they can't debug.
3. **Iteration speed** — tweaking behavior tree = 0s feedback. Retraining model = hours-days. Authoring workflow collapse.
4. **Training data** — where does it come from? Hand-author defeats purpose. Synthesize from reference AI = use reference AI. RL = multi-month fragile training.
5. **Per-NPC cost** — 100 NPCs × 10M-param net × 1ms = 100ms = entire frame budget gone.
6. **Bounding to "the rules"** — LLMs hallucinate; policy nets find degenerate strategies. Need classical constraint layer around neural component.

---

## 14. LLM-as-planner — the actual architecture that works

User's refinement: not "neural replaces classical" but **"neural reasons about scene, classical executes"**. LLM understands "boulder in the way, go around left"; A* does the actual pathfinding given the chosen detour.

**This pattern has a name: hierarchical AI / LLM-as-planner. Active research direction.**

- **High-level reasoning layer** — LLM (or smaller reasoning model) takes structured world state, decides *what* to do
- **Low-level execution layer** — classical A*, animation, physics
- **Constraint layer** — validates LLM's chosen action is legal before commit

**Examples this is converging toward:**
- Google's **SayCan**, **PaLM-E** (robotics)
- NVIDIA's **Voyager** (Minecraft agent)
- Stanford **Generative Agents** (Sims-style 25-agent demo)
- **NVIDIA ACE**, **Inworld AI** (shipping NPC tech)

**The structural advantage games have over real-world AI:**
- Robotics struggles with **perception** ("what's in the scene?")
- Games have **perfect ground-truth state** — every object, position, relationship known to the engine
- You hand the LLM a structured, perfectly-accurate scene description. No vision pipeline, no sensor fusion, no SLAM.
- This is why research demos work as well as they do.

**Why this architecture survives the objections:**
- **Latency**: high-level reasoning runs at 1-5Hz, not 60Hz. Within frame budget.
- **Determinism**: LLM picks intent; deterministic classical layer executes. Greedy decoding + cached prompts keeps reproducibility.
- **Reliability**: LLM picks from a **bounded action set** validated by constraint layer. Can't "punch the moon."
- **Pathfinding correctness**: untouched — A* still runs, still optimal.
- **Designer control**: the prompt is the design surface. "Cowardly merchant who prioritizes survival" beats authoring 200 BT nodes.

**The cool implication: you don't have to train.** You can prompt a foundation model:

```
You are a cowardly forest goblin. Stats: HP 45/100, weapon: rusty dagger.
You see:
- Player (50m north, armored, level 12)
- Boulder (10m east, blocks direct path home)
- Cave entrance (30m south, your home)
- Fellow goblin (15m west, fighting another player)

Goal: survive and reach safety.
Output: { "type": "flee"|"attack"|"hide"|"call_help", "target": "..." }
```

Pass to 3B-param local model, get JSON in 50-100ms. No training, no RL, no labeled data. Model knows what cowardly goblins do because it read fantasy fiction in pretraining. Classical layer executes.

**Remaining engineering work (not research):**
1. **Game state → prompt translation** — serializing scene into prompt every decision tick. Bookkeeping for "what does each agent know? what's in awareness? memory?"
2. **Structured output reliability** — constrained decoding, JSON mode, function calling. Modern models do well but not 100%. Need fallback path.
3. **Local vs cloud inference economics** — cloud = $/NPC; local NPU = consumer hardware constraints. 1-3B param local models with NPU acceleration are getting capable. 2-3 years probably solved.

**The product opportunity:** make this architecture a **first-class engine primitive**. Built-in `AgentContext` component with automatic state serialization, prompt templating, structured output validation, pluggable LLM backends (WebNN local, cloud, hybrid). Babylon and Unity have nothing like this. First engine to ship a clean version becomes the default for "AI-native games," a category that will exist in 5 years whether or not incumbents are ready.

---

## 15. The two tiers of `@furnace/core` (as-built)

Unlike the exploration notes above, this section records a **decision** (foundations
program, 2026-08-04). `@furnace/core` is one package but names two tiers:

- **Engine substrate** — the GPU-resource and math layer: `gpu`, `frame`, `transform`,
  `events`, `stats`, `camera`, `input`, `log`, `geometry`, `material`, `texture`,
  `binding`, `shader`, `mesh`, `mesh-blob`, `post`, `physics`, `rigid-mesh`,
  `resources`, `rng`, plus the shared root leaves (`errors.ts`). Knows nothing about
  documents, registries, or worlds.
- **World tier** — the modules that model *content* on top of the substrate: **`field`** and
  **`registry`** (the neutral definer machinery, landed T1b 2026-08-04). World-tier modules
  may import the substrate freely; the substrate must NEVER import upward.

**Vocabulary caution — "Tier 2" is a different axis.** The original core-architecture design
spec's **Tier 2** names cross-cutting modules layered *over* the shipped surface — animation,
assets, audio, a central event bus, ECS storage, a job scheduler, transform-hierarchy helpers,
a behaviour runtime, a wasm transform crate, debug draw. **None of them is built**, so none
appears in either tier above, which name only shipped modules. Each is its own deferral under
`docs/backlog/engine-architecture/` (`animation-module.md`, `assets-module.md`,
`audio-module.md`, `event-bus-module.md`, `ecs-soa-storage.md`, `jobs-scheduler-module.md`,
`transform-hierarchy-helpers.md`, `behaviour-runtime-contract.md`,
`rust-transforms-wasm-crate.md`, `debug-draw-primitives.md`, `gltf-import-path.md`). The word
is older than this section; read "Tier 2" in a backlog entry as the spec's term, never as a
claim about the split recorded here.

It was three modules for one day. **`scene` — the text-JSON document format with its
consumer-extensible registry and `loadScene` — was deleted in foundations T2 (2026-08-05)**,
having lost its last runtime consumer when the dungeon's region world retired and its last
tooling consumer when the editor daemon shed its document session. What survives of it is
what the tier split had already pulled out: the definer machinery as `registry`, and the
`.fmesh` codec as the engine-tier `mesh-blob` leaf. **The field is the content model now,
and it is the only one.**

The direction is enforced by `packages/core/tests/architecture.test.ts` (tier
direction, `@furnace/core` self-import ban, no `_`-prefixed exports in public
indexes, pinned module-global mutable state). The payoff is the extraction trigger:
the day a consumer wants the renderer without the world model (or the world model on
another renderer), the world tier promotes to its own `@furnace/world` package
mechanically, because the import direction was never allowed to blur. The first
dividend was immediate: relocating the mesh-blob codec out of `scene` (2026-08-04)
took a field-only bundle from ~2.9 MB with Rapier inside to ~15 KB without it — and it
is what let `scene` be deleted a day later without taking the codec with it.

### Dual-mode, restated on the field artifact

The oldest editor decision (2026-06-06, `docs/backlog/editor-and-tooling/editor-backend-architecture.md`
decisions 5–6) is **dual-mode**: furnace is *both* a code-first library — a consumer imports
`@furnace/core` and builds a world in TypeScript, the one-off / website-embed path — *and* an
editor-authored engine — author in the editor, ship an artifact, the full-game path. The two
coexist because they converge on ONE runtime representation, and the discipline that keeps
that honest is that **the loader lives in core** and the editor may add workflow and
opinionated defaults but never runtime semantics core cannot reconstruct.

That principle is unchanged. Its *instance* changed: the interchange used to be the
serialized scene document, and since foundations T2 it is **the field artifact plus its op
log** — `chunks/` (the density store, the authoring truth), `oplog.json` (the recipe that
produced it, replayable and reconfigurable), and the derived bake (`meshes/`, `kit/`,
`materials/`, `placements.json`) the runtime actually loads. `field.bakeFieldWorld` is pure
and lives in core, so the editor's export, a consumer's own bake script, and a headless test
all produce byte-identical artifacts from the same ops. Code-first authoring is
`createFieldStore` + `logApply` / `commitGenerator` in a script (`packages/dungeon/scripts/bake-default-world.ts`
is the worked example); editor authoring is the same calls behind a cockpit; and a consumer
with only core installed loads the result. The engine precedents the original decision cited
(Godot `.tscn`, Unity prefabs, three.js `ObjectLoader`) still describe the shape — the
artifact is just voxels-and-ops rather than a node tree.

---

## 16. Huge-world realization assumptions (the F5 handoff register)

Promoted to this tracked home at the T3 objectives audit (2026-08-08) — it previously
lived only in the foundations programme's local planning notes, which do not ship with
the repo. This is the register F5 ("scale") inherits: the places where core and its
consumers assume a world is FULLY REALIZED, each a signature that changes shape under
streaming. Measured 2026-08-04; re-derive anchors at pickup (symbols are the stable
handle).

- **`bakeFieldWorld`** (`packages/core/src/field/artifact.ts`) — all chunks materialized
  in one array.
- **`analyze.ts`'s whole-world pass** — a map over every chunk.
- **`copyStore`** (`packages/core/src/field/maintenance.ts`) — a deep copy, also called
  in a loop.
- **`reconfigure.ts`'s prefix replay** — a full op-log prefix replay into a fresh
  whole-world scratch (its own comment states the ceiling).

Plus three adjacent facts of the same class: **OpLog inverses pin full chunk pre-images
with no eviction** (undo depth = O(chunks touched × stack depth) resident bytes);
**dungeon's loader is fully eager** (hundreds of sequential fetches for a large world;
the render list is frozen before the frame loop); and **the editor needs full-view over
worlds that cannot be fully realized** (region-of-interest realization + aggregate
overview — an open design problem, F5's to take).

**The standing obligation on every tranche between now and F5: add no fifth
assumption.** The one recorded near-miss so far is the editor's `latchEntities`
(a whole-op-log walk multiplied per reader — accepted with a trigger,
`docs/backlog/editor-and-tooling/latchentities-walks-the-oplog-per-reader.md`). The
dungeon-side streaming seed stays parked at
`docs/backlog/dungeon/jit-runtime-regions.md`.

## Threads to pull on for further research

- **WebGPU compute** — Surma's blog, the WebGPU Samples, gpuweb.github.io/gpuweb
- **WebNN** — current spec status, Chrome implementation roadmap
- **wgpu (Rust)** — the standalone library that powers Firefox and Bun-WebGPU; consider its book/docs for native portability
- **Bevy** — engineering blog posts on ECS, scheduler design, parallel system execution
- **Unity DOTS** — case studies on cache-friendly memory layout, job system
- **Data-Oriented Design** by Richard Fabian — the canonical book
- **Generative Agents** (Park et al. 2023) — Stanford paper, foundational for LLM-driven NPC research
- **Voyager** (NVIDIA) — Minecraft LLM agent, papers + code
- **SayCan / PaLM-E** (Google) — robotics LLM-as-planner papers
- **NVIDIA ACE** — overview of shipping product
- **Inworld AI** — middleware for LLM NPCs, blog posts on production challenges
- **Apollo / Cicero** (Meta) — Diplomacy AI using LLMs
- **Bullet / Rapier / Jolt** source code — if curious about classical physics solver internals
- **WGSL spec** — for understanding what GPU compute shaders can express

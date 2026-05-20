# Modern Game Engine Architecture — Exploration Notes

*Conversation captured 2026-05-14. Starting point: investigating the [Shallot](https://github.com/dylanebert/shallot) repo by Dylan Ebert and how Rust/Bun/WebGPU fit together. Conversation expanded into ECS, event-loop architecture, GPU vs CPU work, game AI, and LLM-as-planner agent architectures.*

**A note on confidence**: assertions about Shallot's repo are verified from reading the source. Comparisons to Babylon, Unity, Unreal, and discussion of broader research directions are mostly general/training knowledge — flagged inline where relevant. The GPU physics landscape and ML/game-AI research areas move fast; expect some staleness.

---

## Table of contents

1. [How Shallot is set up — Bun + Rust mix](#1-how-shallot-is-set-up--bun--rust-mix)
2. [Concrete proof: where TS imports the Rust-built wasm](#2-concrete-proof-where-ts-imports-the-rust-built-wasm)
3. [What wasm-pack actually emits, and what's *not* in wasm](#3-what-wasm-pack-actually-emits-and-whats-not-in-wasm)
4. [WebGPU as a cross-platform native abstraction](#4-webgpu-as-a-cross-platform-native-abstraction)
5. [Shallot vs Babylon.js](#5-shallot-vs-babylonjs)
6. [Shallot's physics — fully hand-rolled](#6-shallots-physics--fully-hand-rolled)
7. [Is there really no GPU physics engine out there?](#7-is-there-really-no-gpu-physics-engine-out-there)
8. [Vision matters — hobby vs niche-finder vs big-engine competitor](#8-vision-matters--hobby-vs-niche-finder-vs-big-engine-competitor)
9. [OSS adoption realism](#9-oss-adoption-realism)
10. [Pattern summary — web-tech first, Rust where needed](#10-pattern-summary--web-tech-first-rust-where-needed)
11. [ECS refresher — what changed since 2000](#11-ecs-refresher--what-changed-since-2000)
12. [The event loop and how it doesn't bottleneck the engine](#12-the-event-loop-and-how-it-doesnt-bottleneck-the-engine)
13. [Job systems and synchronization](#13-job-systems-and-synchronization)
14. [AI in games — classical vs ML, GPU vs CPU](#14-ai-in-games--classical-vs-ml-gpu-vs-cpu)
15. [Could a tiny LLM replace state machines / pathfinding?](#15-could-a-tiny-llm-replace-state-machines--pathfinding)
16. [LLM-as-planner — the actual architecture that works](#16-llm-as-planner--the-actual-architecture-that-works)

---

## 1. How Shallot is set up — Bun + Rust mix

**Core answer:** It's a **Bun/TypeScript app at its core**, with Rust used selectively for hot-path or platform-specific pieces.

### Layout
- **Top-level**: Bun workspace (`workspaces: ["packages/*", "examples/*"]`), TypeScript-first, Biome for lint/format, Playwright for tests.
- **`packages/shallot/`** is the actual engine. Its `package.json` declares `main: ./src/index.ts` — i.e. the shipped public API is TypeScript. Subpath exports cover ECS core, render, physics, audio, transforms, raytracing, etc.
- **`packages/shallot/rust/`** holds **three separate Rust crates**, each compiled differently:
  1. `transforms/` → **wasm-pack** (`--target web --release`) → emits a `pkg/` JS+wasm bundle that's imported from TS.
  2. `audio/` → raw `cargo build --target wasm32-unknown-unknown --release`, then `wasm-opt -O3` (with a fallback that just copies the unoptimised `.wasm` if `wasm-opt` is missing). The build script generates the JS + `.d.ts` loader by hand instead of using wasm-bindgen/wasm-pack.
  3. `window/` → `cargo build --release` (no wasm target) — a **native binary**. CLAUDE.md called it a "native window host," so this is a desktop runner, not browser-shipped.

### How the two halves connect
`scripts/build.ts` (run via `bun run build`) is the orchestrator. It shells out to `cargo` / `wasm-pack` / `wasm-opt`, fixes up the generated `pkg/` (removes the `.gitignore`, sets `sideEffects: false`, runs Biome on it), and then the TS source imports the produced wasm packages like any other JS module. There's no FFI, no NAPI native node addon, no build.rs glue — it's: **Rust → wasm → JS module → `import` from TS**.

---

## 2. Concrete proof: where TS imports the Rust-built wasm

File: `packages/shallot/src/standard/transforms/wasm.ts`

```ts
import wasmInit, {
    get_pos_x_ptr, get_pos_y_ptr, get_pos_z_ptr,
    get_quat_x_ptr, ..., get_scale_z_ptr,
    get_matrices_ptr, get_indices_ptr, get_parents_ptr,
    get_capacity, get_no_parent, init_data,
    ensure_capacity as wasmEnsureCapacity,
    compute_transforms,
} from "../../../rust/transforms/pkg/shallot_transforms.js";
```

That `pkg/shallot_transforms.js` path is exactly the wasm-pack output dir inside `packages/shallot/rust/transforms/pkg/` — produced by `wasm-pack build --target web --release` in `scripts/build.ts`. The relationship is concrete:

- Rust crate at `packages/shallot/rust/transforms/`
- Built by `bun run build` → `wasm-pack` → emits `rust/transforms/pkg/shallot_transforms.js` + `.wasm`
- Imported by `src/standard/transforms/wasm.ts` via a plain relative path

It uses the **wasm-pack-style default export = init function** + named exports for the Rust fns, and works against the raw linear-memory pointers (typed array views over wasm memory rather than a thick wasm-bindgen object layer).

---

## 3. What wasm-pack actually emits, and what's *not* in wasm

**The emitted `.js` file** is a thin **loader/glue** — it `fetch`es the `.wasm`, instantiates it, and re-exports the Rust functions as JS bindings. Actual work is in the `.wasm` binary; the `.js` is just the bridge.

**What's actually in wasm in Shallot:**
- ✅ **`transforms`** — scene-graph matrix math (positions, quaternions, scale → matrices). Hot per-frame CPU loop.
- ✅ **`audio`** — DSP for synthesis/effects. Likely consumed in the AudioWorklet.
- ❌ **Graphics is *not* in wasm.** This is a WebGPU engine — the GPU-heavy work runs on the **GPU** via WGSL shaders, not on the CPU via wasm. Rendering doesn't benefit from wasm because the bottleneck is GPU command submission, not CPU speed. Package exports show `render/core` and `physics/core` both map to `.ts` files.

The third Rust crate, `window`, is a **native binary** — for running the engine outside the browser as a desktop app, not for browser-side perf.

**Mental model:** TS for orchestration + WebGPU for graphics/physics + wasm for tight CPU-bound loops the GPU can't do (scene-graph transforms, audio DSP) + a native Rust binary for the desktop host. Not "wasm does the heavy stuff" — more "each tool where it actually wins."

---

## 4. WebGPU as a cross-platform native abstraction

WebGPU is designed as a cross-platform abstraction that compiles down to **Metal on macOS/iOS, Vulkan on Linux/Android, DirectX 12 on Windows**. The spec is intentionally close to the lowest common denominator of those three so the translation is thin.

Nuances:
1. **WebGPU isn't browser-only.** Browsers use one of two implementations: Chrome uses **Dawn** (C++, Google), Firefox uses **wgpu** (Rust, Mozilla). Both can be embedded in non-browser apps. `wgpu` in particular is a popular standalone Rust crate.
2. **For Shallot specifically**, `bun-webgpu` is in devDependencies — that's a Bun-native binding to `wgpu`. So the native picture is likely: Bun executes the TS, `bun-webgpu` provides the WebGPU API surface, `wgpu` translates to Metal/DX12/Vulkan, the `rust/window` crate provides the OS-level window + surface. Same TypeScript engine code runs identically in the browser and on the desktop, only the bootstrap differs.
3. **The tradeoff WebGPU makes**: deliberately conservative API, doesn't expose every native feature (raytracing extensions still patchy, mesh shaders not there yet). Fine for most game/visualisation work, hits ceilings on cutting-edge AAA techniques.

Architectural payoff: write the engine once in TS+WGSL, get browser + native desktop targets nearly for free, with Rust filling the two gaps (windowing/host, plus CPU hot loops) that the JS/WebGPU side can't cover.

---

## 5. Shallot vs Babylon.js

*Caveat: most Babylon details are general knowledge, not verified in session.*

| | Shallot | Babylon |
|---|---|---|
| Architectural paradigm | ECS / data-oriented | Scene graph / object-oriented |
| Render backend | WebGPU only | WebGL 1/2 + WebGPU |
| Native desktop | Same TS via Bun + wgpu | Babylon Native (C++ via bgfx) |
| Performance strategy | GPU-first + selective wasm | Pure JS + wasm physics plugins |
| Maturity | v0.4, solo author | 12+ years, Microsoft + community |
| API style | Procedural / declarative / ECS | Imperative, OOP |
| Production track record | None yet | Adobe, NASA, BMW |

**They're not really competitors** — different points on the spectrum. Babylon = "production 3D engine you can ship a product on today." Shallot = "what would a 2026-era engine look like if we threw out WebGL compatibility and started from data-oriented design."

---

## 6. Shallot's physics — fully hand-rolled

**Evidence:** package.json has **zero** physics libraries — no Rapier, Havok, Ammo, Cannon, Jolt, Bullet, PhysX. The `src/standard/physics/` directory contains the full vertical implementation:

- Broadphase: `lbvh.ts` (Linear Bounding Volume Hierarchy build), `broadphase.wgsl.ts` (GPU traversal)
- Narrowphase: `sat.ts` (Separating Axis Theorem), `narrowphase.wgsl.ts`, `quickhull.ts`/`hull.ts` (convex hull construction)
- Solver: `solver.wgsl.ts` (constraint solver on GPU)
- Integration & misc: `interpolate.wgsl.ts`, `character.wgsl.ts`, `raycast.ts`, `body.ts`

Textbook from-scratch rigid-body pipeline — every stage you'd find in Bullet or Rapier, implemented as WebGPU compute shaders. AGENTS.md mentions "solver variants" which only makes sense if you're writing the solver yourself.

**Why this isn't just NIH (Not Invented Here):**
- Babylon's approach: plugin wrapping mature CPU engines (Havok wasm, Rapier wasm). Mature, deterministic. BUT — every frame copies state CPU↔GPU. Bus traffic kills throughput.
- Shallot's approach: GPU-resident. Same buffers physics writes are read by the renderer. No bus traffic.
- **You can't bolt GPU acceleration onto Havok/Rapier** as a plugin — those engines are designed around CPU memory layouts. If the thesis is "physics belongs on the GPU alongside the renderer," you basically *have* to write it yourself.

**Tradeoff:** architectural purity now, multi-year maturity debt against Havok forever. Bet only pays off if the engine finds a niche where GPU-resident physics matters more than feature breadth.

---

## 7. Is there really no GPU physics engine out there?

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

## 8. Vision matters — hobby vs niche-finder vs big-engine competitor

"Big-engine competitor vs hobby" is a false binary. Successful engines live in the middle:

- **Bevy** — years of "hobby project" status, won by being the best answer for "ECS + Rust + open source."
- **PlayCanvas** — owned "interactive web 3D for ads/configurators," acquired by Snap.
- **Three.js** — most-deployed 3D engine in the world, has nothing approaching Babylon's feature set.
- **Defold, Heaps, MonoGame, LÖVE** — all real engines, none competing with Unreal.

**Plausible niches for Shallot that don't require closing the Havok gap:**
- **Embodied AI / robotics sim in browser** — GPU-resident physics maps onto RL training with thousands of parallel agents.
- **Procedural / generative content tooling** — fits the "procedural-first" framing.
- **Demoscene / creative coding / installations** — same niche Three.js dominates.

The interesting question is not "hobby vs competitor" but **"what niche does this architecture make him uniquely good at?"** That determines whether the physics gap is existential or irrelevant.

---

## 9. OSS adoption realism

"People will pick it up and contribute" is the romantic version. The mechanical version:
- Contribution follows usage
- Usage follows the project solving a real problem better than alternatives
- That gate is much higher than "good code"

Most technically excellent solo projects on GitHub never get a second contributor — not because the code isn't good, but because there's no acute reason to switch from what people already use. Bevy got contributors because Rust gamedev had no good answer. Three.js got contributors because WebGL had no other reasonable interface.

**Author stamina matters more than code quality.** OSS projects die from maintainer burnout, not technical deficiency. Solo engine of this scope needs 3-5 years of sustained commitment before network effects kick in. Hard to read from a repo.

---

## 10. Pattern summary — web-tech first, Rust where needed

The thesis isn't quite "maximum performance" — it's "**modern foundations without legacy compatibility tax**":
- Dropped: WebGL fallback, OOP scene graph, CPU physics, React, Webpack, npm
- Kept: TypeScript public surface, web platform reach, Bun DX
- Added: Rust *only* where the platform genuinely can't deliver (CPU SIMD loops, native windowing)

**This pattern shows up across modern tooling:**
- **Figma**: C++/WASM rendering, JS UI
- **VS Code / Cursor**: Electron shell, Rust acceleration (ripgrep, rust-analyzer)
- **1Password 8**: Rust core, Electron UI
- **Shallot**: Bun + TS + WebGPU shell, Rust hot loops + native window

The pattern: **web platform is the lowest-friction surface for tooling; the gap that remains gets filled with Rust because Rust integrates cleanly with wasm.** C++ used to fill that gap but the tooling is worse.

**Why Svelte for the editor specifically** (note: rare choice — most engine editors are React or native):
- Compiles to direct DOM updates, no virtual-DOM reconciler. Every ms the UI doesn't take is one the engine gets.
- Svelte 5 runes/signals model = fine-grained reactivity, maps cleanly to ECS (components are values, UI subscribes to specific values).
- Coexists with WebGPU render loop on the same machine without fighting for main-thread time.

---

## 11. ECS refresher — what changed since 2000

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

**This is exactly what Shallot's `transforms/wasm.ts` does** — `posX`, `posY`, `posZ` as separate `Float32Array`s, not `Vec3` objects. Pure SoA layout. Wasm sweeps linearly; GPU ingests coalesced.

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

## 12. The event loop and how it doesn't bottleneck the engine

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

## 13. Job systems and synchronization

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

## 14. AI in games — classical vs ML, GPU vs CPU

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

## 15. Could a tiny LLM replace state machines / pathfinding?

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

## 16. LLM-as-planner — the actual architecture that works

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
- **Dylan Ebert's other work** — he's also done HuggingFace 3D / Gaussian splat tooling work (uncertain, didn't verify in session)

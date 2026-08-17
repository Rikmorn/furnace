# Prior art: consumer API posture & concept taxonomy in game engines and rendering libraries

This document surveys how mature engines **classify and name the concepts in their public API** — the layer *above* resource-lifecycle mechanism. The two sibling docs cover the mechanism: [`2026-05-27-resource-manager-prior-art.md`](./2026-05-27-resource-manager-prior-art.md) (who owns the pool, when a free actually happens) and [`2026-05-27-destroy-ownership-prior-art.md`](./2026-05-27-destroy-ownership-prior-art.md) (what `destroy(handle)` does at the boundary). This file looks at the orthogonal question furnace's A-8 tranche needs: **what *kinds* of thing does an engine expose (value-type vs handle vs descriptor vs factory vs escape-hatch vs scene), and how are they named so a consumer can tell them apart?**

It feeds A-8's concept taxonomy. Findings are verified against primary sources (official docs, GitHub source) in the research session of 2026-05-29; claims relying on general knowledge are flagged "uncertain". Citations inline.

The engines surveyed span the abstraction spectrum deliberately: **bevy** (Rust ECS, explicit named taxonomy) and **raylib** (C, value-structs-everywhere) at the ends; **three.js** + **PixiJS** (the dominant JS/web OO precedents furnace's consumers already know); **wgpu** + **sokol-gfx** (the low-level handle-based GPU layer furnace's resource manager is modelled on).

---

## 1. The six dimensions

Each engine is examined on the same six axes, chosen to match furnace's open questions:

1. **Value-type vs resource distinction** — how the engine separates lightweight mutable data (a Camera you poke) from GPU-backed managed resources (a Mesh/Texture), and whether the distinction is *named*.
2. **Verb families by concept class** — what verbs name create/teardown/runtime-control, and whether the verb deliberately varies per class.
3. **Sugar-factory pattern** — whether there's an analog to "minimal core mutator + a namespace of validated pure-data factory functions" (furnace's `policy.stretch/preserveHeight/preserveWidth` → `setFitPolicy`).
4. **API shape** — OO methods, free functions taking `(ctx, handle)`, ECS systems, or builders.
5. **Escape-hatch convention** — how dropping to the raw/lower layer is exposed.
6. **Scene / render-list concept** — how "the set of drawables + camera + post" is modelled, and whether it's a stateful owned object or a transient value.

---

## 2. Per-engine findings

### bevy (Rust ECS) — the explicit named taxonomy

Verified against docs.rs (latest, 0.15+ "required components" era) and bevy.org.

1. **Value-type vs resource — a hard, *named* line.** Bevy's taxonomy: **Component** (plain data on an entity, mutated in place — e.g. `Transform`, `Camera`); **Resource** (global singleton data); **Asset + `Handle<T>`** (GPU/disk-backed data — `Mesh`, `Image`, `StandardMaterial` — stored in an `Assets<T>` collection, referenced by a lightweight `Handle<T>`, never mutated *through* the handle: you go via `Assets::get_mut`). `Assets<A>` implements `Resource` ([docs](https://docs.rs/bevy/latest/bevy/prelude/struct.Assets.html)). Where furnace's types land: **Camera = Component** (`pub struct Camera { viewport, order, is_active, clear_color, … }`, mutated in place — *not* a handle) ([Camera](https://docs.rs/bevy/latest/bevy/prelude/struct.Camera.html)); **Mesh = Asset**, referenced on an entity by the newtype `pub struct Mesh3d(pub Handle<Mesh>);` ([Mesh3d](https://docs.rs/bevy/latest/bevy/prelude/struct.Mesh3d.html)); **Material = Asset** via `MeshMaterial3d<M>(pub Handle<M>)`.
2. **Verbs vary by class, deliberately:** entities **spawn / despawn**; components **insert / remove**; assets **add / load + get_mut**. The verb tells you the concept class.
3. **Sugar-factory — strong positive.** `Color` exposes a flat namespace of validated named constructors: `Color::srgb / srgba / srgb_u8 / linear_rgb / hsl / hsla / oklab / oklch` ([Color](https://docs.rs/bevy/latest/bevy/prelude/enum.Color.html)). This is *exactly* furnace's `policy.*` shape. Plus pervasive `..Default::default()` and `with_*` builders (builder ubiquity: general knowledge, not re-verified).
4. **API shape — ECS.** Data is plain structs; behaviour is **systems** (free functions taking typed `Query`/`Res`/`ResMut`); mutation is `Commands` (deferred) or direct `&mut` field write. Essentially no getter/setter methods — you write `camera.field = x` through a `&mut`.
5. **Escape-hatch — one explicit named door.** `RenderDevice::wgpu_device(&self) -> &Device` ("Returns the underlying wgpu Device") plus typed conveniences so most code never needs it ([RenderDevice](https://docs.rs/bevy/latest/bevy/render/renderer/struct.RenderDevice.html)).
6. **Scene — none stateful.** Rendering is ECS-query-driven through a render graph; the `Camera` Component is the render entry point. "What's drawn" = the live query result, not an object you build and hand off. (render-graph internals: partly general knowledge.)

### raylib (C, minimal) — value-structs everywhere

All fields/signatures verified verbatim from `src/raylib.h` master ([raylib.h](https://github.com/raysan5/raylib/blob/master/src/raylib.h)).

1. **No named taxonomy.** Everything is a plain C value struct passed by value. The *only* implicit signal is whether a struct carries a GPU `id`: GPU-backed (`Texture = { unsigned int id; int width,height,mipmaps,format; }`, `Shader`, `Mesh` with `vaoId/vboId`) vs pure value (`Camera3D = { Vector3 position, target, up; float fovy; int projection; }`, `Vector*`, `Matrix`, `Color`). **Camera is a plain struct you mutate directly** — same spirit as furnace's Camera record. GPU resources are *also* raw structs (no opaque handle; you can read `texture.id`).
2. **Verbs by subsystem:** acquire/release = **Load… / Unload…**; procedural data = **Gen…** (`GenMeshCube`); CPU→GPU upload = **Upload…** (`UploadMesh(Mesh*)`, pointer because it mutates); scoped GPU state = **Begin…/End…**.
3. **Sugar-factory — half present.** Free-function value producers exist (`ColorFromHSV`, `Fade`, `ColorLerp`, `GetColor`, `GenMeshCube`) but there's *no setter layer* — fields are public, so you mutate directly and use factories to *produce* values.
4. **API shape — free C functions, mostly pass/return by value** (structs kept small deliberately; pointer params reserved for in-place mutation: `Load`/`Update`/`Unload`). One flat header; hidden global context. Naming is `VerbNoun` (`DrawModel`, `LoadTexture`).
5. **Escape-hatch — a separate lower *layer*.** `rlgl.h` is a parallel pseudo-GL immediate-mode API (`rlVertex3f`, `rlPushMatrix`), prefix-namespaced by `rl`, usable standalone. (rlgl surface: skimmed, not line-by-line.)
6. **Scene — none.** Pure immediate mode: `BeginMode3D(Camera3D camera)` / `EndMode3D()` bracket draw calls; **the camera is passed by value per frame**, never retained. The "render list" is the sequence of `Draw*` calls between Begin/End — transient.

### three.js (JS/web, OO) — retained scene graph, dispose-capability as the signal

Verified against the `mrdoob/three.js` `dev` branch source.

1. **Value-type vs resource — signalled by `dispose()`-capability, not naming.** Value-types (`Vector3`, `Euler`, `Color`, `Matrix4`) have **no `dispose()`** and no GPU coupling. GPU resources (`BufferGeometry`, `Material`, `Texture`) **all extend `EventDispatcher` and have `dispose()`** (which dispatches a `'dispose'` event the renderer consumes to free GPU memory) — verified in `src/core/BufferGeometry.js`, `src/materials/Material.js`, `src/textures/Texture.js`. **Camera** = `class Camera extends Object3D` (verified `src/cameras/Camera.js`); its transform is the inherited `Object3D.position`/`.rotation`/`.scale` value-types; it has **no `dispose()`** — treated as a lightweight node, not a GPU resource. No name-prefix convention.
2. **Three orthogonal verb pairs, never collapsed:** `new`/`dispose` (lifetime), `add`/`remove` (scene-graph membership — *distinct from* dispose: removing from the graph does NOT free GPU memory), `addEventListener`/`removeEventListener` (events, DOM-style).
3. **Sugar-factory — polymorphic `.set()`/`.setValues()` on the instance**, not a factory namespace. `Color.set(value)` routes on input type (`isColor`→copy, number→`setHex`, string→`setStyle`) — verified `src/math/Color.js`. `material.setValues({...})` validates keys + routes by type. Static `X.from(...)` is **not** idiomatic in three.js core (loading goes through loader *objects*).
4. **API shape — OO, direct sub-object mutation.** `mesh.position.x = 5`, `mesh.position.set(1,2,3)`, `material.opacity = 0.5`. No context parameter — objects are self-contained, the renderer is touched only at `render()`.
5. **Escape-hatch — methods on the renderer + subclassable types.** `renderer.getContext()` returns the raw `WebGL2RenderingContext` (verified `return _gl;`), `renderer.getRenderTarget()`, `renderer.info`; `ShaderMaterial`/`RawShaderMaterial` for raw GLSL.
6. **Scene — first-class, stateful, owned.** `class Scene extends Object3D` (verified) — the root scene-graph node; `scene.add(mesh)`/`remove` (inherited). Render call: `renderer.render(scene, camera)` — **the camera is a separate argument, not held by the Scene** (verified: Scene has no camera property). Scene carries scene-wide state (`background`, `fog`, `environment`, `overrideMaterial`). Post-processing is **outside core**: `EffectComposer` (addon) wraps the renderer (`composer.addPass(new RenderPass(scene, camera))`), it is not a field on the Scene.

### PixiJS v8 (JS/web, OO) — resource/view split in the type system

Verified against the `pixijs/pixijs` `dev` branch (v8) source.

1. **Value-type vs resource — split *in the type system*.** **`TextureSource`** = the GPU-backed resource (owns uploaded pixels); **`Texture`** = a lightweight *view* over a `TextureSource` (frame rect, UVs). `Texture.destroy(destroySource = false)` frees the GPU source only if you opt in — because many Textures share one Source (verified `Texture.ts`). Value-types: `Point`/`ObservablePoint` with `.set(x,y)`, no destroy. Signal = `destroy()` presence + the source/view *naming*. **PixiJS is 2D-only — there is no camera class** (verified); the "camera" idiom is transforming a root `Container` (community practice, not a named API).
2. **Three orthogonal verb sets:** `new`/`from`…`destroy` (lifetime — note PixiJS uses **`destroy`**, where three.js uses **`dispose`**), `addChild`/`removeChild` (membership — note the `-Child` suffix), `on`/`off` (events, Node-style eventemitter3).
3. **Sugar-factory — static `X.from(...)` strongly idiomatic.** `Texture.from(source)`, `Sprite.from(source)` (verified: routes `Texture` instance vs raw source), `Filter.from({glProgram, gpuProgram, resources})`. Loading is a separate subsystem: `Assets.load(url)` (Promise, cache-aware singleton). Constructors increasingly take a single options object.
4. **API shape — OO, dual path:** direct scalar aliases (`sprite.x = 5` aliases `position.x`, verified) AND `.set()` on sub-objects (`sprite.position.set(100,100)`, `sprite.scale.set(2)`). No `ctx` parameter.
5. **Escape-hatch — renderer fields + subclassable low-level types.** `renderer.gl` (raw WebGL — exact v8 property name uncertain), custom `Filter.from({glProgram/gpuProgram})` for raw GLSL/WGSL, low-level `Geometry`/`Shader`/`Mesh` trio (exact v8 signatures uncertain).
6. **Scene — first-class, stateful, the *same* `Container` tree.** Root is `app.stage` (a `Container`); retained-mode (objects persist across frames). `renderer.render(stage)` — **no camera argument** (2D). Post-processing = **`container.filters = [...]`** on the scene node (the *opposite* of three.js's external composer). Membership: `stage.addChild(sprite)`.

### wgpu (Rust WebGPU) — three tiers, descriptor suffix, `unsafe` escape

Type/method signatures quoted from docs.rs (latest).

1. **Three tiers, only the descriptor tier is *named*.** Resource handles (`Buffer`, `Texture`, `BindGroup`, `RenderPipeline`, `ShaderModule`) — bare nouns, refcounted/cloneable, RAII `Drop`. Descriptors — uniformly **`*Descriptor`** suffix (`BufferDescriptor`, `RenderPipelineDescriptor`). Value types — bare nouns but `Copy` (`Color` is `#[repr(C)]` with `pub r/g/b/a` + constants `Color::WHITE`; `Extent3d`, `Origin3d`). Handle-vs-value disambiguated by *type shape* (`Copy`+public fields vs opaque refcounted), not name.
2. **Verbs:** `Device::create_*(&desc) -> Resource` (construction); dual destroy — RAII `Drop` **plus** explicit `Buffer::destroy(&self)` ("as soon as possible"); `Queue::submit`. **Transient passes get `begin_*`, NOT `create_*`:** `CommandEncoder::begin_render_pass`/`begin_compute_pass`; the pass ends by being dropped (RAII). Clearest verb-class signal in the survey.
3. **Sugar-factory — none.** Idiom is raw struct literal + `Default`: `BufferDescriptor { size, usage, ..Default::default() }`. Only helpers are shader-loading macros (`include_wgsl!`). Validation at `create_*` time, not in a constructor.
4. **API shape — methods on handle/encoder objects.** `device.create_buffer(&desc)`, `buffer.slice(..)`, `encoder.begin_render_pass(..)`. `&self` *is* the handle; no explicit `(ctx, handle)` threading.
5. **Escape-hatch — `unsafe` methods generic over the HAL backend.** `Device::as_hal<A>(&self)`, `Buffer::as_hal<A>`, `create_*_from_hal` — all `pub unsafe fn`; the lower layer is the re-exported `wgpu_hal` crate. Segregation signal is the `unsafe` keyword, not location (a language-shaped near-miss to "standalone function", not a counterexample). (`Surface::get_current_texture` is normal swapchain API, *not* an escape hatch.)
6. **Scene — none.** No `Scene`/`Node`/`Entity`/`World` in the public API. "What to draw" is imperative `CommandEncoder` → `RenderPass` (`set_pipeline`/`set_bind_group`/`draw`). The only retained-ish primitive is `RenderBundle` (a recorded command list, still not a scene).

### sokol-gfx (C single-header) — `uint32_t id` handles, `_desc` suffix, standalone escape hatches

Verified verbatim from `sokol_gfx.h` master (26,798 lines); line numbers cited.

1. **Two naming tiers + plain value structs.** Resource handles are uniformly `typedef struct sg_buffer { uint32_t id; } sg_buffer;` (and `sg_image`/`sg_sampler`/`sg_shader`/`sg_pipeline`/`sg_view`, lines 2005–2010) — pool index + generation in the bits. **furnace's branded uint48 directly mirrors this `uint32_t id` pattern.** Descriptors uniformly **`_desc`** suffix (`sg_buffer_desc` 3260, etc.). Value/data structs are bare `sg_*` (`sg_range`, `sg_bindings`, `sg_color`). Handle-vs-value by *shape*; descriptor by suffix.
2. **Richest verb taxonomy:** one-shot `sg_make_<res>(desc*) -> handle` (5119) / `sg_destroy_<res>` (5125); decomposed `sg_alloc`/`sg_init`/`sg_uninit`/`sg_dealloc`/`sg_fail` (5204–5233); per-draw state `sg_apply_pipeline`/`sg_apply_bindings`/`sg_apply_uniforms` (5143–5145); scoped pass `sg_begin_pass`/`sg_end_pass` (5138/5149); execution `sg_draw`/`sg_dispatch`/`sg_commit`. `make`/`destroy` = pooled resources; `apply_*` = transient per-draw state; `begin_pass`/`end_pass` = scoped pass.
3. **Sugar-factory — none.** Zero-init desc structs with defaults patched in (lines 410–413); `sg_query_<res>_defaults(desc*) -> desc` to inspect. Validation at `sg_make_*`.
4. **API shape — C free functions taking handle structs by value** (`sg_apply_pipeline(sg_pipeline)`, `sg_update_buffer(sg_buffer, range*)`), global implicit context via `sg_setup()`. **This is the closest precedent to furnace's `fn(ctx, handle)` shape** — sokol with implicit (not explicit) context. The namespace (`mesh.`/`material.`) plays sokol's `_buffer`/`_image` suffix role: the surrounding name carries the resource-class info.
5. **Escape-hatch — directly validates standalone-functions.** A flat namespace of backend-prefixed free functions: `sg_wgpu_device()`/`sg_wgpu_queue()`/`sg_wgpu_command_encoder()` (5396–5404), `sg_mtl_device()`, `sg_d3d11_device()`, per-resource `sg_<backend>_query_<res>_info(handle)`, plus `sg_reset_state_cache()` (5111). Lexically segregated by the `sg_<backend>_` prefix — separate, standalone, marked.
6. **Scene — none, purely immediate-mode.** No scene/node/entity type in the header; "what to draw" is the per-frame `sg_begin_pass` → `sg_apply_*` → `sg_draw` → `sg_end_pass` → `sg_commit` sequence. (Absence verified in source; sokol's "build it on top" *intentionality* is from floooh's blog ethos — general knowledge.)

---

## 3. Prior-art comparison table

| Dimension | bevy | raylib | three.js | PixiJS v8 | wgpu | sokol-gfx |
|---|---|---|---|---|---|---|
| **Named taxonomy?** | **Yes** — Component / Resource / Asset+`Handle<T>` / Bundle | No — all value structs (GPU ones carry `id`) | No — signalled by `dispose()`-capability | Partial — `TextureSource` (resource) vs `Texture` (view) | Partial — only `*Descriptor` named | Partial — only `_desc` named; handles = `{uint32_t id}` |
| **Camera is…** | Component (mutable data, *not* a handle) | plain value struct | `Object3D` node (value-type transform, no `dispose`) | n/a (2D) | n/a | n/a |
| **Resource identity** | `Handle<T>` into `Assets<T>` | raw struct w/ GPU `id` | descriptor object (renderer caches GPU state) | view over `TextureSource` | refcounted `Arc` handle | `uint32_t id` (slot+gen) |
| **Value-type/handle share a word?** | **No** | No | No | No | No | No |
| **Verb: resource teardown** | despawn / remove / (asset drop) | Unload | **dispose** | **destroy** | `Drop` + `destroy` | destroy / dealloc |
| **Verb: transient pass** | (render graph) | Begin/End | (renderer internal) | (renderer internal) | **begin_render_pass** + RAII | **begin_pass/end_pass** |
| **Verbs vary by class?** | Yes (deliberate) | Yes (per subsystem) | Yes (3 orthogonal pairs) | Yes (3 orthogonal sets) | Yes | Yes |
| **Sugar-factory namespace** | **Yes** (`Color::srgb/hsla/…`) | half (factories, no setters) | `.set()`/`.setValues()` on instance | static `X.from()` | none (`Default` + validate) | none (`_desc` + validate) |
| **API shape** | ECS systems | free fn, value-passing | OO, direct mutation | OO, dual path | methods on handles | **free fn `(handle)`** |
| **Escape-hatch** | one named door (`wgpu_device()`) | parallel `rl*` layer | renderer methods | renderer fields | `unsafe` methods (`as_hal`) | **standalone backend-prefixed fns** |
| **Scene concept** | none (ECS query) | none (immediate) | **stateful `Scene`** | **stateful `Container` tree** | none | none |
| **Abstraction tier** | high (engine) | mid (framework) | high (scene graph) | high (scene graph) | **low (GPU layer)** | **low (GPU layer)** |

---

## 4. Synthesis — what the field agrees on

**Unanimous: no engine uses one word for both a mutable-value-data thing and a GPU-resource thing.** All six keep them as visibly different *kinds* — by name (bevy `Component` vs `Handle<Asset>`; PixiJS `TextureSource` vs `Texture`), by structural shape (raylib `id` field; wgpu `Copy` vs `Arc`; sokol `{uint32_t id}`), or by capability (three.js `dispose()` presence). **furnace's "Camera = an opaque handle" documentation is an outright error against every engine surveyed** — bevy (Component), three.js (value-type-bearing node), and raylib (value struct) all model camera-like data as mutable value data, never as a resource handle. The fix is to reserve "handle" for the pooled uint48 resource class and give Camera a distinct noun (value-type / data record).

**Unanimous: verbs deliberately vary by concept class — and none collapses them.** Every engine maps a verb family to a concept class (bevy spawn/insert/add+load; three.js new/dispose + add/remove + addEventListener; wgpu/sokol create-destroy for resources but **begin/end for transient passes**). The strongest, most consistent signal is the **transient-scope split**: persistent resources get `create`/`destroy`; transient scoped passes get a *different* verb (`begin`/`end` or RAII). So furnace's instinct to vary verbs by class (create/destroy vs attach/detach vs stop/pause/resume) is *correct prior-art posture* — the pain is the lack of a documented mapping and the presence of avoidable synonyms (`dispose` vs `destroy`), not the variation itself. Naming datapoint: three.js=`dispose`, PixiJS=`destroy`; furnace's resource `destroy` + context `dispose` has precedent on both sides but must be justified. furnace's `attach/detach` and `stop/pause/resume` have *no* rendering-engine analog — pick and document, don't assume inheritance.

**The sugar-factory pattern is real but only the high-level/ECS tier uses it — apply it judiciously, not universally.** Only **bevy** fully exhibits "a flat namespace of validated named constructors for one value type" (`Color::srgb/hsla/oklch`) — which is *exactly* furnace's `policy.*`. The low-level GPU libs (wgpu, sokol) deliberately do **not**: they use defaultable POD descriptors + create-time validation. The lesson: the pattern earns its place where (a) a value has multiple equally-valid *named* construction modes (color spaces, fit policies, projection kinds) **and** (b) raw construction is error-prone — not for single-obvious-constructor values. furnace should write a *rule for when* `policy.*`-style sugar applies, not blanket-generalize it.

**furnace sits at the sokol/wgpu tier, and should own that.** furnace's free-function-with-`(ctx, handle)` shape is sokol-with-explicit-context — well-precedented by the very library its resource manager is modelled on. It *is* foreign to three.js/PixiJS web devs (who expect `obj.position.set()` / `obj.x = 5` on a retained object, no ctx, no handle indirection) — but that's a deliberate abstraction-tier choice, not a defect. The taxonomy should declare the tier explicitly: **furnace is a handle-based GPU-resource layer with thin conveniences, not a retained scene-graph.** This single framing resolves several open questions at once.

**Escape-hatches-as-standalone-functions is directly validated (sokol) and universally respected in spirit.** sokol is the exact precedent (backend-prefixed standalone free functions, lexically segregated); wgpu segregates via `unsafe`; bevy via one named door; three.js/PixiJS via renderer methods. The cross-engine principle: **escape hatches live in a visibly separate, marked region.** furnace's existing standalone-function convention (`material.createPipeline`, `frame.encode`, `gpu.getCurrentTextureView`) is well-supported; the improvement available is to make the "you're dropping to raw WebGPU" boundary *lexically* obvious (a naming/grouping convention).

**The Scene question is an abstraction-tier question, and prior art splits cleanly by tier.** Low-level libs (sokol, wgpu) and raylib deliberately have **no scene** — draws are imperative/transient, camera passed per frame by value (raylib `BeginMode3D(camera)`). High-level libs (three.js, PixiJS) have a **stateful retained Scene**. Since furnace sits at the low-level tier, the resolution is: a **transient, *named* render-list value** (the "Grade A" of audit §9.3 — naming the existing arg bundle) fits the tier and matches raylib's per-frame-camera model; a **stateful `Scene` object** ("Grade B") is a *higher-tier* concept = a new capability, which the anti-spiral rule routes to a *triggered backlog entry*, not A-8. Camera placement: three.js (the 3D precedent) passes camera *to* render, separate from the scene — furnace's `{ draw, camera, effects }` already does this; keep it.

---

## 5. What this feeds

This research grounds A-8's three deliverables:
1. **The taxonomy** — the value-type vs handle/resource split is the spine (§4 ¶1), with descriptors, factories, sugar-helpers, escape-hatches, and lifecycle objects as the other classes.
2. **The classification** — every `@furnace/core` export sorts into one class; the Camera "handle" overload is the headline correction.
3. **The forward-looking rules** — verb-family-per-class mapping (§4 ¶2), the *when* of sugar-factories (§4 ¶3), the declared abstraction tier (§4 ¶4), the escape-hatch convention (§4 ¶5), and the Scene tier-boundary (§4 ¶6).

*Citations: bevy — docs.rs/bevy (Assets, Camera, Mesh3d, MeshMaterial3d, Color, RenderDevice), bevy-cheatbook.github.io. raylib — github.com/raysan5/raylib/blob/master/src/raylib.h, raylib wiki data-structures. three.js — github.com/mrdoob/three.js `dev` (core/BufferGeometry.js, materials/Material.js, textures/Texture.js, cameras/Camera.js + PerspectiveCamera.js, scenes/Scene.js, math/Color.js, renderers/WebGLRenderer.js). PixiJS — github.com/pixijs/pixijs `dev` v8 (Container.ts, Texture.ts, Sprite.ts, ViewContainer.ts), pixijs.com/8.x guides. wgpu — docs.rs/wgpu (Buffer, Color, Device, index). sokol — github.com/floooh/sokol/blob/master/sokol_gfx.h (lines cited inline).*

**Fed:** the concept taxonomy and R1–R9 rules in `docs/reference/api-posture.md`, which names this six-engine survey as the evidence behind them; the rejected `{ target }` union at `docs/backlog/engine-architecture/unified-pass-target-union.md` cites it too.

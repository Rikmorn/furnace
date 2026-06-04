# Furnace Core: Public API Reference

The canonical list of what `@furnace/core` exposes to consumers. The cookbook
(`packages/cookbook`) demos each surface visually; this file documents them
textually with full signatures.

For *behavioural* contracts (coordinate system, color space, DPR, lifecycle,
failure policy, instrumentation), see `engine-conventions.md`.

For the *concept taxonomy* and the rules governing how new surface is shaped/named, see `api-posture.md`.

## Maintenance

Update this file whenever the public API of `@furnace/core` changes:

- New export → add to the relevant module section.
- Removed / renamed export → update or delete.
- Signature change → update the signature line.
- New internal-only `_*` export → add to that module's "Internal" subsection.
- New cookbook demo for an existing surface → add the cross-link.

If you change a public API and the relevant cookbook demo would be wrong as
a result, fix the demo in the same PR. If you add a new public API without
demoing it, mention which cookbook demo it would belong in (or note that
it's escape-hatch / reference-only).

The reference is "what the engine IS today." If it's stale, it's broken.

---

## `@furnace/core/gpu`

`import * as gpu from "@furnace/core/gpu";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `requestContext` | `(canvas: HTMLCanvasElement, options?: RequestContextOptions) => Promise<Context>` | Acquires a WebGPU adapter + device, configures the canvas, and returns a frozen `Context`. Throws `FurnaceGpuError` if WebGPU is unavailable. |
| `dispose` | `(ctx: Context) => void` | Destroys the device, clears bookkeeping. Idempotent. Warns to console if any resource-manager slots are still live when called. |
| `isDisposed` | `(ctx: Context) => boolean` | True after `dispose(ctx)`. |
| `getCurrentTextureView` | `(ctx: Context) => GPUTextureView` | Returns a view on the current swapchain texture, with the configured sRGB view format applied. Throws if `ctx` is disposed. Escape hatch — most consumers go through `frame.render`. |
| `onDeviceLost` | `(ctx: Context, fn: (info: GPUDeviceLostInfo) => void) => () => void` | Subscribe to WebGPU `device.lost` notification. Callback receives `GPUDeviceLostInfo`. Fires at most once per context. The emit is skipped when `gpu.dispose(ctx)` has been called (`reason: "destroyed"` is expected teardown). Setup-loud on disposed ctx. Returns idempotent unsubscribe. |
| `onResize` | `(ctx: Context, fn: (event: ResizeEvent) => void) => () => void` | Subscribes to canvas resize events. The engine resizes the backing store on each event. Returns an unsubscribe function. |
| `onUncapturedError` | `(ctx: Context, fn: (error: GPUError) => void) => () => void` | Subscribe to WebGPU uncaptured-error events. Callback receives the unwrapped `GPUError`. Setup-loud on disposed ctx. Returns idempotent unsubscribe. |
| `Context` | `Readonly<{ device: GPUDevice; queue: GPUQueue; format: GPUTextureFormat; canvas: HTMLCanvasElement; pixelRatio: number; _internal: InternalState }>` | The frozen root context **value-type** every other module threads as its first argument. |
| `RequestContextOptions` | `{ surfaceFormat?: "srgb" \| "linear"; pixelRatio?: "device" \| "css" \| number }` | Defaults: `surfaceFormat: "srgb"`, `pixelRatio: "device"`. |
| `ResizeEvent` | `Readonly<{ cssWidth: number; cssHeight: number; width: number; height: number; pixelRatio: number }>` | `width` / `height` are backing-store dimensions (the engine's "size truth"). |
| `FurnaceError` | `class FurnaceError extends Error` | Re-exported base class. Thrown for engine-domain errors. |
| `FurnaceGpuError` | `class FurnaceGpuError extends FurnaceError` | Thrown for WebGPU-specific failures (no adapter, disposed context, canvas misconfiguration). |

### Demoed in cookbook

- `requestContext`, `onResize`, `Context` → `cookbook/camera`.

### Reference-only (no demo, by design)

- `dispose` — every cookbook demo calls it implicitly on teardown; no dedicated demo.
- `isDisposed` — internal diagnostic; consumers rarely call it.
- `getCurrentTextureView` — escape hatch for consumers writing their own render pass; cookbook demos go through `frame.render` instead.
- `FurnaceError` / `FurnaceGpuError` — error types; surfaced by other surfaces' demos when failure-policy is exercised.

---

## `@furnace/core/frame`

`import * as frame from "@furnace/core/frame";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `loop` | `(ctx: Context, onFrame: (info: FrameInfo) => void, options?: LoopOptions) => FrameLoopHandle` | RAF wrapper. Records `_frameStart`/`_frameEnd` around the callback. Auto-pauses on `document.hidden` by default. |
| `fixedClock` | `(opts: { fixedDtMs: number; maxCatchupTicks?: number }) => FixedClock` | A separable fixed-step accumulator (no `ctx` — pure timing state, like an emitter). `advance(deltaMs, onTick) → alpha` runs `onTick(dtSeconds)` zero-or-more times (catch-up capped by `maxCatchupTicks`, default 8, spiral-of-death guarded) and returns `alpha ∈ [0,1)`; `setFixedDtMs` changes the step at runtime. Drive it from inside any render loop. |
| `FixedClock` | `{ advance(deltaMs, onTick): number; setFixedDtMs(fixedDtMs): void; readonly fixedDtMs: number }` | Returned by `fixedClock`. No lifecycle (plain GC'd timing state). Cold-path throws on non-positive `fixedDtMs` / non-integer `maxCatchupTicks`. |
| `render` | `(ctx: Context, opts: RenderOptions) => void` | One-shot render pass. Allocates a depth texture and per-camera uniform buffer lazily, sets up `group(0)`, iterates `opts.draw`, and (if `opts.effects` non-empty) ping-pongs effects to the swap chain. |
| `renderToTexture` | `(ctx: Context, opts: RenderToTextureOptions) => void` | Like `render`, but the color target is a consumer-supplied `GPUTexture`. No post-effects chain. Depth presence must agree with each drawn material's depth state; a mismatch (or a color-target format ≠ `ctx.format`, or a supplied `depthTexture` format ≠ `depth24plus`) throws `FurnaceGpuError`. |
| `encode` | `(ctx: Context, callback: (encoder: GPUCommandEncoder) => void) => void` | Low-level escape hatch: creates a command encoder, hands it to the callback, finishes and submits. Bypasses scene-pass / camera / mesh bookkeeping. Throws if `ctx` is disposed. |
| `FrameInfo` | `Readonly<{ elapsedMs: number; deltaMs: number }>` | `deltaMs` is capped by `LoopOptions.maxDeltaMs` (default 100). |
| `FrameLoopHandle` | `Readonly<{ stop: () => void; pause: () => void; resume: () => void }>` | Returned by `loop`. |
| `LoopOptions` | `{ maxDeltaMs?: number; pauseOnHidden?: boolean }` | Defaults: `maxDeltaMs: 100`, `pauseOnHidden: true`. |
| `RenderOptions` | `{ draw: Mesh[]; camera: Camera; effects?: Effect[]; clearColor?: Vec4; clearDepth?: number }` | `clearColor` is a linear-space RGBA `Vec4`; defaults to `[0, 0, 0, 1]`. `clearDepth` defaults to `1.0`. |
| `RenderToTextureOptions` | `{ texture: GPUTexture; draw: Mesh[]; camera: Camera; depthTexture?: GPUTexture; clearColor?: Vec4; clearDepth?: number }` | `clearColor` is a linear-space RGBA `Vec4`. Omit `depthTexture` **only if every drawn material has depth disabled** (`material.create` with `depth: false`, or a built-in factory with `depthEnabled: false`); a depth/format mismatch (or a color format ≠ `ctx.format`, or depth format ≠ `depth24plus`) throws `FurnaceGpuError`. |

### Demoed in cookbook

- `loop`, `render`, `RenderOptions` → `cookbook/camera`.
- `loop`, `fixedClock`, `FrameInfo` → `cookbook/animation` (variable dt vs fixed-step + interpolation).
- `renderToTexture`, `RenderToTextureOptions` → `cookbook/render-target`.
- `render({ effects })` → `cookbook/post`.

### Reference-only (no demo, by design)

- `encode` — escape hatch for consumers who need to author their own passes (e.g. compute, custom multi-pass setups). Cookbook demos use `render` / `renderToTexture` exclusively.

---

## `@furnace/core/transform`

`import { vec3, vec4, quat, mat4 } from "@furnace/core/transform";`
(types: `import type { Vec2, Vec3, Vec4, Quat, Mat3, Mat4 } from "@furnace/core/transform";`)

### Public

| Export | Signature | Notes |
|---|---|---|
| `vec3` | namespace `{ create, fromValues, set, copy, add, sub, scale, lerp, dot, cross, length, normalize, transformMat4 }` | `Vec3` = `Float32Array` of length 3. All ops follow the gl-matrix `(out, ...args) => out` convention. `lerp(out, a, b, t)` is component-wise linear interpolation — use `quat.slerp` for rotations. |
| `vec4` | namespace `{ create, fromValues, set, copy }` | `Vec4` = `Float32Array` of length 4. Minimal surface — extend as needed. |
| `quat` | namespace `{ create, fromValues, identity, copy, fromEuler, fromAxisAngle, multiply, normalize, conjugate, slerp }` | `Quat` = `Float32Array` of length 4, `(x, y, z, w)`. `create()` returns identity. |
| `mat4` | namespace `{ create, identity, copy, multiply, translate, scale, rotate, invert, transpose, perspective, ortho, lookAt, fromQuat, fromRotationTranslationScale }` | `Mat4` = `Float32Array` of length 16, column-major (matches WebGPU). `invert` returns `Mat4 \| null` (singular). `perspective` accepts `far = Infinity`. |
| `Vec2` | `Float32Array` (length 2) | Type alias. Reserved; not currently produced by any engine function. |
| `Vec3` | `Float32Array` (length 3) | Type alias. |
| `Vec4` | `Float32Array` (length 4) | Type alias. |
| `Quat` | `Float32Array` (length 4) — `(x, y, z, w)` | Type alias. |
| `Mat3` | `Float32Array` (length 9) | Type alias. Reserved; not currently produced by any engine function. |
| `Mat4` | `Float32Array` (length 16), column-major | Type alias. |

### Demoed in cookbook

- `quat.create`, `quat.fromEuler` → `cookbook/animation`.

### Reference-only (no demo, by design)

The rest of the module is a math utility surface used implicitly by every demo (camera placement, mesh TRS) via `camera.setPosition`, `mesh.setRotation`, etc. — there is no standalone "transform" demo because there is nothing visual to show on its own.

---

## `@furnace/core/events`

`import { createEmitter, type Emitter } from "@furnace/core/events";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `createEmitter` | `<T = void>(ctx?: Context, name?: string) => Emitter<T>` | Building block. When `ctx` + non-empty `name` are passed, each `emit` increments `events.perEmitter[name]` in stats. Snapshot-iteration semantics: adds during emit fire next round; removes during emit take effect this round. Subscriber throws are caught and routed via `@furnace/core/log` at `error` level; iteration continues. |
| `Emitter` | `Readonly<{ on(listener: (data: T) => void): () => void; emit(data: T): void; clear(): void; readonly listenerCount: number }>` | The type returned by `createEmitter`. `on` returns an unsubscribe function. |

### Demoed in cookbook

Used indirectly by every input/resize-driven demo (`gpu.onResize`, `input.onKeyDown`, etc., all return `Emitter`-style unsubscribers). No dedicated demo.

### Reference-only (no demo, by design)

`createEmitter` is a building block. Consumers rarely call it directly; they consume emitters surfaced by other modules. A dedicated demo would essentially show "click a button, see a counter go up" — not engine behaviour.

---

## `@furnace/core/stats`

`import * as stats from "@furnace/core/stats";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `snapshot` | `(ctx: Context) => Snapshot` | Returns a frozen snapshot of the current frame's stats. Returns the zero-snapshot if `ctx` is disposed. |
| `onFrame` | `(ctx: Context, fn: (s: Snapshot) => void) => () => void` | Subscribes to per-frame stats. Fired from `_frameEnd`. Throws if `ctx` is disposed. Returns unsubscribe. |
| `markFrameBoundary` | `(ctx: Context) => void` | **Escape hatch.** Manual frame boundary for consumers not using `frame.loop`. Calls `_frameEnd` then `_frameStart`. No-op if disposed. |
| `recordDraw` | `(ctx: Context, info: { triangles: number }) => void` | Public wrapper over `_recordDraw`. Use when issuing your own draw calls outside `frame.render`. |
| `gauge` | `(ctx: Context, name: string, value: number) => void` | Sets a custom gauge (last-write-wins). Silently no-ops on disposed ctx, non-finite `value`, empty `name`, or cross-kind name collision (warns to console). |
| `increment` | `(ctx: Context, name: string, by?: number) => void` | Increments a custom counter. Monotonic — negative `by` is rejected (warns). Default `by = 1`. |
| `get` | `<P extends Path<Snapshot>>(ctx: Context, path: P) => PathValue<Snapshot, P> \| null` | Dotted-path lookup into a fresh snapshot. Returns `null` for unresolved paths or disposed ctx. Path is statically constrained to valid `Snapshot` keys. |
| `measure` | `(ctx: Context, name: string, fn: () => void) => void` | Times `fn()` and stores `performance.now()` delta under `name`. `fn` is run even on errors (finally block). `fn` is intentionally **not** invoked on disposed ctx, invalid `name` (empty / non-string — warns), or cross-kind name collision with a gauge/counter (warns). |
| `startMeasurement` | `(ctx: Context, name: string) => Measurement` | Returns `{ end }` for async/manual measurements. Calling `end` twice warns and no-ops. Returns a no-op `Measurement` on disposed ctx or invalid name. |
| `Snapshot` | see `snapshot-types.ts` | Frozen `{ frame, gpu, resources, events, memory, custom }`. `resources` contains `{ meshes, materials, geometries, effects, shaders, bindings, physicsWorlds, physicsBodies }` — live counts per pool kind. `frame.ms` includes `{ last, mean, p99, min, max }`. `gpu.renderMs` / `gpu.computeMs` are currently `null` (reserved). `gpu.uncapturedErrors` is a cumulative count. `gpu.deviceLost` is `true` after `device.lost` resolves on a non-disposed context (terminal — see below). |
| `snap.gpu.deviceLost` | `boolean` | `true` after `device.lost` resolves on a non-disposed context. `false` on `ZERO_SNAPSHOT` and on a disposed-context snapshot. Terminal — device is non-recoverable; consumer should request a fresh context or surface the failure. |
| `Path<T>` | template-literal type | Union of all valid dotted paths into `T`. |
| `PathValue<T, P>` | recursive lookup type | Resolves the value type at path `P`. |
| `Measurement` | `Readonly<{ end: () => void }>` | Returned by `startMeasurement`. |

### Internal (`_*`) — not for consumers

Re-exported from `index.ts` so other core modules can `import * as stats` and call hooks consistently. **Not** part of the consumer-facing API.

| Export | Used by |
|---|---|
| `_frameStart` | `frame/loop.ts` (begins frame instrumentation) |
| `_frameEnd` | `frame/loop.ts` (closes frame, fires `onFrame` subscribers) |
| `_recordDraw` | `frame/render.ts`, `frame/render-to-texture.ts`; public wrapper is `recordDraw` |
| `_recordPipelineSwitch` | `frame/render.ts`, `frame/render-to-texture.ts` |
| `_recordBindGroupSwitch` | `frame/render.ts`, `frame/render-to-texture.ts` |
| `_recordEmission` | `events/emitter.ts` (per-emitter counter) |
| `_recordUncapturedError` | `gpu/context.ts` (device `uncapturederror` handler) |
| `_recordAlloc` | Three categories of writer, all using the signature `(ctx, kind, bytes) => void`: (1) **slot-kind count records** — `resources/internal.ts` per-kind alloc wrappers (`_allocMesh` / `_allocMaterial` / `_allocGeometry` / `_allocEffect` / `_allocShader` / `_allocBinding`) fire `(ctx, kind, 0)` to bump slot counts. (2) **slot-owned bytes** — resource modules that allocate GPU buffers owned by a slot: `mesh/mesh.ts` (object uniform), `geometry/geometry.ts` (vertex + optional index buffers), `binding/binding.ts` (uniform buffer — including the colour buffer behind an unlit material). (3) **ctx-owned bytes** — engine-internal resources that don't flow through a pool slot: `frame/render.ts` (depth texture + per-camera uniform buffer), `post/intermediate.ts` (post color targets). |
| `_recordDestroy` | Symmetric to `_recordAlloc` across the same three categories: (1) slot-kind count decrements from `resources/internal.ts` destroy paths (`_destroyMesh` / `_destroyMaterial` / `_destroyGeometry` / `_destroyEffect` / `_destroyShader` / `_destroyBinding` / `_destroyByKind`). (2) slot-owned bytes from the resource module's teardown: `mesh/mesh.ts` (object uniform), `geometry/geometry.ts` (vertex + index buffers), `material/material.ts` (iterates `ownedBufferBytes`), `binding/binding.ts` (`_teardown` decrements the buffer bytes). (3) ctx-owned bytes from `frame/render.ts` and `post/intermediate.ts`. Signature: `(ctx, kind, bytes) => void`. |

### Demoed in cookbook

- `onFrame`, `gauge`, `increment`, `measure`, `Snapshot.custom` → `cookbook/custom-stats`.
- `snapshot` (via the always-on stats overlay) → every demo.

### Reference-only (no demo, by design)

- `markFrameBoundary` — for consumers not using `frame.loop`; every cookbook demo goes through `frame.loop` (via `mountDemo`).
- `recordDraw` — escape hatch for custom passes; cookbook demos go through `frame.render` / `frame.renderToTexture`.
- `get` — the typed dotted-path lookup; the cookbook's overlay and custom-stats demo both consume snapshots wholesale via `onFrame`, so the path-walking surface is not exercised. Covered by the unit tests in `packages/core/src/stats/`.
- `startMeasurement` — async/manual measurement variant. The custom-stats demo's heavy loop is synchronous and uses `measure` directly; an async demo would justify a `startMeasurement` example.

---

## `@furnace/core/camera`

`import * as camera from "@furnace/core/camera";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `perspective` | `(opts?: PerspectiveOptions) => Camera` | Defaults: `fovYRad = π/4`, `aspect = 1`, `near = 0.1`, `far = 1000`, `position = [0,0,3]`, `target = [0,0,0]`, `up = [0,1,0]`. Throws `FurnaceError` on invalid params. |
| `orthographic` | `(opts?: OrthographicOptions) => Camera` | Defaults: `fitPolicy = policy.stretch({ left: -1, right: 1, bottom: -1, top: 1 })`, `scale = 1`, `near = -1`, `far = 1`, `position = [0,0,1]`. Throws on non-finite `near`/`far`, `near ≥ far`, non-positive/non-finite `scale`, or policy-factory validation failure (propagated). |
| `bindToCanvas` | `(ctx: Context, cam: Camera) => () => void` | Subscribes to `gpu.onResize` and updates the camera's projection on every resize. Applies once immediately on call with `ctx.canvas.{width,height}`. For perspective, updates aspect. For orthographic, derives bounds per the camera's `fitPolicy` + `scale` + canvas dimensions. Returns an idempotent unsubscribe function — `gpu.dispose(ctx)` auto-disconnects per-context, so the unsub is only needed for early/manual unsubscribe (e.g. swapping cameras without disposing the context). |
| `updateForSize` | `(cam: Camera, size: { width: number; height: number }) => void` | Polymorphic projection update from a canvas size. Perspective: recomputes `aspect = width / height`. Orthographic: derives bounds via the camera's `fitPolicy` + `scale`. Both branches update `cam._lastSize` and flip `projDirty`. Throws on non-finite or non-positive width/height. |
| `setPosition` | `(cam: Camera, position: Vec3) => void` | Mutates in place, flips `viewDirty`. |
| `setTarget` | `(cam: Camera, target: Vec3) => void` | Mutates in place, flips `viewDirty`. |
| `setUp` | `(cam: Camera, up: Vec3) => void` | Mutates in place, flips `viewDirty`. |
| `getPosition` | `(out: Vec3, cam: Camera) => Vec3` | Reads the camera position into `out` (out-param, out-first). Hot-path read. |
| `getTarget` | `(out: Vec3, cam: Camera) => Vec3` | Reads the look-at target into `out`. Hot-path read. |
| `getUp` | `(out: Vec3, cam: Camera) => Vec3` | Reads the up vector into `out`. Hot-path read. |
| `setAspect` | `(cam: Camera, aspect: number) => void` | Perspective-only. Sets `projection.aspect`, flips `projDirty`. Throws if `aspect` is non-finite or non-positive, or if `cam` is orthographic (orthographic cameras use `setFitPolicy`). |
| `setNearFar` | `(cam: Camera, near: number, far: number) => void` | Throws if `near ≥ far`, or if perspective and `near ≤ 0`. |
| `setFov` | `(cam: Camera, fovYRad: number) => void` | Perspective-only — throws on orthographic. |
| `setFitPolicy` | `(cam: Camera, p: FitPolicy) => void` | Update the orthographic camera's fit policy. Re-derives bounds immediately using the camera's last-seen canvas size. Throws if `cam` is null/not orthographic, or `p` is null. Policy itself is not re-validated — construct via the `policy.*` factories to guarantee well-formed inputs. |
| `setScale` | `(cam: Camera, scale: number) => void` | Update the orthographic camera's scale (uniform zoom multiplier). Re-derives bounds immediately using the last-seen canvas size. Throws if `cam` is null/not orthographic, or `scale` is non-finite/non-positive. |
| `getBounds` | `(cam: Camera) => Readonly<OrthographicBounds>` | Return the orthographic camera's current derived bounds as a frozen object. Throws if `cam` is null/not orthographic. To freeze the current derived bounds into a literal policy, pass the return value to `policy.stretch` and call `setFitPolicy`. |
| `policy.stretch` | `(bounds: OrthographicBounds) => FitPolicy` | Construct a stretch policy from literal bounds. Validates bounds are finite and ordered (`left < right`, `bottom < top`). |
| `policy.preserveHeight` | `(height: number, anchor?: Anchor) => FitPolicy` | Construct a preserve-height policy. Anchor defaults to `{ x: 0.5, y: 0.5 }`. Validates `height` is positive and finite, anchor components are finite and in `[0, 1]`. |
| `policy.preserveWidth` | `(width: number, anchor?: Anchor) => FitPolicy` | Construct a preserve-width policy. Mirror of `preserveHeight`. Same validation. |
| `getMatrices` | `(cam: Camera) => CameraMatrices` | Recomputes only dirty matrices. Returns the same frozen `{ view, projection, viewProjection }` wrapper across calls (inner `Float32Array`s are stable; mutated in place). |
| `projectToScreen` | `(out: ScreenProjection, cam: Camera, worldPoint: Vec3, viewportWidth: number, viewportHeight: number) => boolean` | Projects a world-space point to canvas-relative screen pixels. Returns `true` if in front of camera, `false` if behind (out left untouched). Viewport dimensions are CSS pixels — pass `canvas.clientWidth`/`canvas.clientHeight`. Out-param pattern matches `transform.*` math helpers. Mutates `out` with `{ x, y, w }` where `x`/`y` are CSS pixels (top-left origin) and `w` is the clip-space divisor. |
| `PerspectiveOptions` | `{ fovYRad?; aspect?; near?; far?; position?; target?; up? }` | See defaults above. |
| `OrthographicOptions` | `{ fitPolicy?; scale?; near?; far?; position?; target?; up? }` | See defaults above. `fitPolicy` defaults to a `stretch` policy with unit bounds; `scale` defaults to 1. |
| `OrthographicBounds` | `{ left: number; right: number; bottom: number; top: number }` | Shape returned by `getBounds` and accepted by `policy.stretch`. Use this type when composing helpers that receive or forward bounds. |
| `FitPolicy` | discriminated union — `{ kind: "stretch"; bounds: OrthographicBounds } \| { kind: "preserve-height"; height: number; anchor: Anchor } \| { kind: "preserve-width"; width: number; anchor: Anchor }` | Orthographic fit policy variants. Construct via the `policy` factory namespace (validated) or write the literal directly (unvalidated). |
| `Anchor` | `{ x: number; y: number }` | Components in `[0, 1]`. Anchor for derived-bounds policies. `(0.5, 0.5)` = world origin centered in the visible rect (default). Y-up. |
| `Camera` | mutable data record (position, target, up, projection union, cached matrices, dirty flags) | See `camera/types.ts`. A **value-type** (mutable data record), not a handle. Mutate via the camera setters; read via the getters / `getMatrices`. Owns no GPU resources. |
| `CameraMatrices` | `Readonly<{ view: Mat4; projection: Mat4; viewProjection: Mat4 }>` | The wrapper returned by `getMatrices`. |
| `ScreenProjection` | `{ x: number; y: number; w: number }` | Out-param for `projectToScreen`. `x`/`y` are CSS pixels (origin top-left), `w` is clip-space divisor (useful for distance-based label sizing). |

### Demoed in cookbook

- `perspective`, `orthographic`, `setPosition`, `setTarget`, `setFov`, `setNearFar`, `setAspect`, `setFitPolicy`, `setScale`, `getBounds`, `policy.preserveHeight / preserveWidth / stretch`, `bindToCanvas` → `cookbook/camera`.
- `projectToScreen` → `cookbook/animation` (floating labels above three cubes).

### Reference-only (no demo, by design)

- `getMatrices` — `frame.render` calls it internally per draw; consumers rarely call it themselves outside of custom render paths.
- `getPosition`, `getTarget`, `getUp` — low-level pose reads (out-param, out-first); most consumers hold their own pose vectors and rarely read them back off the camera.

---

## `@furnace/core/shader`

`import * as shader from "@furnace/core/shader";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, wgsl: string, opts?: ShaderCreateOpts<L>) => Promise<Shader<L>>` | Compile a `Shader` from WGSL source. Pass `opts.layout` to declare the shader's `@group(1)` uniform-buffer schema; the layout is resolved at compile time and stored on the handle (readable via `_layoutOf`). `opts.addressSpace` defaults to `"uniform"`. Omit `opts` entirely for shaders with no `@group(1)` binding; existing 2-arg calls are unaffected. Validates via `pushErrorScope("validation")` AND `getCompilationInfo` (belt-and-braces across runtimes). Setup-loud: throws `FurnaceError` if `wgsl` is empty; throws `FurnaceError` if WGSL compilation fails; throws `FurnaceError` if `opts.layout` uses an unsupported token or unimplemented address space. |
| `load` | `(ctx: Context, url: string, opts?: ShaderCreateOpts<L>) => Promise<Shader<L>>` | Fetch WGSL from `url` and compile it. Accepts the same `opts` as `create`. Does **not** resolve `// @include` directives (deferred — see `shader-preprocessor.md`) and does **not** cache by URL (the browser HTTP-caches the bytes; reuse the returned handle to deduplicate). Setup-loud: throws `FurnaceError` on a non-OK HTTP response; throws `FurnaceError` if the fetched WGSL fails to compile. |
| `unlit` | `(ctx: Context) => Promise<Shader<{ color: "vec4f" }>>` | The engine's stock unlit shader (reads a `vec4<f32>` colour at `@group(1) @binding(0)`). Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Pass to `material.create` (pair with a `binding` carrying `{ color }`). Carries a by-construction `@group(1)` layout: `{ color: "vec4f" }` (16 bytes, uniform); readable via `_layoutOf`. |
| `normalColor` | `(ctx: Context) => Promise<Shader<Record<string, never>>>` | The engine's stock normal-debug shader (world-space normal → RGB; declares no `@group(1)` bindings). Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Pass to `material.create`. `_layoutOf` returns `null`. |
| `destroy` | `(ctx: Context, shader: Shader) => void` | Drop the engine's reference to the `GPUShaderModule` (GC reclaims it; no GPU-timeline free). Pipelines already built from it are unaffected (WebGPU captures the module at creation). No-op on engine-owned built-in shaders (`shader.unlit`/`shader.normalColor`; `destroy` silently skips them). Idempotent on stale or destroyed handles. |
| `Shader<L>` | Opaque branded uint48 handle (alias of `ShaderHandle`) carrying phantom `L` | Returned by `create` / `load` / `unlit` / `normalColor`. `L` records the declared `@group(1)` layout schema at compile time; defaults to `LayoutSchema` (wide) when no `opts.layout` is provided. Pass to `material.create` via `MaterialDescriptor.shader`; dispose via `shader.destroy(ctx, s)`. |
| `ShaderCreateOpts<L>` | `{ layout?: L; addressSpace?: AddressSpace }` | Optional third argument to `create`/`load`. `layout` is a `LayoutSchema` (field name → WGSL token). `addressSpace` defaults to `"uniform"`. |
| `LayoutSchema` | `Record<string, Token>` | Consumer-declared uniform-buffer schema: field name → WGSL token, in declaration order. |
| `AddressSpace` | `"uniform" \| "storage-read" \| "storage-readwrite"` | Address space of the layout buffer. Only `"uniform"` is implemented; storage variants throw until the compute tranche. |
| `ResolvedLayout` | `{ fields: Record<string, ResolvedField>; byteSize: number; addressSpace: AddressSpace }` | Output of the layout calculator: per-field byte offsets + total buffer byte size. |

### Internal (`_*`) — not for consumers

Re-exported from `index.ts` so the binding subsystem (Task 3+) can `import * as shader` and call the accessor without reaching into the module's internal files.

| Export | Used by |
|---|---|
| `_layoutOf` | `(ctx: Context, shader: Shader) => ResolvedLayout \| null` — reads the resolved `@group(1)` layout stored on a shader slot. Used by the binding subsystem to validate a `Binding` against its paired shader's declared schema. Returns `null` if no layout was declared at compile time. |

### Demoed in cookbook

- `create`, `load`, `Shader`, `MaterialDescriptor (shader/bindings)` → `cookbook/shader`.
- `unlit`, `normalColor` (engine-owned built-ins) → demoed via `material.create` across the cookbook (e.g. `cookbook/camera`, `cookbook/geometry`, `cookbook/render-target`).

---

## `@furnace/core/binding`

`import * as binding from "@furnace/core/binding";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, shader: Shader<L>) => Binding<L>` | Create a `Binding` from a compiled `Shader`. Reads the `@group(1)` layout stored on the shader slot (via `_layoutOf`) and allocates a `GPUBuffer` + CPU scratch. **Synchronous**. Setup-loud: throws `FurnaceError` if the shader declares no layout (`_layoutOf` returns `null`) or the layout has no fields. |
| `create` | `(ctx: Context, opts: { layout: L; addressSpace?: AddressSpace }) => Binding<L>` | Create a `Binding` without a paired shader. Calls `computeLayout` on the provided schema. **Synchronous**. Setup-loud: throws `FurnaceError` on an unsupported token, unimplemented address space, or empty schema. |
| `destroy` | `(ctx: Context, b: Binding) => void` | Free the binding's `GPUBuffer` and CPU scratch. Stats decrements for both the binding slot count and the buffer bytes are fired via `_teardown`. Idempotent on stale or already-destroyed handles. |
| `set` | `(ctx: Context, b: Binding<L>, values: Partial<Values<L>>) => void` | Batch-write multiple fields from a partial values object into the binding's CPU scratch buffer and mark it dirty for the next render flush. **Lazy** — no GPU write occurs until `frame.render` (or a future compute dispatch) calls `_flushDirtyBindings`. **Runtime-quiet**: silent no-op on a stale or destroyed binding. |
| `setUniform` | `(ctx: Context, b: Binding<L>, name: keyof L, value: Values<L>[K]) => void` | Write a single named field. **Zero-alloc** hot path — no transient object created; value written directly into the cached typed-array view at the pre-computed byte offset. Field name is `keyof L` at compile time (unknown names warn+skip defensively at runtime). **Lazy** and **runtime-quiet** — same semantics as `set`. |
| `Binding<L>` | Opaque branded uint48 handle (alias of `BindingHandle`) carrying phantom `L` | Returned by `create`. `L` records the declared `@group(1)` layout schema at compile time. Managed pool kind — owns a `GPUBuffer` (stats `memory.bufferBytes`) and a CPU scratch buffer; freed explicitly via `binding.destroy` or by the dispose cascade. No refcount. |
| `LayoutSchema` | `Record<string, Token>` | Re-exported for consumers declaring schemas without importing from `@furnace/core/shader`. |
| `AddressSpace` | `"uniform" \| "storage-read" \| "storage-readwrite"` | Re-exported. Only `"uniform"` is implemented; storage variants throw until the compute tranche. |
| `ResolvedLayout` | `{ fields: Record<string, ResolvedField>; byteSize: number; addressSpace: AddressSpace }` | Re-exported. Output of the layout calculator. |
| `Token` | `"f32" \| "i32" \| "u32" \| "vec2f" \| "vec3f" \| "vec4f" \| "mat2x2f" \| "mat3x3f" \| "mat4x4f"` | Re-exported. WGSL scalar/vector/matrix tokens the layout calculator understands. |

### Demoed in cookbook

(none yet — cookbook demo deferred until the material-binding integration lands in Task 5+.)

---

## `@furnace/core/material`

`import * as material from "@furnace/core/material";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `<L>(ctx: Context, descriptor: MaterialDescriptor<L>) => Promise<Material<L>>` | Builds (or reuses, via the per-ctx internal pipeline cache) a render pipeline keyed on the shader handle, entry points, resolved render state (`primitive` + `depth`), ctx format, and blend signature. Two `create` calls with identical keys share one underlying `GPURenderPipeline`. When `descriptor.binding` is supplied, builds the `@group(1)` `GPUBindGroup` over the binding's `GPUBuffer` (entry `[{ binding: 0, resource: { buffer } }]`); the binding OWNS the buffer — material does not free it on destroy. When `descriptor.bindings` (raw) is supplied instead, the existing raw-binding path applies. Setup-loud: throws `FurnaceError` if `descriptor.shader` is missing; throws `FurnaceError` if the shader handle is invalid or destroyed; throws `FurnaceError` if the shader declares a `@group(1)` layout but neither `binding` nor a non-empty `bindings` is supplied (completeness check); throws `FurnaceError` if WebGPU pipeline creation reports a validation error; throws `FurnaceError` if `bindings` are supplied but the shader declares no `@group(1)` bindings (layout mismatch). |
| `destroy` | `(ctx: Context, material: Material) => void` | If a Mesh still references the material, defers GPU teardown; otherwise destroys factory-owned buffers (iterating `ownedBufferBytes`, recording each byte release in stats) and releases the cached pipeline ref. Silent on stale handles. |
| `createPipeline` | `(ctx: Context, descriptor: GPURenderPipelineDescriptor) => Promise<GPURenderPipeline>` | Escape hatch: wraps `device.createRenderPipeline` in a validation error scope. Returns the raw pipeline; the caller owns it (not cached). |
| `blend` | `{ straightAlpha: GPUBlendState; premultiplied: GPUBlendState; additive: GPUBlendState }` | Frozen sugar-helper namespace (api-posture.md R6). All three values are frozen `GPUBlendState` objects; pass directly to `MaterialDescriptor.blend`. |
| `blend.straightAlpha` | `GPUBlendState` constant — color: `src=src-alpha, dst=one-minus-src-alpha, op=add`; alpha: `src=one, dst=one-minus-src-alpha, op=add` | Non-premultiplied alpha blending — the "naive" alpha-blend most beginners reach for. Compare with `blend.premultiplied` to see why production engines pre-multiply: PMA composes correctly under chained translucent overlays; straight alpha accumulates α-multiplication error visible at the seams. |
| `blend.premultiplied` | `GPUBlendState` constant — `src=one, dst=one-minus-src-alpha, op=add` for both color and alpha | Premultiplied-alpha compositing; the production default. Shader must output `vec4(rgb * a, a)`. |
| `blend.additive` | `GPUBlendState` constant — `src=one, dst=one, op=add` for both color and alpha | Additive blending; contributions sum rather than occlude. Useful for particles, glow passes, light accumulation. |
| `MaterialDescriptor<L>` | `{ shader: Shader<L>; binding?: Binding<L>; entryPoints?: { vertex?: string; fragment?: string }; bindings?: GPUBindGroupEntry[]; primitive?: { topology?: GPUPrimitiveTopology; cullMode?: GPUCullMode }; depth?: false \| { write?: boolean; compare?: GPUCompareFunction }; blend?: GPUBlendState }` | `shader` required. `binding` — typed `@group(1)` data path; required when the shader declares a layout (unless `bindings` is supplied). The raw `bindings` path is retained for textures, samplers, and advanced use-cases. `entryPoints` defaults to `vs_main`/`fs_main` and is overridable. `primitive.topology` defaults to `"triangle-list"`, `cullMode` to `"back"`. `depth` omitted → depth test + write enabled (`write: true`, `compare: "less"`); `depth: false` → no depth-stencil block; `depth: { write?, compare? }` → enabled with overrides. `blend` undefined → opaque. |
| `Material<L>` | Opaque branded uint48 handle (alias of `MaterialHandle`) carrying phantom `L` | Returned by `create`. `L` records the binding layout schema; defaults to `LayoutSchema` (wide) when no typed binding is supplied. Pass to `mesh.create` and `frame.render`; dispose via `material.destroy(ctx, m)`. |

### Demoed in cookbook

- `create` (+ `shader.unlit` + `binding`, `shader.normalColor`), `destroy` → `cookbook/camera`.
- `create` (+ `shader.normalColor`, `primitive` topology/cullMode) → `cookbook/geometry`.
- `create`, `MaterialDescriptor (shader/bindings)` → `cookbook/shader` (also demos `shader.load`).
- `create` (+ `shader.unlit` + `binding`), `primitive.cullMode`, `depth.write`/`depth.compare`, `blend.straightAlpha`, `blend.premultiplied`, `blend.additive` → `cookbook/blend`.
- `depth: false` (via `material.create` + `shader.unlit`/`shader.normalColor`) → `cookbook/render-target`.

### Reference-only (no demo, by design)

- `createPipeline` — escape hatch for consumers writing their own render system; cookbook demos use `material.create` (with caching + resource tracking) instead.

---

## `@furnace/core/geometry`

`import * as geometry from "@furnace/core/geometry";`

See `engine-conventions.md` §Resource ownership for the lifecycle contract that governs geometry handles and the meshes that reference them.

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, data: GeometryData) => Geometry` | Builds a vertex buffer (interleaved `[pos.xyz, normal.xyz, uv.uv]`, 32-byte stride) and optional index buffer from raw arrays. Validates the data. Throws `FurnaceError` if `positions.length` is not a multiple of 3, if `normals.length` does not equal `positions.length`, or if `uvs.length` does not equal `(positions.length / 3) * 2`. |
| `destroy` | `(ctx: Context, geometry: Geometry) => void` | If a Mesh still references the geometry, defers GPU teardown; otherwise destroys vertex and index buffers, recording their byte release in stats. Silent on stale handles. |
| `cube` | `(ctx: Context, opts?: { size?: number }) => Geometry` | Builds a fresh axis-aligned cube Geometry (six faces, CCW winding, per-face normals, per-face UVs in `[0,1]`). `size` is the full edge length; default `1`. Pass to `mesh.create` to bind. Throws `FurnaceError` if `size` ≤ 0 or non-finite. |
| `plane` | `(ctx: Context, opts?: { size?: number }) => Geometry` | Builds a fresh `+Z`-facing unit plane Geometry (single quad, two triangles, normals along `+Z`, UVs in `[0,1]`). `size` is the full edge length; default `1`. Pass to `mesh.create` to bind. Throws `FurnaceError` if `size` ≤ 0 or non-finite. |
| `sphere` | `(ctx: Context, opts?: { radius?: number }) => Geometry` | Builds a fresh UV (lat/long) sphere Geometry centred at origin (outward unit normals, UVs in `[0,1]`, fixed tessellation). `radius` defaults `0.5`. Throws `FurnaceError` if `radius` ≤ 0 or non-finite. Pass to `mesh.create`. |
| `cylinder` | `(ctx: Context, opts?: { radius?: number; height?: number }) => Geometry` | Builds a fresh Y-axis cylinder Geometry centred at origin, capped both ends (outward unit normals, fixed radial tessellation). `radius` defaults `0.5`, `height` `1`. Throws `FurnaceError` if `radius`/`height` ≤ 0 or non-finite. Pass to `mesh.create`. |
| `Geometry` | Opaque branded uint48 handle (alias of `GeometryHandle`) | Returned by `geometry.create` / `geometry.cube` / `geometry.plane` / `geometry.sphere` / `geometry.cylinder`. Pass to `mesh.create` (may be shared across meshes); dispose via `geometry.destroy(ctx, g)`. |
| `GeometryData` | `{ positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices?: Uint16Array \| Uint32Array }` | Raw arrays fed to `geometry.create`. Vertex count `N` is derived from `positions.length / 3`; `normals` and `uvs` must match. |

### Demoed in cookbook

- `create`, `destroy`, `GeometryData`, `Geometry` → `cookbook/geometry`.
- `cube` → `cookbook/camera`, `cookbook/geometry`, `cookbook/primitives`.
- `plane` → `cookbook/geometry`, `cookbook/primitives`.
- `sphere` → `cookbook/primitives`.
- `cylinder` → `cookbook/primitives`.

---

## `@furnace/core/mesh`

`import * as mesh from "@furnace/core/mesh";`

See `engine-conventions.md` §Resource ownership for the lifecycle contract that governs `mesh.create` / `mesh.destroy` and the geometry/material handles they bind.

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, opts: { geometry: Geometry; material: Material }) => Mesh` | Allocates the per-mesh object-uniform buffer (64 bytes for `model`). Position `[0,0,0]`, identity rotation, scale `[1,1,1]`. Increments the refcounts on the bound geometry and material. |
| `destroy` | `(ctx: Context, mesh: Mesh) => void` | Destroys the object buffer (recording its byte release in stats) and decrements the bound geometry/material refcounts. If either was marked-destroyed and its refcount hits zero, its GPU teardown runs as part of this call. Silent on stale handles. |
| `setPosition` | `(ctx: Context, mesh: Mesh, position: Vec3) => void` | Flips `transformDirty`. Silent no-op on stale handles. |
| `setRotation` | `(ctx: Context, mesh: Mesh, rotation: Quat) => void` | Flips `transformDirty`. Silent no-op on stale handles. |
| `setScale` | `(ctx: Context, mesh: Mesh, scale: Vec3) => void` | Flips `transformDirty`. Silent no-op on stale handles. |
| `setMaterial` | `(ctx: Context, mesh: Mesh, newMaterial: Material) => void` | Swap the bound material on a live mesh. Decrements the previous material's refcount (firing deferred GPU teardown if it was marked-destroyed and the count hits zero); increments the new material's. Validate-first: a stale new-material handle throws without touching the previous refcount. Silent no-op on stale mesh handles; no-op when the new material already matches the bound one. |
| `getPosition` | `(ctx: Context, mesh: Mesh, out: Vec3) => Vec3` | Reads the mesh's position into `out` (out-param convention). Returns `out` unchanged on stale handles. |
| `getRotation` | `(ctx: Context, mesh: Mesh, out: Quat) => Quat` | Reads the mesh's rotation quaternion into `out`. Returns `out` unchanged on stale handles. |
| `getScale` | `(ctx: Context, mesh: Mesh, out: Vec3) => Vec3` | Reads the mesh's scale into `out`. Returns `out` unchanged on stale handles. |
| `Mesh` | Opaque branded uint48 handle (alias of `MeshHandle`) | Returned by `mesh.create`. Pass to `frame.render`; mutate the bound pose only via the `setPosition` / `setRotation` / `setScale` setters; swap the bound material via `setMaterial`; dispose via `mesh.destroy(ctx, m)`. |

### Demoed in cookbook

- `create`, `destroy`, `setPosition` → `cookbook/camera`.
- `setRotation`, `setScale` → `cookbook/animation`.
- `setMaterial` → `cookbook/render-target` (picture-in-picture rebuild swaps the monitor mesh's material on off-screen resolution change).

---

## `@furnace/core/input`

`import * as input from "@furnace/core/input";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `attach` | `(canvas: HTMLCanvasElement) => void` | Binds keyboard + lifecycle listeners to `globalThis`, pointer + wheel to `canvas`. Throws `FurnaceInputError` if already attached. |
| `detach` | `() => void` | Removes all DOM listeners and clears runtime state. Emitters survive across detach/attach cycles. No-op when not attached. |
| `isAttached` | `() => boolean` | True between `attach` and `detach`. |
| `isKeyDown` | `(code: KeyCode) => boolean` | Snapshot read of the held-key set. Cleared on window `blur` (stuck-key recovery). |
| `onKeyDown` | `(cb: (e: KeyEvent) => void) => () => void` | Subscribe to keydown events. Returns unsubscribe. |
| `onKeyUp` | `(cb: (e: KeyEvent) => void) => () => void` | Subscribe to keyup events. Returns unsubscribe. |
| `getPointer` | `() => PointerSnapshot` | Frozen `{ x, y, xDevice, yDevice, buttons, overCanvas }`. `*Device` coords honor the canvas's backing-store DPR. |
| `isPointerButtonDown` | `(button: PointerButton) => boolean` | Snapshot read of the buttons bitmask. |
| `onPointerDown` | `(cb: (e: PointerEvent) => void) => () => void` | Subscribe to pointerdown. Returns unsubscribe. |
| `onPointerMove` | `(cb: (e: PointerEvent) => void) => () => void` | Subscribe to pointermove. Returns unsubscribe. |
| `onPointerUp` | `(cb: (e: PointerEvent) => void) => () => void` | Subscribe to pointerup. Returns unsubscribe. |
| `onWheel` | `(cb: (e: WheelEvent) => void) => () => void` | Subscribe to wheel. Returns unsubscribe. |
| `FurnaceInputError` | `class FurnaceInputError extends FurnaceError` | Thrown by `attach` when already attached. |
| `KeyCode` | `string` | Alias — DOM `KeyboardEvent.code` value (e.g. `"KeyW"`, `"ArrowLeft"`). |
| `KeyEvent` | `Readonly<{ code, key, repeat, shift, ctrl, alt, meta, timestampMs }>` | Engine-normalized keyboard event. |
| `PointerButton` | `0 \| 1 \| 2 \| 3 \| 4` | Engine-narrowed DOM `button` value. |
| `PointerType` | `"mouse" \| "pen" \| "touch"` | Engine-narrowed DOM `pointerType`. |
| `PointerEvent` | `Readonly<{ x, y, xDevice, yDevice, button, buttons, pointerType, pointerId, shift, ctrl, alt, meta, timestampMs }>` | Engine-normalized pointer event. `button` is `null` on move events. |
| `WheelEvent` | `Readonly<{ x, y, xDevice, yDevice, deltaX, deltaY, deltaZ, timestampMs }>` | Engine-normalized wheel event. |
| `PointerSnapshot` | `Readonly<{ x, y, xDevice, yDevice, buttons, overCanvas }>` | Returned by `getPointer`. |

### Demoed in cookbook

- `attach`, `detach`, `onPointerDown`, `onPointerMove`, `onPointerUp` → `cookbook/camera`, `cookbook/blend`.
- `isKeyDown`, `onKeyDown`, `onKeyUp`, `onWheel`, `KeyEvent`, `WheelEvent`, `PointerButton` → `cookbook/input`, `cookbook/blend`.

### Reference-only (no demo, by design)

- `FurnaceInputError` — error type; surfaced indirectly by `attach` misuse in code-paths the demo doesn't go down.

---

## `@furnace/core/log`

`import { setSink, consoleSink } from "@furnace/core/log";`
(types: `import type { LogLevel, LogEntry, LogSink } from "@furnace/core/log";`)

Formal log sink with a single consumer-replaceable sink. Engine call sites
use internal entry points; consumers configure the sink and (optionally)
restore or compose with the default.

### Public

| Export | Kind | Description |
|---|---|---|
| `setSink(sink \| null)` | function | Replace the current sink. `null` silences the engine (no entry is built and no sink invoked). At module init, `consoleSink` is the active sink. |
| `consoleSink` | constant `LogSink` | Default sink. Formats each entry with `[furnace/<module>]` prefix and routes by level (`error→console.error`, `warn→console.warn`, `info→console.info`, `debug→console.debug`). Exported so consumers can compose or restore explicitly. |
| `LogLevel` | type | `"warn" \| "error" \| "info" \| "debug"`. Engine emits at `warn` and `error`; `info` / `debug` are reserved for future engine verbosity. |
| `LogEntry` | type | `Readonly<{ level: LogLevel; module: string; message: string; rest: readonly unknown[]; timestampMs: number }>`. Delivered to the active sink on every emit. |
| `LogSink` | type | `(entry: LogEntry) => void`. Sinks run synchronously; throws propagate to the caller. |

**Sink composition:**

```ts
import { setSink, consoleSink } from "@furnace/core/log";

// Custom telemetry, console silent:
setSink(entry => myTelemetry.log(entry));

// Both:
setSink(entry => { consoleSink(entry); myTelemetry.log(entry); });

// Silence (e.g. production):
setSink(null);

// Restore default:
setSink(consoleSink);
```

### Demoed in cookbook

No dedicated demo. The log module is exercised indirectly by every demo that
triggers a warn/error path (e.g. double-destroy, bad input). A dedicated
`cookbook/diagnostics` demo is tracked in `docs/backlog/`.

### Reference-only (no demo, by design)

The entire public surface — consumers configure `setSink` at startup and
observe entries in their custom sink; there is no visual output to demo.

See `docs/reference/engine-conventions.md` §Diagnostics for the engine's
internal usage policy (which levels fire from which call sites) and the
module-level mutable-state exception.

---

## `@furnace/core/post`

`import * as post from "@furnace/core/post";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `<L>(ctx: Context, desc: EffectDescriptor<L>) => Promise<Effect<L>>` | Builds (or reuses, via internal per-ctx pipeline cache) a full-screen post-process pipeline keyed on the shader handle + ctx format + blend signature (two effects sharing one `Shader` handle share the pipeline). Consumes the pre-compiled `desc.shader` module; the shared fullscreen vertex shader (`vs_fullscreen`) is auto-supplied. When `desc.binding` (or a non-empty `desc.bindings`) is supplied, builds the `@group(1)` `GPUBindGroup` at create time over the binding's `GPUBuffer`; the binding OWNS the buffer — `post.destroy` does not free it. Setup-loud: throws `FurnaceGpuError` on a disposed ctx; throws `FurnaceError` if `shader` is missing, the shader handle is invalid/destroyed, the shader declares a `@group(1)` layout but neither `binding` nor a non-empty `bindings` is supplied (completeness check), `binding` is invalid/destroyed, `binding`/`bindings` are supplied but the shader declares no `@group(1)` bindings (layout mismatch), or WebGPU pipeline creation reports a validation error. |
| `destroy` | `(ctx: Context, effect: Effect) => void` | Releases the cached pipeline ref. The effect-slot count decrement is handled by the resource manager. Idempotent on stale or already-destroyed handles. Does not touch the consumer-owned `binding`/`bindings` resources. |
| `EffectDescriptor<L>` | `{ shader: Shader<L>; binding?: Binding<L>; bindings?: GPUBindGroupEntry[]; blend?: GPUBlendState }` | `shader` is the compiled `Shader` resource providing the fragment stage (`fs_main` entry). Sampler + scene input are bound at `@group(0)`; consumer params at `@group(1)`. `binding` — typed `@group(1)` data path; required when the shader declares a layout (unless `bindings` is supplied). The raw `bindings` path is retained for textures, samplers, and advanced use-cases. `blend` undefined → opaque. |
| `Effect<L>` | `EffectHandle` (alias) carrying phantom `L` | Opaque branded uint48 handle into the per-ctx effects pool. `L` records the declared `@group(1)` layout schema when created with a typed `Binding`; defaults to `LayoutSchema` (wide). Treated as opaque by consumers — passed to `frame.render` via `RenderOptions.effects`. |

### Demoed in cookbook

- `create`, `destroy`, `Effect`, `EffectDescriptor` → `cookbook/post`.

### Reference-only (no demo, by design)

(none — the entire public surface is exercised by the post demo.)

---

## `@furnace/core/resources`

`import * as resources from "@furnace/core/resources";`

Cross-cutting cleanup over the per-ctx resource pools (meshes, materials, geometries, effects, shaders, bindings), plus the branded handle types and kind discriminator. The per-kind `create` / `destroy` functions live in their owning modules (`mesh.*`, `material.*`, `post.*`, `binding.*`); this module is the cross-kind surface.

Count / memory introspection lives on `stats.snapshot(ctx).resources.*` and `stats.snapshot(ctx).memory.*`.

### Public

| Export | Signature | Notes |
|---|---|---|
| `disposeAll` | `(ctx: Context) => void` | Manually trigger the resource-manager cascade — same teardown that `gpu.dispose` runs internally, but without disposing the `GPUDevice` itself. Used for explicit cleanup before context disposal (e.g. free memory during a level transition without dropping the device). Idempotent. |
| `ResourceKind` | `"mesh" \| "material" \| "geometry" \| "effect" \| "shader" \| "binding" \| "physics-world" \| "physics-body" \| "rigid-mesh"` | Discriminator string for resource kinds. The two `physics-*` kinds back the `@furnace/core/physics` handles (`World` / `Body`); the `rigid-mesh` kind backs the `@furnace/core/rigid-mesh` composite (`RigidMesh`). Each has its own dedicated `physics.destroyWorld` / `physics.destroyBody` / `rigidMesh.destroy` rather than a generic per-kind `destroy`. |
| `MeshHandle` / `MaterialHandle` / `GeometryHandle` / `EffectHandle` / `ShaderHandle` / `BindingHandle` | Branded uint48 handles | Re-exported from `resources/handle.ts` so consumers can type variables (e.g. a `Map<MeshHandle, …>`) without reaching into engine-internal modules. Each is also aliased by its owning module (`mesh.Mesh`, `material.Material`, `shader.Shader`, `binding.Binding`, …) — same underlying type. |
| `AnyResourceHandle` | `MeshHandle \| MaterialHandle \| GeometryHandle \| EffectHandle \| ShaderHandle \| BindingHandle` | Cross-kind union. Useful when storing handles of mixed kinds in a single collection. |

### Demoed in cookbook

(none yet — handle-typing and `disposeAll` are scaffolding surface; cookbook demos focus on Tier 1 gameplay surface.)

### Reference-only (no demo, by design)

- `disposeAll` — explicit cascade trigger; not part of any cookbook demo.

---

## `@furnace/core/physics`

`import * as physics from "@furnace/core/physics";`

CPU-authoritative rigid-body simulation over a Rapier backend (see `docs/reference/adr/0001-physics-two-track-architecture.md`). Dynamic + static bodies with ball, cuboid, and cylinder colliders. Kinematic bodies, capsule colliders, joints, and the body↔mesh binding are deferred. Live `World` / `Body` counts surface on `stats.snapshot(ctx).resources.physicsWorlds` / `.physicsBodies`.

### Public

| Export | Signature | Notes |
|---|---|---|
| `createWorld` | `(ctx: Context, descriptor: WorldDescriptor) => Promise<World>` | `async` — lazily runs Rapier's one-time wasm init (memoized across all worlds), then constructs the backend world + event queue. Setup-loud: throws `FurnaceError` if `gravity` is not a finite 3-component vector. |
| `step` | `(ctx: Context, world: World, dtSeconds: number) => void` | Hot-path Command — sets the backend timestep to `dtSeconds` and advances one step. Runtime-quiet: silent no-op on a stale/destroyed world. Populates the collision-event buffer drained by `drainCollisions`. |
| `drainCollisions` | `(ctx: Context, world: World) => CollisionEvent[]` | Drains begin/end contacts recorded by the most recent `step`. Returns `[]` on a stale world or when nothing collided. Events whose collider does not resolve to a live body (e.g. a body destroyed mid-step) are dropped. |
| `destroyWorld` | `(ctx: Context, world: World) => void` | Tears down every body the world owns (removing each from the still-live backend world), then frees the backend world + its event queue. Idempotent silent no-op on a stale/destroyed handle. |
| `createBody` | `(ctx: Context, world: World, descriptor: BodyDescriptor) => Body` | **Synchronous.** Builds a Rapier rigid body + collider (colliders are created event-enabled). Setup-loud: throws `FurnaceError` if the descriptor is `null`, has an unknown `type`, a non-finite `position`, or an invalid `shape`; also throws if `world` is not a live handle. |
| `destroyBody` | `(ctx: Context, body: Body) => void` | Removes the body from its world's backend simulation and frees its slot. Idempotent silent no-op on a stale/destroyed handle. |
| `getBodyTranslation` | `(ctx: Context, body: Body, out: Vec3) => Vec3` | Hot-path read of world-space translation into the **required** `out` (no per-call alloc); returns `out`. `out` is left unchanged on a stale/destroyed body. |
| `getBodyRotation` | `(ctx: Context, body: Body, out: Quat) => Quat` | Hot-path read of the world-space rotation quaternion into the **required** `out` (no per-call alloc); returns `out`. `out` is left unchanged on a stale/destroyed body. |
| `WorldDescriptor` | `{ gravity: readonly [number, number, number] }` | Gravity vector for the world (e.g. `[0, -9.81, 0]`). |
| `BodyDescriptor` | `{ type: "dynamic" \| "static"; shape: ShapeDescriptor; position: readonly [number, number, number]; rotation?: readonly [number, number, number, number]; linearVelocity?: readonly [number, number, number]; angularVelocity?: readonly [number, number, number]; density?: number; friction?: number; restitution?: number; linearDamping?: number; angularDamping?: number }` | `rotation` is an `[x,y,z,w]` quaternion, defaults to identity. `linearVelocity` defaults to zero and is only meaningful for `dynamic` bodies (static bodies don't integrate velocity). `angularVelocity` is radians/sec about `x,y,z`, defaults to zero, and is likewise `dynamic`-only. `density` defaults to `1` (drives dynamic mass). `friction`, `restitution`, `linearDamping`, `angularDamping` are pass-through rigid-body material scalars: `friction` is the Coulomb coefficient, `restitution` is bounciness in `[0,1]` (`0` = no bounce), `linearDamping`/`angularDamping` are per-second velocity decay. All four are optional and forwarded straight to Rapier (no JS-side physics math). |
| `ShapeDescriptor` | `{ ball: number } \| { cuboid: readonly [number, number, number] } \| { cylinder: { halfHeight: number; radius: number } }` | `ball` = sphere radius; `cuboid` = box half-extents; `cylinder` = Y-axis-aligned half-height + radius (same Y axis as `geometry.cylinder`, whose `height` = `2 × halfHeight`). Backed by Rapier's round-cylinder for solver robustness; the requested `halfHeight`/`radius` are the true outer dimensions. |
| `Vec3Tuple` | `readonly [number, number, number]` | Plain 3-tuple alias used across the descriptor inputs (`position`, `linearVelocity`, `angularVelocity`, `cuboid`). Re-exported for consumers building descriptor literals. |
| `QuatTuple` | `readonly [number, number, number, number]` | Plain `[x,y,z,w]` quaternion-tuple alias for `rotation`. Re-exported for consumers building descriptor literals. |
| `CollisionEvent` | `{ a: Body; b: Body; started: boolean }` | A contact begin (`started: true`) or end (`started: false`) between bodies `a` and `b`. |
| `World` | Opaque branded uint48 handle (alias of `PhysicsWorldHandle`) | Owns the backend world + its bodies + event queue. Dispose via `physics.destroyWorld` or the resource-manager cascade (`gpu.dispose` / `resources.disposeAll`). |
| `Body` | Opaque branded uint48 handle (alias of `PhysicsBodyHandle`) | A rigid body inside a `World`. Dispose via `physics.destroyBody`, by destroying its owning `World`, or by the cascade. |

### Demoed in cookbook

- `createWorld`, `step`, `createBody`, `getBodyTranslation`, `getBodyRotation` (and `WorldDescriptor` / `BodyDescriptor` / `ShapeDescriptor`) → `cookbook/physics`, exercised indirectly through `@furnace/core/rigid-mesh`: the demo's cubes are `rigidMesh` composites whose bodies are stepped each fixed tick and read back for interpolation. (Bodies still don't render on their own — `rigid-mesh` is the renderable binding.)

---

## `@furnace/core/rigid-mesh`

`import * as rigidMesh from "@furnace/core/rigid-mesh";`

The composite that owns **fixed-step interpolation for the physics-renderable case**: a physics `Body` (gameplay truth) drives a render `Mesh` (a derived display output). `create` builds and owns both; `commit` (per fixed tick) snapshots the body pose into prev/curr buffers; `interpolate` (per render frame) lerp/slerps prev→curr into the mesh. It layers over `@furnace/core/physics` + `@furnace/core/mesh` (it imports both; nothing in core imports it). Live count surfaces on `stats.snapshot(ctx).resources.rigidMeshes`.

See `docs/reference/fixed-step-interpolation.md` for the engine posture: `rigid-mesh` realises engine-owned prev/curr + alpha-blend for *this* case; the generic all-meshes version stays consumer-owned.

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, world: World, descriptor: RigidMeshDescriptor) => RigidMesh` | **Synchronous.** Builds (and owns) a `physics.createBody` body from `descriptor.body` + a `mesh.create` mesh from `descriptor.mesh`, then seeds the prev/curr interpolation buffers and the mesh pose to the body's initial pose (so it renders correctly before the first `commit`/`interpolate`). Setup-loud: throws `FurnaceError` if `descriptor`, `descriptor.body`, or `descriptor.mesh` is null/undefined; propagates throws from `physics.createBody` (bad body descriptor / dead world) and `mesh.create` (dead geometry/material). If the body was created but mesh creation fails, the body is torn down before re-throwing (no stranded body). |
| `destroy` | `(ctx: Context, rm: RigidMesh) => void` | Cascades to the owned body + mesh (`physics.destroyBody` then `mesh.destroy`). Idempotent silent no-op on a stale/destroyed handle. |
| `commit` | `(ctx: Context, rm: RigidMesh) => void` | Call once per fixed tick, after `physics.step`: shifts `curr → prev`, then snapshots the body's live pose into `curr`. Hot-path; silent no-op on a stale/destroyed `rm`. |
| `interpolate` | `(ctx: Context, rm: RigidMesh, alpha: number) => void` | Call once per render frame: blends `prev → curr` by `alpha` (`vec3.lerp` for position, `quat.slerp` for rotation) and writes the result to the mesh. Pass `alpha = 1` to pin the mesh to the latest committed tick (no interpolation). Hot-path; silent no-op on a stale/destroyed `rm`. |
| `getBody` | `(ctx: Context, rm: RigidMesh) => Body` | The composite's underlying physics `Body` — for `physics.*` ops (forces, reads). Hot-path read; returns an invalid sentinel handle on a stale `rm` (downstream `physics.*` ops on it no-op). |
| `getMesh` | `(ctx: Context, rm: RigidMesh) => Mesh` | The composite's underlying render `Mesh` — for `mesh.setScale` / `mesh.setMaterial`, or adding to a `frame.render` draw list. Hot-path read; returns an invalid sentinel handle on a stale `rm`. |
| `RigidMeshDescriptor` | `{ body: BodyDescriptor; mesh: { geometry: Geometry; material: Material } }` | Input bundle for `create`: a `physics.BodyDescriptor` (carries the collision shape) plus the render mesh's geometry + material (carries the render shape). The two are independent — collision shape need not equal render shape. |
| `RigidMesh` | Opaque branded uint48 handle (alias of `RigidMeshHandle`) | Returned by `create`. Drive it with `commit` (per fixed tick) + `interpolate` (per render frame); reach the owned body/mesh via `getBody` / `getMesh`; dispose via `rigidMesh.destroy(ctx, rm)` or the resource-manager cascade. |

### Demoed in cookbook

- `create`, `destroy`, `commit`, `interpolate`, `getMesh` (and `RigidMesh` / `RigidMeshDescriptor`) → `cookbook/physics` (cubes drop + spin onto a ground; interpolation on/off exposes the fixed-step stutter; reset re-drops).

---

## Tier 1 surface NOT in the public API

These appear in module source files but are NOT exported, OR are exported with a leading `_` to mark them internal-only:

- Internal `_*` stats hooks (table above in `@furnace/core/stats`).
- Shader's internal `_createShader` (in `shader/shader.ts`, used by `create`, `load`, and the built-in shader factories). The built-in shader factories (`unlit` / `normalColor`) are now public — see the `@furnace/core/shader` Public table above.
- Material's internal `_pipelineCache` (a facade in `material/pipeline.ts` over `acquireMaterialPipeline` / `releaseMaterialPipeline` on the per-ctx `ResourceManager`), `_blendSignature` (in `material/material.ts`), and `_resolveMaterial` (in `material/internal.ts`, used by `frame/render*`). None re-exported from `material/index.ts`.
- Post's internal `_pipelineCache` (a facade in `post/pipeline-cache.ts` over `acquirePostPipeline` / `releasePostPipeline` on the per-ctx `ResourceManager`), `_resolveEffect` (in `post/internal.ts`, used by `frame/render.ts`), `_ensureFullscreenVS` (in `post/fullscreen.ts`), `_effectPipelineHashKey` / `_buildEffectPipelineDescriptor` (in `post/pipeline.ts`), and `_ensureSceneIntermediates` (in `post/intermediate.ts`). None re-exported from `post/index.ts`.
- Frame's internal `_frameRenderInternals` in `frame/render.ts` — a bundle of `{ _ensureDepthTexture, _ensureCameraBuffer, _ensureMeshGroup0 }` consumed by `frame/render-to-texture.ts`. Not re-exported from `frame/index.ts`.
- Mesh's internal `_recomputeModelIfDirty` in `mesh/mesh.ts`, called by `frame/render.ts` and `frame/render-to-texture.ts` per draw. Not re-exported from `mesh/index.ts`.

These are accessed only by other core modules. If consumer code is reaching for one, that is a signal to either (a) export it as a documented public escape hatch or (b) extend the public API to cover the use case.

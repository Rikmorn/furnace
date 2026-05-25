# Furnace Core: Public API Reference

The canonical list of what `@furnace/core` exposes to consumers. The cookbook
(`packages/cookbook`) demos each surface visually; this file documents them
textually with full signatures.

For *behavioural* contracts (coordinate system, color space, DPR, lifecycle,
failure policy, instrumentation), see `engine-conventions.md`.

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
| `dispose` | `(ctx: Context) => void` | Destroys the device, clears bookkeeping. Idempotent. Warns to console if resources are still registered. |
| `isDisposed` | `(ctx: Context) => boolean` | True after `dispose(ctx)`. |
| `getCurrentTextureView` | `(ctx: Context) => GPUTextureView` | Returns a view on the current swapchain texture, with the configured sRGB view format applied. Throws if `ctx` is disposed. Escape hatch — most consumers go through `frame.render`. |
| `onResize` | `(ctx: Context, fn: (event: ResizeEvent) => void) => () => void` | Subscribes to canvas resize events. The engine resizes the backing store on each event. Returns an unsubscribe function. |
| `Context` | `Readonly<{ device: GPUDevice; queue: GPUQueue; format: GPUTextureFormat; canvas: HTMLCanvasElement; pixelRatio: number; _internal: InternalState }>` | The frozen handle every other module takes as its first argument. |
| `RequestContextOptions` | `{ surfaceFormat?: "srgb" \| "linear"; pixelRatio?: "device" \| "css" \| number }` | Defaults: `surfaceFormat: "srgb"`, `pixelRatio: "device"`. |
| `ResizeEvent` | `Readonly<{ cssWidth: number; cssHeight: number; width: number; height: number; pixelRatio: number }>` | `width` / `height` are backing-store dimensions (the engine's "size truth"). |
| `FurnaceError` | `class FurnaceError extends Error` | Re-exported base class. Thrown for engine-domain errors. |
| `FurnaceGpuError` | `class FurnaceGpuError extends FurnaceError` | Thrown for WebGPU-specific failures (no adapter, disposed context, canvas misconfiguration). |

### Demoed in cookbook

- `requestContext`, `onResize`, `Context` → `cookbook/hello-cube`.

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
| `fixedLoop` | `(ctx: Context, opts: FixedLoopOptions) => FrameLoopHandle` | Fix-Your-Timestep accumulator wrapping `loop`. `opts.onTick(dtSeconds)` runs zero-or-more times per RAF; `opts.onFrame({ deltaMs, alpha })` runs once. Spiral-of-death guarded via `maxCatchupTicks` (default 8). |
| `render` | `(ctx: Context, opts: RenderOptions) => void` | One-shot render pass. Allocates a depth texture and per-camera uniform buffer lazily, sets up `group(0)`, iterates `opts.draw`, and (if `opts.effects` non-empty) ping-pongs effects to the swap chain. |
| `renderToTexture` | `(ctx: Context, opts: RenderToTextureOptions) => void` | Like `render`, but the color target is a consumer-supplied `GPUTexture`. No post-effects chain. Depth attachment is optional. |
| `encode` | `(ctx: Context, callback: (encoder: GPUCommandEncoder) => void) => void` | Low-level escape hatch: creates a command encoder, hands it to the callback, finishes and submits. Bypasses scene-pass / camera / mesh bookkeeping. Throws if `ctx` is disposed. |
| `FrameInfo` | `Readonly<{ elapsedMs: number; deltaMs: number }>` | `deltaMs` is capped by `LoopOptions.maxDeltaMs` (default 100). |
| `FixedLoopInfo` | `Readonly<{ deltaMs: number; alpha: number }>` | `alpha = accumulator / fixedDtMs`, in `[0, 1)`. |
| `FrameLoopHandle` | `Readonly<{ stop: () => void; pause: () => void; resume: () => void }>` | Returned by both `loop` and `fixedLoop`. |
| `LoopOptions` | `{ maxDeltaMs?: number; pauseOnHidden?: boolean }` | Defaults: `maxDeltaMs: 100`, `pauseOnHidden: true`. |
| `FixedLoopOptions` | `{ fixedDtMs: number; onTick: (dtSeconds: number) => void; onFrame?: (info: FixedLoopInfo) => void; maxCatchupTicks?: number; maxDeltaMs?: number; pauseOnHidden?: boolean }` | `maxCatchupTicks` default: 8. |
| `RenderOptions` | `{ draw: Mesh[]; camera: Camera; effects?: Effect[]; clearColor?: ClearColor; clearDepth?: number }` | Defaults: `clearColor: [0, 0, 0, 1]`, `clearDepth: 1.0`. |
| `RenderToTextureOptions` | `{ texture: GPUTexture; draw: Mesh[]; camera: Camera; depthTexture?: GPUTexture; clearColor?: ClearColor; clearDepth?: number }` | `depthTexture` is optional — omit to skip depth. |
| `ClearColor` | `[number, number, number, number]` | Linear-space RGBA (the sRGB encoding happens on swap-chain write via the view format). |

### Demoed in cookbook

- `loop`, `render`, `RenderOptions`, `ClearColor` → `cookbook/hello-cube`.
- `loop` (variable dt), `fixedLoop` (mentioned), `FrameInfo` → `cookbook/animation`.

### Reference-only (no demo, by design)

- `encode` — escape hatch for consumers who need to author their own passes (e.g. compute, custom multi-pass setups). Cookbook demos use `render` / `renderToTexture` exclusively.

---

## `@furnace/core/transform`

`import { vec3, vec4, quat, mat4 } from "@furnace/core/transform";`
(types: `import type { Vec2, Vec3, Vec4, Quat, Mat3, Mat4 } from "@furnace/core/transform";`)

### Public

| Export | Signature | Notes |
|---|---|---|
| `vec3` | namespace `{ create, fromValues, set, copy, add, sub, scale, dot, cross, length, normalize, transformMat4 }` | `Vec3` = `Float32Array` of length 3. All ops follow the gl-matrix `(out, ...args) => out` convention. |
| `vec4` | namespace `{ create, fromValues, set, copy }` | `Vec4` = `Float32Array` of length 4. Minimal surface — extend as needed. |
| `quat` | namespace `{ create, fromValues, identity, copy, fromEuler, fromAxisAngle, multiply, normalize, conjugate, slerp }` | `Quat` = `Float32Array` of length 4, `(x, y, z, w)`. `create()` returns identity. |
| `mat4` | namespace `{ create, identity, copy, multiply, translate, scale, rotate, invert, transpose, perspective, ortho, lookAt, fromQuat, fromRotationTranslationScale }` | `Mat4` = `Float32Array` of length 16, column-major (matches WebGPU). `invert` returns `Mat4 \| null` (singular). `perspective` accepts `far = Infinity`. |
| `Vec2` | `Float32Array` (length 2) | Type alias. |
| `Vec3` | `Float32Array` (length 3) | Type alias. |
| `Vec4` | `Float32Array` (length 4) | Type alias. |
| `Quat` | `Float32Array` (length 4) — `(x, y, z, w)` | Type alias. |
| `Mat3` | `Float32Array` (length 9) | Type alias. Reserved; not currently produced by any function. |
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
| `createEmitter` | `<T = void>(ctx?: Context, name?: string) => Emitter<T>` | Building block. When `ctx` + non-empty `name` are passed, each `emit` increments `events.perEmitter[name]` in stats. Snapshot-iteration semantics: adds during emit fire next round; removes during emit take effect this round. Subscriber throws are caught and `console.error`-ed. |
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
| `frameBoundary` | `(ctx: Context) => void` | Manual frame boundary for consumers not using `frame.loop`. Calls `_frameEnd` then `_frameStart`. No-op if disposed. |
| `recordDraw` | `(ctx: Context, info: { triangles: number }) => void` | Public wrapper over `_recordDraw`. Use when issuing your own draw calls outside `frame.render`. |
| `gauge` | `(ctx: Context, name: string, value: number) => void` | Sets a custom gauge (last-write-wins). Silently no-ops on disposed ctx, non-finite `value`, empty `name`, or cross-kind name collision (warns to console). |
| `increment` | `(ctx: Context, name: string, by?: number) => void` | Increments a custom counter. Monotonic — negative `by` is rejected (warns). Default `by = 1`. |
| `get` | `<P extends Path<Snapshot>>(ctx: Context, path: P) => PathValue<Snapshot, P> \| null` | Dotted-path lookup into a fresh snapshot. Returns `null` for unresolved paths or disposed ctx. Path is statically constrained to valid `Snapshot` keys. |
| `measure` | `(ctx: Context, name: string, fn: () => void) => void` | Times `fn()` and stores `performance.now()` delta under `name`. `fn` is run even on errors (finally block). On disposed ctx: `fn` is intentionally **not** invoked. |
| `startMeasurement` | `(ctx: Context, name: string) => Measurement` | Returns `{ end }` for async/manual measurements. Calling `end` twice warns and no-ops. Returns a no-op `Measurement` on disposed ctx or invalid name. |
| `Snapshot` | see `snapshot-types.ts` | Frozen `{ frame, gpu, resources, events, memory, custom }`. `frame.ms` includes `{ last, mean, p99, min, max }`. `gpu.renderMs` / `gpu.computeMs` are currently `null` (reserved). |
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
| `_registerResource` | `mesh`, `material`, `post`, `frame/render.ts` (depth + camera buffers) |
| `_unregisterResource` | matching `destroy` paths |
| `ResourceHandle` | `Readonly<{ kind: ResourceKind; bytes: number }>` — opaque handle held by every resource owner so `destroy` can unregister |
| `ResourceInfo` | discriminated union per `kind` (`"mesh" \| "material" \| "geometry" \| "effect" \| "buffer" \| "texture"`) accepted by `_registerResource` |

### Demoed in cookbook

(cross-links populated as demos land — Tasks 10–18)

### Reference-only (no demo, by design)

(none — the public surface is exercised by the custom-stats demo + the always-on stats overlay)

---

## `@furnace/core/camera`

`import * as camera from "@furnace/core/camera";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `perspective` | `(opts?: PerspectiveOptions) => Camera` | Defaults: `fovYRad = π/4`, `aspect = 1`, `near = 0.1`, `far = 1000`, `position = [0,0,3]`, `target = [0,0,0]`, `up = [0,1,0]`. Throws `FurnaceError` on invalid params. |
| `orthographic` | `(opts?: OrthographicOptions) => Camera` | Defaults: `left/right/bottom/top = ∓1`, `near/far = ∓1`, `position = [0,0,1]`. Throws on non-finite bounds or `near ≥ far`. |
| `setPosition` | `(cam: Camera, position: Vec3) => void` | Mutates in place, flips `viewDirty`. |
| `setTarget` | `(cam: Camera, target: Vec3) => void` | Mutates in place, flips `viewDirty`. |
| `setUp` | `(cam: Camera, up: Vec3) => void` | Mutates in place, flips `viewDirty`. |
| `setAspect` | `(cam: Camera, aspect: number) => void` | Works on both projection kinds. For orthographic, adjusts `left`/`right` to preserve the vertical range. Throws on non-positive / non-finite. |
| `setNearFar` | `(cam: Camera, near: number, far: number) => void` | Throws if `near ≥ far`, or if perspective and `near ≤ 0`. |
| `setFov` | `(cam: Camera, fovYRad: number) => void` | Perspective-only — throws on orthographic. |
| `setBounds` | `(cam: Camera, bounds: { left; right; bottom; top }) => void` | Orthographic-only — throws on perspective. |
| `getMatrices` | `(cam: Camera) => CameraMatrices` | Recomputes only dirty matrices. Returns the same frozen `{ view, projection, viewProjection }` wrapper across calls (inner `Float32Array`s are stable; mutated in place). |
| `PerspectiveOptions` | `{ fovYRad?; aspect?; near?; far?; position?; target?; up? }` | See defaults above. |
| `OrthographicOptions` | `{ left?; right?; bottom?; top?; near?; far?; position?; target?; up? }` | See defaults above. |
| `Camera` | mutable data record (position, target, up, projection union, cached matrices, dirty flags) | See `camera/types.ts`. Treated as an opaque handle by consumers — mutate only via setters. |
| `CameraMatrices` | `Readonly<{ view: Mat4; projection: Mat4; viewProjection: Mat4 }>` | The wrapper returned by `getMatrices`. |

### Demoed in cookbook

- `perspective`, `orthographic`, `setPosition`, `setTarget` → `cookbook/hello-cube`.

### Reference-only (no demo, by design)

- `getMatrices` — `frame.render` calls it internally per draw; consumers rarely call it themselves outside of custom render paths.

---

## `@furnace/core/material`

`import * as material from "@furnace/core/material";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, descriptor: MaterialDescriptor) => Promise<Material>` | Builds (or reuses, via internal pipeline cache) a render pipeline keyed on shader source + raster state + blend signature + ctx format. Validates the descriptor; throws `FurnaceError` if pipeline creation fails. |
| `destroy` | `(material: Material) => void` | Destroys owned buffers, unregisters resources, releases the cached pipeline ref. |
| `unlit` | `(ctx: Context, opts: { color: [number, number, number, number] }) => Promise<Material>` | Stock unlit material. Allocates a 16-byte uniform buffer for the color (owned by the material). |
| `normalColor` | `(ctx: Context) => Promise<Material>` | Stock debug material that renders the (uniform-scale-correct) world-space normal as RGB. No bindings. |
| `createPipeline` | `(ctx: Context, descriptor: GPURenderPipelineDescriptor) => Promise<GPURenderPipeline>` | Escape hatch: wraps `device.createRenderPipeline` in a validation error scope. Returns the raw pipeline; the caller owns it (not cached, not registered). |
| `PREMULTIPLIED_ALPHA_BLEND` | `GPUBlendState` constant — `src=one, dst=one-minus-src-alpha, op=add` for both color and alpha | Frozen; pass to `MaterialDescriptor.blend`. |
| `ADDITIVE_BLEND` | `GPUBlendState` constant — `src=one, dst=one, op=add` for both color and alpha | Frozen; pass to `MaterialDescriptor.blend`. |
| `MaterialDescriptor` | `{ vertex: string; fragment: string; bindings?: GPUBindGroupEntry[]; cullMode?; topology?; depthWrite?; depthCompare?; blend? }` | Defaults: `cullMode = "back"`, `topology = "triangle-list"`, `depthWrite = true`, `depthCompare = "less"`. `vertex` and `fragment` are required WGSL strings. |
| `Material` | record holding `{ ctx, pipeline, pipelineKey, group1, ownedBuffers, ownedBufferHandles, cullMode, topology, depthWrite, depthCompare, _materialHandle }` | Treated as an opaque handle by consumers — used by `mesh.create` and `frame.render`. |

### Demoed in cookbook

- `unlit`, `normalColor`, `destroy` → `cookbook/hello-cube`.
- `create`, `MaterialDescriptor` (topology) → `cookbook/geometry`.
- `create`, `MaterialDescriptor` (vertex/fragment/bindings) → `cookbook/shader`.

### Reference-only (no demo, by design)

- `createPipeline` — escape hatch for consumers writing their own render system; cookbook demos use `material.create` (with caching + resource tracking) instead.

---

## `@furnace/core/mesh`

`import * as mesh from "@furnace/core/mesh";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `cube` | `(ctx: Context, opts: { material: Material; size?: number }) => Mesh` | Convenience: builds a fresh cube geometry and binds it to `opts.material`. `size` default: 1. |
| `plane` | `(ctx: Context, opts: { material: Material; size?: number }) => Mesh` | Convenience: builds a fresh `+Z`-facing unit plane and binds it to `opts.material`. `size` default: 1. |
| `cubeGeometry` | `(ctx: Context, opts?: { size?: number }) => Geometry` | Standalone cube geometry — pass to `mesh.create` when you want to reuse one geometry across multiple meshes. |
| `createGeometry` | `(ctx: Context, data: GeometryData) => Geometry` | Builds a vertex buffer (interleaved `[pos.xyz, normal.xyz, uv.uv]`, 32-byte stride) and optional index buffer from raw arrays. Validates the data. |
| `destroyGeometry` | `(geometry: Geometry) => void` | Destroys vertex + index buffers, unregisters resources. |
| `create` | `(ctx: Context, opts: { geometry: Geometry; material: Material }) => Mesh` | Allocates the per-mesh object-uniform buffer (64 bytes for `model`). Position `[0,0,0]`, identity rotation, scale `[1,1,1]`. |
| `destroy` | `(mesh: Mesh) => void` | Destroys the object buffer, unregisters resources. Does **not** destroy the geometry (it may be shared). |
| `setPosition` | `(mesh: Mesh, position: Vec3) => void` | Flips `transformDirty`. |
| `setRotation` | `(mesh: Mesh, rotation: Quat) => void` | Flips `transformDirty`. |
| `setScale` | `(mesh: Mesh, scale: Vec3) => void` | Flips `transformDirty`. |
| `Geometry` | record holding `{ ctx, vertexBuffer, vertexCount, indexBuffer, indexFormat, indexCount, triangleCount }` | Treated as an opaque handle by consumers. |
| `GeometryData` | `{ positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices?: Uint16Array \| Uint32Array }` | Raw arrays fed to `createGeometry`. |
| `Mesh` | record holding `{ ctx, geometry, material, position, rotation, scale, modelMatrix, transformDirty, objectBuffer }` | Treated as an opaque handle by consumers — mutate only via setters. |

### Demoed in cookbook

- `cube`, `cubeGeometry`, `plane`, `create`, `destroy`, `setPosition` → `cookbook/hello-cube`.
- `setRotation`, `setScale` → `cookbook/animation`.
- `createGeometry`, `destroyGeometry`, `GeometryData`, `Geometry` → `cookbook/geometry`.

### Reference-only (no demo, by design)

- `cubeGeometry` — exposed for the geometry-sharing pattern (one geometry, many meshes); the cube demo uses `mesh.cube` for the common single-mesh path.
- `destroyGeometry` — surfaces in teardown of any geometry-sharing demo; not exercised standalone.

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

- `attach`, `detach`, `onPointerDown`, `onPointerMove`, `onPointerUp` → `cookbook/hello-cube`.
- `isKeyDown`, `onKeyDown`, `onKeyUp`, `onWheel`, `KeyEvent`, `WheelEvent`, `PointerButton` → `cookbook/input`.

### Reference-only (no demo, by design)

- `FurnaceInputError` — error type; surfaced indirectly by `attach` misuse in code-paths the demo doesn't go down.

---

## `@furnace/core/post`

`import * as post from "@furnace/core/post";`

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, desc: EffectDescriptor) => Promise<Effect>` | Builds (or reuses, via internal pipeline cache) a full-screen post-process pipeline keyed on shader + ctx format + blend signature. The shared fullscreen vertex shader (`vs_fullscreen`) is auto-supplied. Throws on disposed ctx or missing `shader`. |
| `destroy` | `(effect: Effect) => void` | Marks the effect destroyed, unregisters its resource, releases the cached pipeline ref. Warns on double-destroy. |
| `EffectDescriptor` | `{ shader: string; bindings?: GPUBindGroupEntry[]; blend?: GPUBlendState }` | WGSL fragment shader with `fs_main` entry. Sampler + scene input are bound at `@group(0)`; `bindings` go to `@group(1)`. |
| `Effect` | `Readonly<{ ctx, pipeline, pipelineKey, bindings, blend, _effectHandle, _internal }>` | Treated as an opaque handle by consumers — passed to `frame.render` via `RenderOptions.effects`. |

### Demoed in cookbook

(cross-links populated as demos land — Tasks 10–18)

### Reference-only (no demo, by design)

(none — the entire public surface is exercised by the post demo.)

---

## Tier 1 surface NOT in the public API

These appear in module source files but are NOT exported, OR are exported with a leading `_` to mark them internal-only:

- Internal `_*` stats hooks (table above in `@furnace/core/stats`).
- Material's internal `_pipelineCache` (in `material/pipeline.ts`) and `_blendSignature` (in `material/material.ts`). Neither re-exported from `material/index.ts`.
- Post's internal `_pipelineCache` (in `post/pipeline-cache.ts`), `_ensureFullscreenVS` (in `post/fullscreen.ts`), `_effectPipelineHashKey` / `_buildEffectPipelineDescriptor` (in `post/pipeline.ts`), and `_ensureSceneIntermediates` (in `post/intermediate.ts`). None re-exported from `post/index.ts`.
- Frame's internal `_frameRenderInternals` in `frame/render.ts` — a bundle of `{ _ensureDepthTexture, _ensureCameraBuffer, _ensureMeshGroup0 }` consumed by `frame/render-to-texture.ts`. Not re-exported from `frame/index.ts`.
- Mesh's internal `_recomputeModelIfDirty` in `mesh/mesh.ts`, called by `frame/render.ts` and `frame/render-to-texture.ts` per draw. Not re-exported from `mesh/index.ts`.
- Mesh's `planeGeometry` factory in `mesh/factories/plane.ts` is defined but not re-exported from `mesh/factories/index.ts`. Asymmetric with `cubeGeometry`, which is exported — see note in the divergences register / `docs/backlog/` if this is intentional.
- Camera's `OrthographicBounds` type in `camera/orthographic.ts` is defined but not re-exported from `camera/index.ts`. Its shape is inlined into `setBounds`'s signature in the camera table above. Surfacing it as a type export would let consumers compose `(bounds: OrthographicBounds) => ...` helpers; today they must redeclare the inline shape.

These are accessed only by other core modules. If consumer code is reaching for one, that is a signal to either (a) export it as a documented public escape hatch or (b) extend the public API to cover the use case.

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
| `RequestContextOptions` | `{ surfaceFormat?: "srgb" \| "linear"; pixelRatio?: "device" \| "css" \| number; sampleCount?: 1 \| 4; hdr?: boolean }` | Defaults: `surfaceFormat: "srgb"`, `pixelRatio: "device"`, `sampleCount: 1`, `hdr: false`. `sampleCount`: MSAA sample count for the scene pass — `1` = no MSAA, `4` = 4× MSAA (the only two values core WebGPU supports; any other value throws `FurnaceGpuError`). `hdr`: when `true`, the scene target and pool-backed post-chain targets use `rgba16float` (the *working color format*) so lit values survive above 1.0; `false` uses the swap-chain surface format (LDR path). |
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
| `render` | `(ctx: Context, opts: RenderOptions) => void` | One-shot render pass. Allocates a depth texture and per-camera uniform buffer lazily, sets up `group(0)`, iterates `opts.meshes`, then draws each `opts.instanced` group (after `meshes`, in the same scene pass) as **one** instanced draw call sourcing per-instance model matrix + tint from its instance vertex buffers, and (if `opts.effects` non-empty) evaluates the flattened post chain through pool-backed transient targets to the swap chain. |
| `drawLines` | `(ctx: Context, opts: DrawLinesOptions) => void` | Immediate `line-list` overlay (Command). Draws `opts.vertices` (flat xyz line-list) colored per-vertex by `opts.colors` (RGBA), transformed by `opts.camera`, as a second pass over the current swap-chain texture (`loadOp:"load"`), against the scene depth with no depth write. Depth mode is set by `opts.occlude` (default `true`): `true` → `depthCompare:"less-equal"` (occluded behind nearer meshes — physics wireframes, AABB highlights); `false` → `depthCompare:"always"` (always-on-top — gizmos). Call after `frame.render` in the same frame. Two pipelines (one per depth mode) + grow-on-demand buffers are engine-owned per context. Warm-path-validate: throws on disposed ctx / null camera / null arrays; empty `vertices` → no-op. |
| `renderToTexture` | `(ctx: Context, opts: RenderToTextureOptions) => void` | Like `render`, but the color target is a consumer-supplied `GPUTexture`. Draws `opts.meshes` then each `opts.instanced` group (one instanced draw per group, after `meshes`) into the off-screen target. No post-effects chain. Depth presence must agree with each drawn material's depth state; a mismatch (or a color-target format ≠ the working color format, or a supplied `depthTexture` format ≠ `depth24plus`, or an MSAA context) throws `FurnaceGpuError`. |
| `encode` | `(ctx: Context, callback: (encoder: GPUCommandEncoder) => void) => void` | Low-level escape hatch: creates a command encoder, hands it to the callback, finishes and submits. Bypasses scene-pass / camera / mesh bookkeeping. Throws if `ctx` is disposed. |
| `FrameInfo` | `Readonly<{ elapsedMs: number; deltaMs: number }>` | `deltaMs` is capped by `LoopOptions.maxDeltaMs` (default 100). |
| `FrameLoopHandle` | `Readonly<{ stop: () => void; pause: () => void; resume: () => void }>` | Returned by `loop`. |
| `LoopOptions` | `{ maxDeltaMs?: number; pauseOnHidden?: boolean }` | Defaults: `maxDeltaMs: 100`, `pauseOnHidden: true`. |
| `RenderOptions` | `{ meshes: Mesh[]; instanced?: InstancedMesh[]; camera: Camera; effects?: Effect[]; lights?: Light[]; ambient?: Ambient; fog?: Fog; clearColor?: Vec4; clearDepth?: number }` | `instanced` — optional instanced draw groups, recorded after `meshes` in the same scene pass; each is drawn as one instanced draw call (per-instance transform + tint from the instance vertex buffers) and resolved against the dedicated instanced-mesh pool (never inferred from a shared handle — `Mesh` and `InstancedMesh` are kept in typed-distinct lists). `clearColor` is a linear-space RGBA `Vec4`; defaults to `[0, 0, 0, 1]`. `clearDepth` defaults to `1.0`. `lights` — per-frame scene lights (omitted/empty → ambient-only); clamped to `MAX_LIGHTS` (16) with a once-only `log.warn`, never throws. `ambient` — per-frame hemisphere ambient (omitted → neutral low default, `intensity ≈ 0.05`). `fog` — per-frame exponential distance fog (omitted → disabled, density `0`). All three reach the shader via the engine Scene UBO (`@group(0) @binding(1)`), bound only for `usesScene` pipelines (`shader.lit`/`shader.texturedLit` or custom shaders composing `shader.sceneBinding`/`lightingHelpers`). See `engine-conventions.md` §Lighting. |
| `Light` | discriminated union — `DirectionalLight \| PointLight \| SpotLight` | Per-frame value-type (no handle/lifecycle, like `Camera`). `DirectionalLight` = `{ type: "directional"; direction: [x,y,z]; color: [r,g,b]; intensity; shadow? }` (`direction` = world-space travel direction, e.g. `[0,-1,0]` for a downward sun; the shader uses `L = -direction`). `PointLight` = `{ type: "point"; position; color; intensity; range }` (`range` = windowed inverse-square cutoff radius; point lights never cast shadows). `SpotLight` = `{ type: "spot"; position; direction; color; intensity; range; innerAngle; outerAngle; shadow? }` (`direction` = cone axis = travel direction; `innerAngle`/`outerAngle` = half-angles in radians, full intensity inside inner, zero by outer). Colors are linear RGB; `intensity` is HDR-calibrated (a white surface under one key light peaks ≈1.0, no `1/π`). The optional `shadow` config on `directional`/`spot` opts the light into shadow casting (presence = casts) — see `DirectionalShadow`/`SpotShadow` and `engine-conventions.md` §Shadows. |
| `Ambient` | `{ sky: [r,g,b]; ground: [r,g,b]; intensity }` | Per-frame hemisphere ambient value-type. `intensity` scales both sky and ground (kept a small fraction of the key light so it doesn't eat HDR headroom). Ambient is never shadowed. |
| `Fog` | `{ color: [r,g,b]; density }` | Per-frame exponential distance fog value-type. `final = mix(litColor, color, 1 - exp(-density * distanceFromCamera))`; `density` `0` disables it (no visual change — backward compatible). Applied by the built-in `lit`/`texturedLit` shaders (and any custom shader composing `lightingHelpers`' `fr_applyFog`). Packed into the engine Scene UBO (`@group(0) @binding(1)`), so it reaches only `usesScene` pipelines. `color` is linear RGB. |
| `DirectionalShadow` | `{ orthoHalfExtent: number; near: number; far: number; target?: [x,y,z]; distance?: number; depthBias?: number; normalBias?: number }` | Per-light shadow config on a `DirectionalLight` (presence = casts). The shadow frustum is **orthographic**: `orthoHalfExtent` (required) is its half width/height in world units; `near`/`far` (required) are the ortho planes; `target` (default `[0,0,0]`) is the world point the box looks at; `distance` (default `far/2`) places the light eye that far back along `-direction`. `depthBias` (default `0`) — normalized `[0,1]` depth subtracted from the receiver's compare depth to fight acne; keep *small* (`~0.001`–`0.01`), a value near `1` disables shadows. `normalBias` (default `1.5`) — texel-scaled normal-offset bias for grazing-angle acne. Up to `MAX_SHADOW_CASTERS` (4) casting lights per frame; surplus clamped (warn-once). |
| `SpotShadow` | `{ near?: number; far?: number; depthBias?: number; normalBias?: number }` | Per-light shadow config on a `SpotLight` (presence = casts). The frustum is **perspective from the cone** (`fovY = 2 · outerAngle`, aspect 1); `near` (default `0.1`) / `far` (default the light's `range`) are the perspective planes. `depthBias` (default `0`, normalized `[0,1]` depth) and `normalBias` (default `1.5`, texel-scaled) match `DirectionalShadow`. Up to `MAX_SHADOW_CASTERS` (4) casting lights per frame; surplus clamped (warn-once). |
| `DrawLinesOptions` | `{ vertices: Float32Array; colors: Float32Array; camera: Camera; occlude?: boolean }` | Input bundle for `drawLines`. `occlude` defaults to `true` (depth-tested, occluded behind nearer meshes); pass `false` for always-on-top / gizmo rendering (`depthCompare:"always"`). Caller must ensure `colors.length === (vertices.length / 3) * 4` (not validated — `drawLines` trusts array-length consistency). |
| `RenderToTextureOptions` | `{ texture: GPUTexture; meshes: Mesh[]; instanced?: InstancedMesh[]; camera: Camera; depthTexture?: GPUTexture; clearColor?: Vec4; clearDepth?: number }` | `instanced` — optional instanced draw groups, drawn after `meshes` (one instanced draw per group) into the off-screen target; resolved against the dedicated instanced-mesh pool, same invalid-handle semantics as `meshes`. `clearColor` is a linear-space RGBA `Vec4`. Omit `depthTexture` **only if every drawn material has depth disabled** (`material.create` with `depth: false`, or a built-in factory with `depthEnabled: false`); a depth/format mismatch (or a color format ≠ the working color format, or depth format ≠ `depth24plus`) throws `FurnaceGpuError`. The working color format is `rgba16float` for HDR contexts, the swap-chain surface format for LDR. **MSAA contexts (`sampleCount: 4`) are not supported** — call `renderToTexture` only on `sampleCount: 1` contexts. |

### Demoed in cookbook

- `loop`, `render`, `RenderOptions` → `cookbook/camera`.
- `render({ instanced })`, `RenderOptions.instanced` → `cookbook/instancing` (a grid of per-instance-tinted cubes drawn as one instanced draw call).
- `loop`, `fixedClock`, `FrameInfo` → `cookbook/animation` (variable dt vs fixed-step + interpolation).
- `renderToTexture`, `RenderToTextureOptions` → `cookbook/render-target`.
- `render({ effects })` → `cookbook/post`.
- `render({ lights, ambient })`, `Light` (directional/point/spot), `Ambient` → `cookbook/lighting` (multi-light Blinn-Phong with per-material `specular`, against `shader.lit`).
- `Light.shadow` (`DirectionalShadow`/`SpotShadow`), `render({ lights })` → `cookbook/shadows` (a moving directional/spot caster casting shadows onto a matte receiver, against `shader.lit`).

### Reference-only (no demo, by design)

- `encode` — escape hatch for consumers who need to author their own passes (e.g. compute, custom multi-pass setups). Cookbook demos use `render` / `renderToTexture` exclusively.

---

## `@furnace/core/transform`

`import { vec3, vec4, quat, mat4 } from "@furnace/core/transform";`
(types: `import type { Vec2, Vec3, Vec4, Quat, Mat3, Mat4 } from "@furnace/core/transform";`)

### Public

| Export | Signature | Notes |
|---|---|---|
| `vec3` | namespace `{ create, fromValues, set, copy, add, sub, scale, lerp, dot, cross, length, normalize, transformMat4, transformQuat }` | `Vec3` = `Float32Array` of length 3. All ops follow the gl-matrix `(out, ...args) => out` convention. `lerp(out, a, b, t)` is component-wise linear interpolation — use `quat.slerp` for rotations. `transformQuat(out, v, q)` rotates `v` by unit quaternion `q` using the standard `v + 2·cross(q.xyz, cross(q.xyz, v) + q.w·v)` form; `out` may alias `v`. |
| `vec4` | namespace `{ create, fromValues, set, copy }` | `Vec4` = `Float32Array` of length 4. Minimal surface — extend as needed. |
| `quat` | namespace `{ create, fromValues, identity, copy, fromEuler, fromAxisAngle, multiply, normalize, conjugate, slerp }` | `Quat` = `Float32Array` of length 4, `(x, y, z, w)`. `create()` returns identity. |
| `mat4` | namespace `{ create, identity, copy, multiply, translate, scale, rotate, invert, transpose, normalFromMat4, perspective, ortho, lookAt, fromQuat, fromRotationTranslationScale }` | `Mat4` = `Float32Array` of length 16, column-major (matches WebGPU). `invert` returns `Mat4 \| null` (singular). `normalFromMat4(out, m)` writes the **normal matrix** — the inverse-transpose of `m`, for transforming normals correctly under non-uniform scale; falls back to writing identity when `m` is singular (rather than emitting NaN). Stored as a full `mat4x4` (shaders read the upper-left 3×3). `perspective` accepts `far = Infinity`. |
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
| `Snapshot` | see `snapshot-types.ts` | Frozen `{ frame, gpu, resources, events, memory, custom }`. `resources` contains `{ meshes, materials, geometries, effects, shaders, bindings, physicsWorlds, physicsBodies, rigidMeshes, textures }` — live counts per pool kind. `frame.ms` includes `{ last, mean, p99, min, max }`. `gpu.renderMs` / `gpu.computeMs` are currently `null` (reserved). `gpu.uncapturedErrors` is a cumulative count. `gpu.deviceLost` is `true` after `device.lost` resolves on a non-disposed context (terminal — see below). `memory.textureBytes` tracks GPU texture bytes for all consumer textures + engine-internal render targets; note that mipmapped consumer textures are counted at base-level bytes only (see `docs/backlog/engine-architecture/mipmap-texture-bytes-undercount.md`). |
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
| `_recordAlloc` | Three categories of writer, all using the signature `(ctx, kind, bytes) => void`: (1) **slot-kind count records** — `resources/internal.ts` per-kind alloc wrappers (`_allocMesh` / `_allocMaterial` / `_allocGeometry` / `_allocEffect` / `_allocShader` / `_allocBinding` / `_allocTexture`) fire `(ctx, kind, 0)` to bump slot counts; `_allocTexture` uses kind `"texture-resource"` (→ `resources.textures`). (2) **slot-owned bytes** — resource modules that allocate GPU memory owned by a slot: `mesh/mesh.ts` (object uniform, kind `"buffer"`), `geometry/geometry.ts` (vertex + optional index buffers, kind `"buffer"`), `binding/binding.ts` (uniform buffer, kind `"buffer"`), `texture/texture.ts` (GPU texture base-level bytes, kind `"texture"` → `memory.textureBytes`). (3) **ctx-owned bytes** — engine-internal resources that don't flow through a pool slot: `frame/render.ts` (depth texture + per-camera uniform buffer), `post/pool.ts` (transient post-chain color targets). |
| `_recordDestroy` | Symmetric to `_recordAlloc` across the same three categories: (1) slot-kind count decrements from `resources/internal.ts` destroy paths (`_destroyMesh` / `_destroyMaterial` / `_destroyGeometry` / `_destroyEffect` / `_destroyShader` / `_destroyBinding` / `_destroyTexture` / `_destroyByKind`). (2) slot-owned bytes from the resource module's teardown: `mesh/mesh.ts` (object uniform), `geometry/geometry.ts` (vertex + index buffers), `material/material.ts` (iterates `ownedBufferBytes`), `binding/binding.ts` (`_teardown` decrements the buffer bytes), `texture/texture.ts` (`_teardown` decrements `memory.textureBytes` by the recorded base-level byte size). (3) ctx-owned bytes from `frame/render.ts` and `post/pool.ts`. Signature: `(ctx, kind, bytes) => void`. |

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
| `screenToRay` | `(cam: Camera, ndcX: number, ndcY: number) => Ray` | Unprojects a normalized-device-coordinate cursor position (`ndcX`/`ndcY` in `[-1, 1]`, Y-up) into a world-space ray. Returns `{ origin, dir }` where `origin` is the near-plane point and `dir` is normalized. Geometric counterpart of `projectToScreen` (unprojects via the inverse view-projection). Returns a degenerate ray (`dir ≈ 0`) only if the view-projection is singular. Used for viewport picking and gizmo hit-testing. Allocates a fresh `Ray` per call; scratch buffers for the inverse-VP computation are reused. |
| `PerspectiveOptions` | `{ fovYRad?; aspect?; near?; far?; position?; target?; up? }` | See defaults above. |
| `OrthographicOptions` | `{ fitPolicy?; scale?; near?; far?; position?; target?; up? }` | See defaults above. `fitPolicy` defaults to a `stretch` policy with unit bounds; `scale` defaults to 1. |
| `OrthographicBounds` | `{ left: number; right: number; bottom: number; top: number }` | Shape returned by `getBounds` and accepted by `policy.stretch`. Use this type when composing helpers that receive or forward bounds. |
| `FitPolicy` | discriminated union — `{ kind: "stretch"; bounds: OrthographicBounds } \| { kind: "preserve-height"; height: number; anchor: Anchor } \| { kind: "preserve-width"; width: number; anchor: Anchor }` | Orthographic fit policy variants. Construct via the `policy` factory namespace (validated) or write the literal directly (unvalidated). |
| `Anchor` | `{ x: number; y: number }` | Components in `[0, 1]`. Anchor for derived-bounds policies. `(0.5, 0.5)` = world origin centered in the visible rect (default). Y-up. |
| `Camera` | mutable data record (position, target, up, projection union, cached matrices, dirty flags) | See `camera/types.ts`. A **value-type** (mutable data record), not a handle. Mutate via the camera setters; read via the getters / `getMatrices`. Owns no GPU resources. |
| `CameraMatrices` | `Readonly<{ view: Mat4; projection: Mat4; viewProjection: Mat4 }>` | The wrapper returned by `getMatrices`. |
| `ScreenProjection` | `{ x: number; y: number; w: number }` | Out-param for `projectToScreen`. `x`/`y` are CSS pixels (origin top-left), `w` is clip-space divisor (useful for distance-based label sizing). |
| `Ray` | `{ origin: Vec3; dir: Vec3 }` | World-space ray returned by `screenToRay`. `origin` is a `Float32Array(3)` near-plane point; `dir` is a normalized `Float32Array(3)` direction. |

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
| `create` | `(ctx: Context, src: ShaderSource \| string, opts?: ShaderCreateOpts<L>) => Promise<Shader<L>>` | Accepts a `ShaderSource` (composed via `shader.source`; flattened by `toWgsl`) or a bare WGSL `string` (compiled unchanged). Compile a `Shader` from WGSL source. Pass `opts.layout` to declare the shader's `@group(1)` uniform-buffer schema; the layout is resolved at compile time and stored on the handle (readable via `_layoutOf`). `opts.addressSpace` defaults to `"uniform"`. Omit `opts` entirely for shaders with no `@group(1)` binding; existing 2-arg calls are unaffected. Validates via `pushErrorScope("validation")` AND `getCompilationInfo` (belt-and-braces across runtimes). Setup-loud: throws `FurnaceError` if the resolved WGSL source is empty; throws `FurnaceError` if WGSL compilation fails; throws `FurnaceError` if `opts.layout` uses an unsupported token or unimplemented address space. |
| `load` | `(ctx: Context, url: string, opts?: ShaderCreateOpts<L>) => Promise<Shader<L>>` | Fetch WGSL from `url` and compile it. Accepts the same `opts` as `create`. Does **not** resolve `// @include` directives (to share snippets, compose with `shader.source`/`toWgsl` and pass the result to `create`; `// @include` string-syntax resolution stays deferred — see `shader-preprocessor.md`) and does **not** cache by URL (the browser HTTP-caches the bytes; reuse the returned handle to deduplicate). Setup-loud: throws `FurnaceError` on a non-OK HTTP response; throws `FurnaceError` if the fetched WGSL fails to compile. |
| `unlit` | `(ctx: Context) => Promise<Shader<{ color: "vec4f" }>>` | The engine's stock unlit shader (reads a `vec4<f32>` colour at `@group(1) @binding(0)`). Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Pass to `material.create` (pair with a `binding` carrying `{ color }`). Carries a by-construction `@group(1)` layout: `{ color: "vec4f" }` (16 bytes, uniform); readable via `_layoutOf`. |
| `lit` | `(ctx: Context) => Promise<Shader<{ color: "vec4f"; specular: "vec4f" }>>` | The engine's stock lit shader — **multi-light Blinn-Phong** over the engine Scene UBO (`RenderOptions.lights` + `ambient`): hemisphere ambient + per-light diffuse and half-vector specular, with windowed inverse-square attenuation and spot cones, HDR-calibrated (no `1/π`). `@group(1)` carries `{ color, specular }` (both `vec4f`; `specular.rgb` = specular colour, `specular.w` = shininess). The default is **matte** — an unset (zero) `specular` adds no highlight, so a `{ color }`-only binding keeps working; add a highlight by setting both `specular.rgb` and `specular.w`. Declares `usesScene: true` and `usesShadows: true` — **receives shadows transparently** (no signature change): shadow-casting `Light`s darken its direct term automatically. **No longer shares `unlit`'s layout** (it adds `specular`), so an unlit↔lit material swap requires a `{ color, specular }` binding. Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Pass to `material.create` (pair with a `binding` carrying at least `{ color }`). Supply `frame.render({ lights })` or the surface renders ambient-only. |
| `unlitInstanced` | `(ctx: Context) => Promise<Shader<{ color: "vec4f" }>>` | The instanced sibling of `unlit` — reads `{ color }` at `@group(1) @binding(0)`, but sources the model matrix from **per-instance vertex attributes** (mat4 rows at locations 3–6) and a per-instance **tint** (`vec4f` at location 7) instead of the `@group(2)` Object UBO — it declares **no** `@group(2)`. Final colour is `mat.color * tint` (the tint modulates the material colour per instance). `@group(0)` (camera) and `@group(1)` (material `{ color }`) are shared verbatim with `unlit`. Pair with `mesh.createInstanced` (which supplies the per-instance buffers). Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Same `{ color }` layout as `unlit`. |
| `litInstanced` | `(ctx: Context) => Promise<Shader<{ color: "vec4f"; specular: "vec4f" }>>` | The instanced sibling of `lit` — the same multi-light Blinn-Phong over the engine Scene UBO (shadow-receiving, fog-applied), but sources the model matrix from **per-instance vertex attributes** (mat4 rows at locations 3–6) and a per-instance **tint** (`vec4f` at location 7) instead of the `@group(2)` Object UBO — declares **no** `@group(2)`; the tint multiplies into albedo (`mat.color.rgb * tint.rgb`). **Uniform-scale precondition**: the world normal is reconstructed from the upper 3×3 of the per-instance model (`mat3(model)`) + `normalize()` with **no** normal matrix, so per-instance transforms MUST be uniform-scale (rotation + translation + uniform scale); non-uniform scale skews normals and mis-shades. `@group(0)` (camera/scene/shadows) and `@group(1)` (material `{ color, specular }`) are shared verbatim with `lit`. Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Supply `frame.render({ lights })` or the surface renders ambient-only. |
| `normalColor` | `(ctx: Context) => Promise<Shader<Record<string, never>>>` | The engine's stock normal-debug shader (world-space normal → RGB; declares no `@group(1)` bindings). Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Pass to `material.create`. `_layoutOf` returns `null`. |
| `textured` | `(ctx: Context) => Promise<Shader<Record<string, never>>>` | The engine's stock **textured (unlit)** shader — samples albedo from a texture and outputs it directly, no lighting. Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Pass to `material.create` with a `MaterialDescriptor.texture`. `@group(1)` contract: `@binding(0)` sampler, `@binding(1)` `texture_2d<f32>`. No `@group(1)` uniform layout (`_layoutOf` returns `null`). Declares `textureBinding: true`; `material.create` will require a `texture` when this shader is used. |
| `texturedLit` | `(ctx: Context) => Promise<Shader<Record<string, never>>>` | The engine's stock **textured + lit** shader — samples albedo from a texture and shades it with the **same multi-light Blinn-Phong** model as `lit` (hemisphere ambient + per-light diffuse/specular, windowed inverse-square attenuation, spot cones, HDR-calibrated) over the engine Scene UBO. Specular is a **fixed engine default** (0.04 grey, shininess 32), **not** per-material — `@group(1)` is sampler@0 + `texture_2d<f32>`@1 only (a texture binding is mutually exclusive with a uniform binding), so no per-material specular uniform is possible here (per-material textured specular is backlog). No uniform layout. Declares `textureBinding: true`, `usesScene: true`, and `usesShadows: true` — **receives shadows transparently** (no signature change), same as `lit`. Engine-owned, shared per ctx (compiled once); `destroy` no-ops. Supply `frame.render({ lights })` or the surface renders ambient-only (textured). |
| `destroy` | `(ctx: Context, shader: Shader) => void` | Drop the engine's reference to the `GPUShaderModule` (GC reclaims it; no GPU-timeline free). Pipelines already built from it are unaffected (WebGPU captures the module at creation). No-op on engine-owned built-in shaders (`shader.unlit`/`shader.lit`/`shader.normalColor`/`shader.textured`/`shader.texturedLit`; `destroy` silently skips them). Idempotent on stale or destroyed handles. |
| `Shader<L>` | Opaque branded uint48 handle (alias of `ShaderHandle`) carrying phantom `L` | Returned by `create` / `load` / `unlit` / `lit` / `unlitInstanced` / `litInstanced` / `normalColor` / `textured` / `texturedLit`. `L` records the declared `@group(1)` layout schema at compile time; defaults to `LayoutSchema` (wide) when no `opts.layout` is provided. Pass to `material.create` via `MaterialDescriptor.shader`; dispose via `shader.destroy(ctx, s)`. |
| `ShaderCreateOpts<L>` | `{ layout?: L; addressSpace?: AddressSpace; textureBinding?: boolean; usesScene?: boolean; usesShadows?: boolean }` | Optional third argument to `create`/`load`. `layout` is a `LayoutSchema` (field name → WGSL token). `addressSpace` defaults to `"uniform"`. `textureBinding` (default `false`) — when `true`, declares the shader samples a texture at `@group(1)` (sampler@0, texture-view@1); `material.create` then requires a `texture` to be supplied. `usesScene` (default `false`) — when `true`, declares the shader reads the engine Scene UBO at `@group(0) @binding(1)` (lights + ambient); `frame.render` then binds the Scene buffer for this pipeline. Set it when composing the public `sceneBinding`/`lightingHelpers` fragments into a custom lit shader. `usesShadows` (default `false`) — when `true`, declares the shader samples the engine shadow maps at `@group(0)` bindings 2 (`texture_depth_2d_array`) and 3 (`sampler_comparison`); `frame.render` then binds the shadow resources for this pipeline. Mirrors `usesScene`. Set it when composing `shadowHelpers` (or `lightingHelpers`, which pulls it in) into a custom shadow-receiving shader. |
| `source` | `` (strings: TemplateStringsArray, ...interps: (ShaderSource\|string\|number)[]) => ShaderSource `` and `(body: string, deps?: readonly ShaderSource[]) => ShaderSource` | Construct a composable WGSL fragment. Tagged form: a `ShaderSource` interpolant is a hoisted, dedup'd module-scope dependency (position irrelevant — WGSL module scope is order-independent); a `string`/`number` interpolant is positional text; any other interpolant throws `FurnaceError`. Call form: `source(text, deps)` for WGSL imported as text (`with { type: "text" }`), preserving native `.wgsl` tooling. |
| `toWgsl` | `(src: ShaderSource) => string` | Flatten a `ShaderSource` graph to final WGSL: post-order DFS, each fragment emitted once (dedup by identity), deps before dependents, joined by a blank line. Deterministic. No topo-sort (WGSL is order-independent). |
| `ShaderSource` | `{ readonly body: string; readonly deps: readonly ShaderSource[] }` | A composable WGSL source fragment with identity + dependency edges. A **data** value (no handle/lifecycle/`destroy`), distinct from the compiled `Shader`. Feed to `create`. |
| `sceneBinding` | `ShaderSource` | The engine **Scene** binding fragment at `@group(0) @binding(1)`: the `Light` struct (std140-safe vec4 lanes — `posRange`/`dirType`/`colorInt`/`spotCos` + a `shadow` lane packing `(slot, depthBias, normalBias, _)`) + the `Scene` uniform (`ambientSky`/`ambientGround`/`lightCount`/`fog` + a fixed `array<Light, 16>` + a `shadowMatrices` tail, `array<mat4x4<f32>, 4>` = `MAX_SHADOW_CASTERS` per-caster light-space view·proj matrices). The `fog` lane packs `rgb` = fog color, `a` = density (`0` = disabled). Compose into a custom shader and pass `shader.create(ctx, src, { usesScene: true })` to receive the engine's per-frame lights (written by `frame.render` from `RenderOptions.lights`/`ambient`/`fog`, plus shadow casters when `usesShadows`). A `ShaderSource` data value. Defined in `shader/scene-binding.ts`; the `@furnace/core/shader` path is unchanged. |
| `lightingHelpers` | `ShaderSource` | Composable Blinn-Phong WGSL helpers over `sceneBinding` (which it depends on, so composing this pulls the Scene UBO in too). It also composes `shadowHelpers`, so composing `lightingHelpers` pulls in the shadow bindings at `@group(0)` bindings 2/3 — a custom shader using it **must** be created with `usesShadows: true` (the built-in `lit`/`texturedLit` already do), or the render path leaves those bindings unbound and validation fails. Exposes `fr_shade(worldPos, n, viewPos, albedo, specColor, shininess) -> vec3<f32>` (hemisphere ambient + per-light diffuse/specular, windowed inverse-square attenuation, spot cones, HDR-calibrated, additive specular); each casting light's direct term is multiplied by its `fr_shadowFactor` visibility while ambient is never shadowed. Also exposes `fr_applyFog(color, worldPos, viewPos) -> vec3<f32>` (exponential distance fog — `mix(color, scene.fog.rgb, 1 - exp(-scene.fog.a * dist))`, a no-op when fog density `scene.fog.a` is `0`) and the lower-level `fr_windowedInvSq`, `fr_spotCone`, and `fr_ambient`. The `fr_` prefix avoids colliding with consumer functions. A `ShaderSource` data value. |
| `shadowHelpers` | `ShaderSource` | Composable shadow-sampling WGSL helper over the engine shadow maps. Declares the shadow depth array at `@group(0) @binding(2)` (`texture_depth_2d_array`) and the comparison sampler at `@binding(3)` (`sampler_comparison`) — bound only for pipelines created with `usesShadows: true`. Depends on `sceneBinding` (reads each light's shadow slot + `scene.shadowMatrices`). Exposes `fr_shadowFactor(worldPos: vec3<f32>, slot: i32, depthBias: f32) -> f32` (`1.0` = lit, `0.0` = fully occluded): 3×3 PCF over a hardware comparison sampler; `slot < 0` (light not casting) or a receiver outside the shadow frustum returns `1.0`. Composing this (or `lightingHelpers`, which depends on it) in a custom shader requires `shader.create(ctx, src, { usesShadows: true })`. A `ShaderSource` data value. Source: `shader/shadows.ts`. |
| `LayoutSchema` | `Record<string, Token>` | Consumer-declared uniform-buffer schema: field name → WGSL token, in declaration order. |
| `AddressSpace` | `"uniform" \| "storage-read" \| "storage-readwrite"` | Address space of the layout buffer. Only `"uniform"` is implemented; storage variants throw until the compute tranche. |
| `ResolvedLayout` | `{ fields: Record<string, ResolvedField>; byteSize: number; addressSpace: AddressSpace }` | Output of the layout calculator: per-field byte offsets + total buffer byte size. |

### Internal (`_*`) — not for consumers

Re-exported from `index.ts` so the binding subsystem (Task 3+) can `import * as shader` and call the accessor without reaching into the module's internal files.

| Export | Used by |
|---|---|
| `_layoutOf` | `(ctx: Context, shader: Shader) => ResolvedLayout \| null` — reads the resolved `@group(1)` layout stored on a shader slot. Used by the binding subsystem to validate a `Binding` against its paired shader's declared schema. Returns `null` if no layout was declared at compile time. |
| `_textureBindingOf` | `(ctx: Context, shader: Shader) => boolean` — reads the `textureBinding` flag stored on a shader slot. Returns `true` when the shader was compiled with `textureBinding: true` (declares a texture+sampler at `@group(1)` bindings 0 and 1). Used by `material.create` to enforce that a `texture` is supplied when the shader samples one. |
| `_usesSceneOf` | `(ctx: Context, shader: Shader) => boolean` — reads the `usesScene` flag stored on a shader slot. Returns `true` when the shader was compiled with `usesScene: true` (reads the engine Scene UBO at `@group(0) @binding(1)`). Stored on `MaterialSlot` at `material.create` and read by `frame.render` to decide whether to bind the Scene buffer for the pipeline's `@group(0)`. |
| `_usesShadowsOf` | `(ctx: Context, shader: Shader) => boolean` — reads the `usesShadows` flag stored on a shader slot. Returns `true` when the shader was compiled with `usesShadows: true` (samples the engine shadow maps at `@group(0)` bindings 2 + 3). Stored on `MaterialSlot` at `material.create` and read by `frame.render` to decide whether to bind the shadow array + comparison sampler for the pipeline's `@group(0)`. |

### Demoed in cookbook

- `create`, `source`, `toWgsl`, `Shader`, `MaterialDescriptor (shader/bindings)` → `cookbook/shader` (the striped + plasma shaders share `hsv2rgb` from `chunks/color.wgsl` via `shader.source`, flattened by `toWgsl`).
- `unlit`, `normalColor` (engine-owned built-ins) → demoed via `material.create` across the cookbook (e.g. `cookbook/camera`, `cookbook/geometry`, `cookbook/render-target`).
- `lit` (engine-owned built-in, multi-light Blinn-Phong + per-material `specular`) → `cookbook/lighting` (with directional/point/spot `Light`s + `Ambient` via `frame.render({ lights, ambient })`); `cookbook/shadows` reuses `lit` to show it receiving shadows transparently from a `Light.shadow`-carrying caster.
- `unlitInstanced` (engine-owned built-in, per-instance tint via `mat.color * tint`) → `cookbook/instancing` (a grid of distinctly-tinted cubes in one draw call; the unlit path makes the tint read directly). `litInstanced` is the lit counterpart (same instance-attribute model + tint, with the uniform-scale precondition) — not separately demoed.
- `textured`, `texturedLit` (engine-owned built-ins) → used by the hello-world **bowling scene** (`packages/hello-world/src/demos/bowling/scene.ts`), not the cookbook. `cookbook/textures` authors its own textured shader against the same `@group(1)` contract rather than using the built-ins.
- `sceneBinding`, `lightingHelpers`, `shadowHelpers` (public lighting/shadow fragments) → not yet cookbook-demoed; reference-only for consumers composing custom lit/shadow-receiving shaders. The engine's own `shader.lit`/`shader.texturedLit` compose `lightingHelpers` (which pulls in `shadowHelpers`) internally; `cookbook/shadows` exercises the *built-in* receive path rather than a custom composition.

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
| `create` | `<L>(ctx: Context, descriptor: MaterialDescriptor<L>) => Promise<Material<L>>` | Builds (or reuses, via the per-ctx internal pipeline cache) a render pipeline keyed on the shader handle, entry points, resolved render state (`primitive` + `depth`), `sampleCount`, working color format (`ctx.format` for LDR, `rgba16float` when `hdr` is on), and blend signature. Two `create` calls with identical keys share one underlying `GPURenderPipeline`. When `descriptor.binding` is supplied, builds the `@group(1)` `GPUBindGroup` over the binding's `GPUBuffer` (entry `[{ binding: 0, resource: { buffer } }]`); the binding OWNS the buffer — material does not free it on destroy. When `descriptor.bindings` (raw) is supplied instead, the existing raw-binding path applies. When `descriptor.texture` is supplied (texture-binding shader path), builds the `@group(1)` `GPUBindGroup` with the resolved sampler at binding 0 and the texture view at binding 1; the texture is consumer-owned. Setup-loud: throws `FurnaceError` if `descriptor.shader` is missing; throws `FurnaceError` if the shader handle is invalid or destroyed; throws `FurnaceError` if the shader declares a `@group(1)` layout but neither `binding` nor a non-empty `bindings` is supplied (completeness check); throws `FurnaceError` if WebGPU pipeline creation reports a validation error; throws `FurnaceError` if `bindings` are supplied but the shader declares no `@group(1)` bindings (layout mismatch); throws `FurnaceError` if `texture` and `binding`/`bindings` are both supplied (mutually exclusive `@group(1)` sources); throws `FurnaceError` if the shader declares a `textureBinding` but no `texture` is supplied (texture-completeness check); throws `FurnaceError` if `texture.texture` is an invalid or destroyed handle. |
| `destroy` | `(ctx: Context, material: Material) => void` | If a Mesh still references the material, defers GPU teardown; otherwise destroys factory-owned buffers (iterating `ownedBufferBytes`, recording each byte release in stats) and releases the cached pipeline ref. Does **not** free `binding`, `bindings`, or `texture` resources — those are consumer-owned. Silent on stale handles. |
| `createPipeline` | `(ctx: Context, descriptor: GPURenderPipelineDescriptor) => Promise<GPURenderPipeline>` | Escape hatch: wraps `device.createRenderPipeline` in a validation error scope. Returns the raw pipeline; the caller owns it (not cached). |
| `blend` | `{ straightAlpha: GPUBlendState; premultiplied: GPUBlendState; additive: GPUBlendState }` | Frozen sugar-helper namespace (api-posture.md R6). All three values are frozen `GPUBlendState` objects; pass directly to `MaterialDescriptor.blend`. |
| `blend.straightAlpha` | `GPUBlendState` constant — color: `src=src-alpha, dst=one-minus-src-alpha, op=add`; alpha: `src=one, dst=one-minus-src-alpha, op=add` | Non-premultiplied alpha blending — the "naive" alpha-blend most beginners reach for. Compare with `blend.premultiplied` to see why production engines pre-multiply: PMA composes correctly under chained translucent overlays; straight alpha accumulates α-multiplication error visible at the seams. |
| `blend.premultiplied` | `GPUBlendState` constant — `src=one, dst=one-minus-src-alpha, op=add` for both color and alpha | Premultiplied-alpha compositing; the production default. Shader must output `vec4(rgb * a, a)`. |
| `blend.additive` | `GPUBlendState` constant — `src=one, dst=one, op=add` for both color and alpha | Additive blending; contributions sum rather than occlude. Useful for particles, glow passes, light accumulation. |
| `MaterialDescriptor<L>` | `{ shader: Shader<L>; binding?: Binding<L>; entryPoints?: { vertex?: string; fragment?: string }; bindings?: GPUBindGroupEntry[]; texture?: { texture: Texture; sampler?: SamplerParams }; primitive?: { topology?: GPUPrimitiveTopology; cullMode?: GPUCullMode }; depth?: false \| { write?: boolean; compare?: GPUCompareFunction }; blend?: GPUBlendState }` | `shader` required. `binding` — typed `@group(1)` data path; required when the shader declares a layout (unless `bindings` is supplied). The raw `bindings` path is retained for advanced use-cases. `texture` — bind a `Texture` handle + optional `SamplerParams` to `@group(1)` (sampler@0, texture-view@1) for a `textureBinding` shader; **mutually exclusive** with `binding`/`bindings`; required when the shader declares `textureBinding: true`. `entryPoints` defaults to `vs_main`/`fs_main` and is overridable. `primitive.topology` defaults to `"triangle-list"`, `cullMode` to `"back"`. `depth` omitted → depth test + write enabled (`write: true`, `compare: "less"`); `depth: false` → no depth-stencil block; `depth: { write?, compare? }` → enabled with overrides. `blend` undefined → opaque. |
| `Material<L>` | Opaque branded uint48 handle (alias of `MaterialHandle`) carrying phantom `L` | Returned by `create`. `L` records the binding layout schema; defaults to `LayoutSchema` (wide) when no typed binding is supplied. Pass to `mesh.create` and `frame.render`; dispose via `material.destroy(ctx, m)`. |

### Demoed in cookbook

- `create` (+ `shader.unlit` + `binding`, `shader.normalColor`), `destroy` → `cookbook/camera`.
- `create` (+ `shader.normalColor`, `primitive` topology/cullMode) → `cookbook/geometry`.
- `create`, `MaterialDescriptor (shader/bindings)` → `cookbook/shader` (also demos `shader.create` + `shader.source`).
- `create` (+ `shader.unlit` + `binding`), `primitive.cullMode`, `depth.write`/`depth.compare`, `blend.straightAlpha`, `blend.premultiplied`, `blend.additive` → `cookbook/blend`.
- `depth: false` (via `material.create` + `shader.unlit`/`shader.normalColor`) → `cookbook/render-target`.
- `create` (+ `MaterialDescriptor.texture`, against a consumer-authored textured shader) → `cookbook/textures`. The built-in `shader.textured` / `shader.texturedLit` material path is exercised by the hello-world bowling scene, not the cookbook.

### Reference-only (no demo, by design)

- `createPipeline` — escape hatch for consumers writing their own render system; cookbook demos use `material.create` (with caching + resource tracking) instead.

---

## `@furnace/core/texture`

`import * as texture from "@furnace/core/texture";`

GPU 2D textures (rgba8 only): create from raw pixel data or decoded bitmaps, load from a URL, destroy explicitly, and generate procedural pixel data. Textures are consumer-owned resources — the engine does not free them; pass them to `MaterialDescriptor.texture` and call `texture.destroy` when done. Live count surfaces on `stats.snapshot(ctx).resources.textures`; GPU bytes on `stats.snapshot(ctx).memory.textureBytes`.

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, descriptor: TextureDescriptor) => Promise<Texture>` | Upload rgba8 pixel data or a decoded `ImageBitmap` as a GPU texture. Two variants: `{ data: Uint8Array; width: number; height: number; colorSpace?: TextureColorSpace; mipmaps?: boolean }` or `{ source: ImageBitmap; colorSpace?: TextureColorSpace; mipmaps?: boolean }`. `colorSpace` defaults to `"srgb"` (format `rgba8unorm-srgb`); `"linear"` selects `rgba8unorm`. `mipmaps: true` generates the full mip chain (render-pass downsample). The `source` variant always adds `RENDER_ATTACHMENT` usage; the `data` variant adds it only when `mipmaps: true`. Setup-loud: throws `FurnaceError` if `data.byteLength !== width * height * 4`; throws `FurnaceError` on WebGPU validation error (surfaced via `pushErrorScope`). |
| `load` | `(ctx: Context, url: string, opts?: { colorSpace?: TextureColorSpace; mipmaps?: boolean }) => Promise<Texture>` | Fetch an image from `url`, decode it into an `ImageBitmap`, and upload it via `create({ source })`. Does **not** cache by URL — the browser HTTP-caches the bytes; reuse the returned handle to deduplicate GPU resources. Setup-loud: throws `FurnaceError` on a non-OK HTTP response; throws `FurnaceError` on GPU validation error. |
| `destroy` | `(ctx: Context, tex: Texture) => void` | Release the underlying `GPUTexture` and decrement both the texture handle count (`resources.textures`) and the GPU byte total (`memory.textureBytes`). Silent on stale or already-destroyed handles (idempotent). |
| `checkerboard` | `(opts?: { size?: number; cells?: number; colorA?: [r,g,b]; colorB?: [r,g,b] }) => ProceduralResult` | **Pure** — generate a checkerboard rgba8 pixel buffer: `cells×cells` alternating `colorA`/`colorB` squares over a `size×size` image. Defaults: `size: 256`, `cells: 8`, `colorA: [200,200,200]`, `colorB: [40,40,40]`. Returns `{ data: Uint8Array; width: number; height: number }`; pass directly to `texture.create({ data, width, height })`. |
| `uvGrid` | `(opts?: { size?: number; cells?: number; lineWidth?: number; lineColor?: [r,g,b]; background?: [r,g,b] }) => ProceduralResult` | **Pure** — generate a UV-test grid rgba8 buffer: thin `lineColor` gridlines (`lineWidth` px) every `size/cells` px over a `background`, on a `size×size` image. Defaults: `size: 256`, `cells: 8`, `lineWidth: 1`, `lineColor: [40,40,40]`, `background: [200,200,200]`. Useful for verifying filtering / anisotropy at grazing angles. Pass to `texture.create`. |
| `Texture` | Opaque branded uint48 handle (alias of `TextureHandle`) | Returned by `create` / `load`. Pass to `MaterialDescriptor.texture`; dispose via `texture.destroy(ctx, tex)`. |
| `TextureDescriptor` | discriminated union — `{ data: Uint8Array; width: number; height: number; colorSpace?: TextureColorSpace; mipmaps?: boolean } \| { source: ImageBitmap; colorSpace?: TextureColorSpace; mipmaps?: boolean }` | Input to `texture.create`. |
| `TextureColorSpace` | `"srgb" \| "linear"` | Drives the GPU format: `"srgb"` → `rgba8unorm-srgb` (default; hardware sRGB decode on sample); `"linear"` → `rgba8unorm`. Albedo/diffuse textures are sRGB; data textures (normal maps, masks) are linear. |
| `SamplerParams` | `{ magFilter?: GPUFilterMode; minFilter?: GPUFilterMode; mipmapFilter?: GPUMipmapFilterMode; addressU?: GPUAddressMode; addressV?: GPUAddressMode; maxAnisotropy?: number }` | All fields optional — omitted fields fall back to `DEFAULT_SAMPLER` (trilinear, repeat, no anisotropy). Passed via `MaterialDescriptor.texture.sampler`. No public `Sampler` handle — samplers are engine-cached and deduped per descriptor; the public escape hatch (`Sampler` handle) is deferred. AF rule: `maxAnisotropy > 1` requires `magFilter`, `minFilter`, and `mipmapFilter` all `"linear"` — `material.create` throws if violated. |
| `ProceduralResult` | `{ data: Uint8Array; width: number; height: number }` | Returned by `checkerboard`/`uvGrid`. Tightly-packed rgba8, row-major, `data.length === width * height * 4`. |

### Stats caveat

`memory.textureBytes` records **base-level bytes only** — mipmapped textures undercount by roughly 33% (the geometric-series tail). The create/destroy pair is symmetric (both record the same base-level size), so the net on teardown is always zero and leak detection is unaffected. The absolute figure is slightly low for mipmapped textures. See `docs/backlog/engine-architecture/mipmap-texture-bytes-undercount.md` for the fix shape and trigger.

### Demoed in cookbook

- `create`, `destroy`, `checkerboard`, `SamplerParams` (and `Texture`, `ProceduralResult`, `TextureDescriptor`) → `cookbook/textures`. The demo builds a procedural checkerboard with `mipmaps: true` and swaps `SamplerParams` presets (nearest / linear / linear+AF16) against a consumer-authored textured shader.

### Reference-only (no demo, by design)

- `load` — URL image loading; the cookbook demo uses `checkerboard` procedural data instead. Exercised by the hello-world bowling scene.
- `uvGrid` — UV-test grid generator; a diagnostic surface, not demoed.
- `TextureColorSpace` — the demo's checkerboard is sRGB-by-default; the `"linear"` path (data textures) has no dedicated demo yet.

---

## `@furnace/core/geometry`

`import * as geometry from "@furnace/core/geometry";`

See `engine-conventions.md` §Resource ownership for the lifecycle contract that governs geometry handles and the meshes that reference them.

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(ctx: Context, data: GeometryData, opts?: { retainForCollision?: boolean }) => Geometry` | Builds a vertex buffer (interleaved `[pos.xyz, normal.xyz, uv.uv]`, 32-byte stride) and optional index buffer from raw arrays. Validates the data. When `opts.retainForCollision` is `true`, the raw `positions` and a `Uint32Array` copy of the indices are retained CPU-side in the geometry slot so that `getCollisionData` can feed them to a physics `trimesh` collider. Throws `FurnaceError` if `positions.length` is not a multiple of 3, if `normals.length` does not equal `positions.length`, if `uvs.length` does not equal `(positions.length / 3) * 2`, or if `opts.retainForCollision` is `true` but `data.indices` is absent (a trimesh collider requires an index buffer). |
| `getCollisionData` | `(ctx: Context, geometry: Geometry) => { vertices: Float32Array; indices: Uint32Array } \| null` | Returns the retained CPU collision arrays (`positions` + `Uint32Array` indices) for a geometry built with `{ retainForCollision: true }`, or `null` if none were retained or the handle is stale. Feed the returned `{ vertices, indices }` directly to `physics.createBody` with a `{ trimesh: { vertices, indices } }` shape. |
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
| `create` | `(ctx: Context, opts: { geometry: Geometry; material: Material }) => Mesh` | Allocates the per-mesh object-uniform buffer (128 bytes — `model` + `normalMatrix`, two `mat4x4<f32>`). Position `[0,0,0]`, identity rotation, scale `[1,1,1]`. Increments the refcounts on the bound geometry and material. |
| `destroy` | `(ctx: Context, mesh: Mesh) => void` | Destroys the object buffer (recording its byte release in stats) and decrements the bound geometry/material refcounts. If either was marked-destroyed and its refcount hits zero, its GPU teardown runs as part of this call. Silent on stale handles. |
| `setPosition` | `(ctx: Context, mesh: Mesh, position: Vec3) => void` | Flips `transformDirty`. Silent no-op on stale handles. |
| `setRotation` | `(ctx: Context, mesh: Mesh, rotation: Quat) => void` | Flips `transformDirty`. Silent no-op on stale handles. |
| `setScale` | `(ctx: Context, mesh: Mesh, scale: Vec3) => void` | Flips `transformDirty`. Silent no-op on stale handles. |
| `setMaterial` | `(ctx: Context, mesh: Mesh, newMaterial: Material) => void` | Swap the bound material on a live mesh. Decrements the previous material's refcount (firing deferred GPU teardown if it was marked-destroyed and the count hits zero); increments the new material's. Validate-first: a stale new-material handle throws without touching the previous refcount. Silent no-op on stale mesh handles; no-op when the new material already matches the bound one. |
| `getPosition` | `(ctx: Context, mesh: Mesh, out: Vec3) => Vec3` | Reads the mesh's position into `out` (out-param convention). Returns `out` unchanged on stale handles. |
| `getRotation` | `(ctx: Context, mesh: Mesh, out: Quat) => Quat` | Reads the mesh's rotation quaternion into `out`. Returns `out` unchanged on stale handles. |
| `getScale` | `(ctx: Context, mesh: Mesh, out: Vec3) => Vec3` | Reads the mesh's scale into `out`. Returns `out` unchanged on stale handles. |
| `Mesh` | Opaque branded uint48 handle (alias of `MeshHandle`) | Returned by `mesh.create`. Pass to `frame.render`; mutate the bound pose only via the `setPosition` / `setRotation` / `setScale` setters; swap the bound material via `setMaterial`; dispose via `mesh.destroy(ctx, m)`. |
| `createInstanced` | `(ctx: Context, opts: { geometry: Geometry; material: Material; count: number }) => InstancedMesh` | Build an instanced draw: one geometry + material drawn `count` times in a **single** instanced draw call. Allocates two per-instance vertex buffers — a model-matrix buffer (16 floats/instance, vertex slot 1) and a tint buffer (4 floats/instance, slot 2) — initialising every instance to an identity transform and a **white** tint (the default tint lane). `count` is the fixed capacity for the life of the handle; the drawn prefix defaults to `count` (adjust with `setInstanceCount`). The material must reference an instanced shader (`shader.unlitInstanced` / `shader.litInstanced`). **Setup-loud**: validates `geometry`/`material` non-null, `count > 0`, and both handles live **before** allocating any buffer or incrementing refcounts (a late failure cannot strand a buffer or refcount). Increments the bound geometry's + material's refcounts. |
| `setInstanceTransform` | `(ctx: Context, im: InstancedMesh, i: number, position: readonly [number, number, number], rotation: readonly [number, number, number, number], scale: number) => void` | Bake instance `i`'s model matrix from a TRS pose (`T(position)·R(rotation)·S(scale)`) and mark the slot dirty. **Uniform-scale precondition**: `scale` is a single scalar applied to all three axes — non-uniform per-axis scale is unsupported by this setter (the instanced lit shader derives the world normal from `mat3(model)` + `normalize()`, with no normal matrix; use `setInstanceMatrices` to upload an arbitrary matrix). `rotation` must be a unit-length quaternion. Hot-path setter — no input validation, `i` not bounds-checked; silent no-op on stale/destroyed handles. |
| `setInstanceTint` | `(ctx: Context, im: InstancedMesh, i: number, color: readonly [number, number, number, number]) => void` | Set instance `i`'s RGBA tint (multiplied into the material's base colour/albedo by the instanced shader) and mark the slot dirty. Hot-path setter — no input validation, `i` not bounds-checked; silent no-op on stale/destroyed handles. |
| `setInstanceMatrices` | `(ctx: Context, im: InstancedMesh, matrices: Float32Array) => void` | Bulk-replace the per-instance model matrices from a packed `Float32Array` (16 floats/instance, column-major mat4) and mark dirty. Copies up to the slot's capacity (`16 * count` floats); a longer source is truncated, a shorter one leaves the trailing instances unchanged. For uploading a scatter buffer in one call instead of per-instance `setInstanceTransform`. Hot-path setter — no input validation; silent no-op on stale/destroyed handles. |
| `setInstanceCount` | `(ctx: Context, im: InstancedMesh, n: number) => void` | Set the drawn instance prefix: the next render draws instances `[0, n)` and skips the rest, without reallocating the buffers (grow/shrink the visible population up to the fixed capacity). Silent no-op on stale/destroyed handles; on a live handle the count is validated. Throws `FurnaceError` if `n` is outside `[0, count]` (the capacity fixed by `createInstanced`). |
| `destroyInstanced` | `(ctx: Context, im: InstancedMesh) => void` | Destroy both per-instance GPU buffers (recording their byte release in stats) and decrement the bound geometry/material refcounts; if either was marked-destroyed and its refcount hits zero, that resource's GPU teardown runs as part of this call. Silent on stale/already-destroyed handles (idempotent). |
| `InstancedMesh` | Opaque branded uint48 handle (alias of `InstancedMeshHandle`) | Returned by `createInstanced`. A **distinct** handle space from `Mesh` — a `Mesh` and an `InstancedMesh` can share a numerically identical handle, which is why `frame.render` keeps them in a separate `instanced` list rather than a `(Mesh | InstancedMesh)[]` union. Mutate via the per-instance setters (`setInstanceTransform` / `setInstanceTint` / `setInstanceMatrices` / `setInstanceCount`); dispose via `destroyInstanced(ctx, im)`. |

### Demoed in cookbook

- `create`, `destroy`, `setPosition` → `cookbook/camera`.
- `setRotation`, `setScale` → `cookbook/animation`.
- `setMaterial` → `cookbook/render-target` (picture-in-picture rebuild swaps the monitor mesh's material on off-screen resolution change).
- `createInstanced`, `setInstanceTransform`, `setInstanceTint`, `setInstanceCount`, `destroyInstanced`, `InstancedMesh` → `cookbook/instancing` (a grid of per-instance-tinted cubes rendered in one draw call).

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
| `wasKeyPressed` | `(code: KeyCode) => boolean` | True only on the frame the key transitioned up→down; per-frame edge, cleared by `frame.loop`. Latch for fixed-step sims (per-frame, not per-tick). |
| `wasKeyReleased` | `(code: KeyCode) => boolean` | True only on the frame the key transitioned down→up; per-frame edge, cleared by `frame.loop`. Latch for fixed-step sims (per-frame, not per-tick). |
| `onKeyDown` | `(cb: (e: KeyEvent) => void) => () => void` | Subscribe to keydown events. Returns unsubscribe. |
| `onKeyUp` | `(cb: (e: KeyEvent) => void) => () => void` | Subscribe to keyup events. Returns unsubscribe. |
| `getPointer` | `() => PointerSnapshot` | Frozen `{ x, y, xDevice, yDevice, buttons, overCanvas }`. `*Device` coords honor the canvas's backing-store DPR. |
| `isPointerButtonDown` | `(button: PointerButton) => boolean` | Snapshot read of the buttons bitmask. |
| `wasPointerButtonPressed` | `(button: PointerButton) => boolean` | True only on the frame the button transitioned up→down; per-frame edge, cleared by `frame.loop`. Latch for fixed-step sims (per-frame, not per-tick). |
| `wasPointerButtonReleased` | `(button: PointerButton) => boolean` | True only on the frame the button transitioned down→up; per-frame edge, cleared by `frame.loop`. Latch for fixed-step sims (per-frame, not per-tick). |
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
| `create` | `<L>(ctx: Context, desc: EffectDescriptor<L>) => Promise<Effect<L>>` | Registers a single-pass full-screen post-process effect — internally a one-pass `createPasses` chain (input `"prev"`, full-size, swap-chain output). The `GPURenderPipeline` (and its `@group(1)` `GPUBindGroup`) build **lazily on first render**, per resolved target colour format and cached on the pass — keyed on the shader handle + target format + blend signature (two effects sharing one `Shader` handle share the pipeline; under HDR a mid-chain pass targets the `rgba16float` intermediate while the final pass targets `ctx.format`, so it holds one pipeline variant per format). Consumes the pre-compiled `desc.shader` module; the shared fullscreen vertex shader (`vs_fullscreen`) is auto-supplied. When `desc.binding` (or a non-empty `desc.bindings`) is supplied, the `@group(1)` entries are retained and the `GPUBindGroup` is built over each pipeline variant's auto-derived layout at first render; the binding OWNS the buffer — `post.destroy` does not free it. Setup-loud (at create): throws `FurnaceGpuError` on a disposed ctx; throws `FurnaceError` if `shader` is missing, the shader handle is invalid/destroyed, the shader declares a `@group(1)` layout but neither `binding` nor a non-empty `bindings` is supplied (completeness check), or `binding` is invalid/destroyed. Pipeline-creation validation errors and `@group(1)` layout-mismatch (`binding`/`bindings` supplied but the shader declares no `@group(1)`) surface at first render, not create. |
| `createPasses` | `(ctx: Context, desc: PassesDescriptor) => Promise<Effect>` | **[PROVISIONAL name — see `docs/backlog/engine-architecture/public-api-naming-audit.md`]** Registers a declarative **multi-pass** post chain. Each `PassDescriptor` becomes one fullscreen draw whose `@group(0)` colour inputs are wired from `"scene"` / `"prev"` / named earlier-pass outputs and whose render target is a pool-backed transient (mid-chain) or the swap chain (final pass). At `frame.render`, all effects' passes flatten into one linear sequence; mid-chain targets come from the per-ctx pool (`post/pool.ts`), sized `canvas * pass.output.scale`, in `pass.output.format ?? workingColorFormat`. Pipelines build **lazily per resolved target format** (same cache + sharing rules as `create`). Setup-loud (at create): throws `FurnaceGpuError` on a disposed ctx; throws `FurnaceError` if `passes` is empty (`"needs at least one pass"`), a pass's `shader`/`binding` is invalid, or an `{ intermediate: name }` input references a name not produced by a strictly earlier pass. |
| `destroy` | `(ctx: Context, effect: Effect) => void` | Releases the cached pipeline ref across every pass of the effect (single- or multi-pass) and frees any engine-internal bindings the effect owns (the `ownedBindings` list — populated by built-in factories via `_setOwnedBindings`; empty for consumer-authored `post.create` / `post.createPasses` effects). The effect-slot count decrement is handled by the resource manager. Idempotent on stale or already-destroyed handles. Does **not** touch consumer-owned resources passed via `EffectDescriptor.binding` / `EffectDescriptor.bindings` or `PassDescriptor.binding` / `PassDescriptor.bindings` — those are consumer-destroyed. |
| `tonemap` | `(ctx: Context, opts?: { operator?: ToneMapOperator; exposure?: number }) => Promise<Effect>` | Built-in HDR→LDR fullscreen tone-map effect. Samples the engine-supplied `rgba16float` scene input at `@group(0)` and writes **linear** LDR values to `@location(0)` (no `pow(1/2.2)` — the sRGB swap-chain applies the OETF). Pass to `frame.render` via `RenderOptions.effects`. Operators: `"neutral"` (default) = Khronos PBR Neutral (CC0/Apache reference implementation, preserves saturation in mid-tones, smoothly desaturates highlights); `"reinhard"` = per-channel `c / (c + 1)`, simpler, no desaturation step. `exposure`: linear pre-tonemap multiplier (default `1`). One engine-owned tonemap shader is cached and reused per context; it is freed by `gpu.dispose(ctx)`. The `@group(1)` params binding (`{ exposure, op }` uniform buffer) is engine-owned — `post.destroy(ctx, tonemapEffect)` frees it via the `ownedBindings` mechanism (same as `post.bloom`). Setup-loud: throws on a disposed ctx or WGSL compilation failure. |
| `bloom` | `(ctx: Context, opts?: { intensity?: number; threshold?: number; softness?: number }) => Promise<Effect>` | Built-in COD/Jimenez **dual-filter bloom**, assembled on the public `createPasses` primitive. A mip pyramid (depth scales with canvas size, capped at 6 mips) of a Karis-averaged prefilter (firefly control) + plain 13-tap downsamples + 3×3 tent upsamples that accumulate each smaller mip into the next-larger one (additive **in-shader** — the smaller mip and same-level mip are read as two `@group(0)` inputs and summed; the pool acquires a fresh target per pass, so there is no in-place blend), then a composite that adds the blurred pyramid back: `scene + bloom * intensity`. **HDR-required** — place BEFORE `tonemap` in `RenderOptions.effects`. `intensity` (default `1`) scales the bloom contribution; `threshold` (default `0`) is a prefilter soft-knee brightness threshold (`0` = full energy-conserving bloom); `softness` (default `0`) is the knee width (ignored when `threshold` is `0`). The four engine-owned bloom shaders are cached per-ctx and freed by `gpu.dispose(ctx)`. The shared `@group(1)` params binding (`{ threshold, softness, intensity, radius }` uniform buffer) is engine-owned — `post.destroy(ctx, bloomEffect)` frees it via the `ownedBindings` mechanism. Setup-loud: throws `FurnaceGpuError` on a non-HDR or disposed ctx; throws on WGSL compilation failure. |
| `EffectDescriptor<L>` | `{ shader: Shader<L>; binding?: Binding<L>; bindings?: GPUBindGroupEntry[]; blend?: GPUBlendState }` | `shader` is the compiled `Shader` resource providing the fragment stage (`fs_main` entry). Sampler + scene input are bound at `@group(0)`; consumer params at `@group(1)`. `binding` — typed `@group(1)` data path; required when the shader declares a layout (unless `bindings` is supplied). The raw `bindings` path is retained for advanced use-cases. `blend` undefined → opaque. |
| `PassesDescriptor` | `{ passes: PassDescriptor[] }` | The ordered passes for `createPasses`. Must contain at least one pass (setup-loud). |
| `PassDescriptor` | `{ shader: Shader; inputs: PassInput[]; output?: PassOutput; binding?: Binding; bindings?: GPUBindGroupEntry[]; blend?: GPUBlendState }` | One pass in a `createPasses` chain. `inputs` are the `@group(0)` colour inputs in declaration order (bindings `0..N-1`; the shared sampler follows at `N`). `binding`/`bindings`/`blend` mirror `EffectDescriptor`. Multi-input (`N>1`) is supported — a composite pass binds N texture views at `@group(0) @binding(0..N-1)` then the sampler at `N` (e.g. `post.bloom`'s upsample/composite passes). |
| `PassInput` | `"scene" \| "prev" \| { intermediate: string }` | Where a pass reads its colour input: `"scene"` = the resolved scene target; `"prev"` = the previous pass's output (the scene target for the first pass); `{ intermediate: name }` = a named earlier-pass output (must be produced by a strictly earlier pass — setup-loud). |
| `PassOutput` | `{ scale?: number; format?: GPUTextureFormat; intermediate?: string }` | A pass's render-target shape. `scale` (default `1`) multiplies the canvas size; `format` (default `workingColorFormat`) overrides the target format; `intermediate` names the output for a later pass to read. The final pass always writes the full-size `ctx.format` swap chain regardless of `scale`/`format`. |
| `ToneMapOperator` | `"neutral" \| "reinhard"` | Selects the tone-mapping operator used by `post.tonemap`. `"neutral"` = Khronos PBR Neutral (recommended for PBR scenes). `"reinhard"` = classic per-channel Reinhard. |
| `Effect<L>` | `EffectHandle` (alias) carrying phantom `L` | Opaque branded uint48 handle into the per-ctx effects pool. `L` records the declared `@group(1)` layout schema when created with a typed `Binding`; defaults to `LayoutSchema` (wide). Treated as opaque by consumers — passed to `frame.render` via `RenderOptions.effects`. |

### Demoed in cookbook

- `create`, `destroy`, `Effect`, `EffectDescriptor`, `createPasses`, `PassesDescriptor`, `PassDescriptor`, `PassInput`, `PassOutput`, `tonemap`, `ToneMapOperator`, `bloom` → `cookbook/post` (HDR + tonemap operator/exposure controls + built-in `bloom` + a consumer-authored 2-pass separable blur via `createPasses`). The hello-world bowling scene also exercises `tonemap` + `bloom` on the HDR path. All are additionally covered by GPU tests (`tests/post/createpasses.gpu.test.ts`, `tests/post/multi-input.gpu.test.ts`, `tests/post/bloom.gpu.test.ts`).

---

## `@furnace/core/resources`

`import * as resources from "@furnace/core/resources";`

Cross-cutting cleanup over the per-ctx resource pools (meshes, materials, geometries, effects, shaders, bindings), plus the branded handle types and kind discriminator. The per-kind `create` / `destroy` functions live in their owning modules (`mesh.*`, `material.*`, `post.*`, `binding.*`); this module is the cross-kind surface.

Count / memory introspection lives on `stats.snapshot(ctx).resources.*` and `stats.snapshot(ctx).memory.*`.

### Public

| Export | Signature | Notes |
|---|---|---|
| `disposeAll` | `(ctx: Context) => void` | Manually trigger the resource-manager cascade — same teardown that `gpu.dispose` runs internally, but without disposing the `GPUDevice` itself. Used for explicit cleanup before context disposal (e.g. free memory during a level transition without dropping the device). Idempotent. |
| `ResourceKind` | `"mesh" \| "material" \| "geometry" \| "effect" \| "shader" \| "binding" \| "physics-world" \| "physics-body" \| "rigid-mesh" \| "texture-resource"` | Discriminator string for resource kinds. The two `physics-*` kinds back the `@furnace/core/physics` handles (`World` / `Body`); the `rigid-mesh` kind backs the `@furnace/core/rigid-mesh` composite (`RigidMesh`); `"texture-resource"` backs `Texture` handles. Note: `"buffer"` and `"texture"` are internal-only byte-tracking kinds (they drive `memory.bufferBytes` / `memory.textureBytes`) and are not included in this public union. |
| `MeshHandle` / `MaterialHandle` / `GeometryHandle` / `EffectHandle` / `ShaderHandle` / `BindingHandle` | Branded uint48 handles | Re-exported from `resources/handle.ts` so consumers can type variables (e.g. a `Map<MeshHandle, …>`) without reaching into engine-internal modules. Each is also aliased by its owning module (`mesh.Mesh`, `material.Material`, `shader.Shader`, `binding.Binding`, …) — same underlying type. |
| `AnyResourceHandle` | `MeshHandle \| MaterialHandle \| GeometryHandle \| EffectHandle \| ShaderHandle \| BindingHandle` | Cross-kind union. Useful when storing handles of mixed kinds in a single collection. |

### Demoed in cookbook

(none yet — handle-typing and `disposeAll` are scaffolding surface; cookbook demos focus on Tier 1 gameplay surface.)

### Reference-only (no demo, by design)

- `disposeAll` — explicit cascade trigger; not part of any cookbook demo.

---

## `@furnace/core/physics`

`import * as physics from "@furnace/core/physics";`

CPU-authoritative rigid-body simulation over a Rapier backend (see `docs/reference/adr/0001-physics-two-track-architecture.md`). Dynamic, static, and kinematic-position bodies with ball, cuboid, cylinder, and capsule colliders. A kinematic character controller (a movement solver for a kinematic capsule) is `World`-owned. Generic ray/shape query primitives (`castRay` / `castShape`) are available for ground/obstacle probing — consumers can build their own movement solvers (e.g. collide-and-slide) on them. Joints and the body↔mesh binding are deferred. Live `World` / `Body` counts surface on `stats.snapshot(ctx).resources.physicsWorlds` / `.physicsBodies`.

**Gate-rule (section-wide).** Every physics field is a pure pass-through to the Rapier backend — furnace performs no JS-side physics math (no inertia / center-of-mass / mass computation). Descriptor fields and setters hand their values straight to Rapier, and capability gaps (joints, …) are tracked toward a future backend, never faked. The per-row "no JS-side physics math" notes below are instances of this single rule.

### Public

| Export | Signature | Notes |
|---|---|---|
| `createWorld` | `(ctx: Context, descriptor: WorldDescriptor) => Promise<World>` | `async` — lazily runs Rapier's one-time wasm init (memoized across all worlds), then constructs the backend world + event queue. Setup-loud: throws `FurnaceError` if `gravity` is not a finite 3-component vector. |
| `step` | `(ctx: Context, world: World, dtSeconds: number) => void` | Hot-path Command — sets the backend timestep to `dtSeconds` and advances one step. Runtime-quiet: silent no-op on a stale/destroyed world. Populates the collision-event buffer drained by `drainCollisions`. |
| `drainCollisions` | `(ctx: Context, world: World) => CollisionEvent[]` | Drains begin/end contacts recorded by the most recent `step`. Returns `[]` on a stale world or when nothing collided. Events whose collider does not resolve to a live body (e.g. a body destroyed mid-step) are dropped. |
| `getDebugLines` | `(ctx: Context, world: World) => DebugLines` | Hot-path read — pass-through to Rapier's `world.debugRender()`. Returns the world's collider wireframe as `{ vertices, colors }` (flat xyz line-list + RGBA per vertex). Returns empty buffers on a stale/destroyed world. The arrays are transient — valid until the next `getDebugLines`/`step`; copy to retain. Pair with `frame.drawLines`. |
| `destroyWorld` | `(ctx: Context, world: World) => void` | Tears down every body the world owns (removing each from the still-live backend world), then frees the backend world + its event queue. Idempotent silent no-op on a stale/destroyed handle. |
| `createBody` | `(ctx: Context, world: World, descriptor: BodyDescriptor) => Body` | **Synchronous.** Builds a Rapier rigid body + collider (colliders are created event-enabled). Setup-loud: throws `FurnaceError` if the descriptor is `null`, has an unknown `type`, a non-finite `position`, or an invalid `shape`; also throws if `world` is not a live handle. |
| `destroyBody` | `(ctx: Context, body: Body) => void` | Removes the body from its world's backend simulation and frees its slot. Idempotent silent no-op on a stale/destroyed handle. |
| `getBodyTranslation` | `(ctx: Context, body: Body, out: Vec3) => Vec3` | Hot-path read of world-space translation into the **required** `out` (no per-call alloc); returns `out`. `out` is left unchanged on a stale/destroyed body. |
| `getBodyRotation` | `(ctx: Context, body: Body, out: Quat) => Quat` | Hot-path read of the world-space rotation quaternion into the **required** `out` (no per-call alloc); returns `out`. `out` is left unchanged on a stale/destroyed body. |
| `setBodyLinearVelocity` | `(ctx: Context, body: Body, v: Vec3Tuple) => void` | First hot-path body **setter**: sets the body's world-space linear velocity (a runtime "kick" — throw/jump/launch) and wakes it. Pure pass-through to Rapier `setLinvel` (no JS-side physics math). Runtime-quiet: log-warns and skips on a non-finite `v`, silent no-op on a stale/destroyed body. |
| `setBodyNextKinematicTranslation` | `(ctx: Context, body: Body, pos: readonly [number, number, number]) => void` | Hot-path body **setter** for `kinematicPosition` bodies: queues the next world-space translation, applied by the following `step`. Pure pass-through to Rapier `setNextKinematicTranslation` (no JS-side physics math). Runtime-quiet: log-warns and skips on a non-finite `pos`, silent no-op on a stale/destroyed body. |
| `createCharacterController` | `(ctx: Context, world: World, opts?: CharacterControllerOptions) => CharacterController` | Creates a kinematic character controller (a movement solver for a kinematic capsule) owned by `world`. Each `opts` field is a pure pass-through to the matching Rapier `KinematicCharacterController` setter (`setUp`, `enableAutostep`, `enableSnapToGround`, `setMaxSlopeClimbAngle`, `setMinSlopeSlideAngle`, `setSlideEnabled`, `setApplyImpulsesToDynamicBodies`, `setCharacterMass`); omitted fields keep Rapier's defaults. Setup-loud: throws `FurnaceError` if `world` is not a live handle, or if `offset` is non-positive/non-finite. |
| `destroyCharacterController` | `(ctx: Context, controller: CharacterController) => void` | Removes the controller from its world's backend and tracking set. Idempotent silent no-op on an already-destroyed controller or a stale world. Controllers left live when their world is destroyed are cleaned up by `destroyWorld` (no leak). |
| `computeMovement` | `(ctx: Context, controller: CharacterController, body: Body, desired: readonly [number, number, number], out: Vec3) => boolean` | Hot-path: resolves a kinematic capsule's `desired` translation against the world's colliders (Rapier `computeColliderMovement` → `computedMovement`), writing the corrected slide/blocked movement into the **required** `out` and returning whether the body is grounded (`computedGrounded`). Obstacles come from Rapier's query structures, populated by `step` — query after the world has stepped. Apply `out` via `setBodyNextKinematicTranslation`, then `step`. Runtime-quiet: log-warns and returns `false` with zeroed `out` on a non-finite `desired`; silent `false` + zeroed `out` on a destroyed controller or stale body/world. |
| `castRay` | `(ctx: Context, world: World, opts: CastRayOptions) => RayHit \| null` | Query primitive — casts a ray and returns the nearest hit `{ toi, point, normal, body }` within `maxDistance`, else `null`. Wraps Rapier `castRayAndGetNormal`; `dir` is normalised internally (a zero-length `dir` yields a miss); `excludeBody` omits the caller's own collider. Obstacles come from Rapier's query structures, populated by `step` — query after the world has stepped. Setup-loud: throws `FurnaceError` on a non-finite/negative `maxDistance`. Runtime-quiet: `null` on a stale/destroyed world. |
| `castShape` | `(ctx: Context, world: World, opts: CastShapeOptions) => RayHit \| null` | Query primitive — sweeps a convex `shape` (ball/cuboid/capsule/cylinder) from `position` along `dir` and returns the nearest hit `{ toi, point, normal, body }` within `maxDistance`, else `null`. Wraps Rapier `castShape`; the returned `normal` (Rapier `normal1`) opposes travel — suitable for collide-and-slide projection. `rotation` defaults to identity; `excludeBody` omits the caller's collider. Setup-loud: throws `FurnaceError` on a non-finite/negative `maxDistance` or a non-castable shape (trimesh). Runtime-quiet: `null` on a stale/destroyed world. |
| `WorldDescriptor` | `{ gravity: readonly [number, number, number]; lengthUnit?: number }` | Gravity vector for the world (e.g. `[0, -9.81, 0]`). `lengthUnit` = approximate size in world units of a 1-meter object; scales the backend solver's length tolerances for non-meter-scale scenes (sub-meter objects jitter at the default). Optional — furnace forwards its own meter-scale default (`1`) when omitted, so the backend's own default is never relied upon. |
| `BodyDescriptor` | `{ type: "dynamic" \| "static" \| "kinematicPosition"; shape: ShapeDescriptor; position: readonly [number, number, number]; rotation?: readonly [number, number, number, number]; linearVelocity?: readonly [number, number, number]; angularVelocity?: readonly [number, number, number]; density?: number; friction?: number; restitution?: number; linearDamping?: number; angularDamping?: number }` | `rotation` is an `[x,y,z,w]` quaternion, defaults to identity. `linearVelocity` defaults to zero and is only meaningful for `dynamic` bodies (static and kinematicPosition bodies don't integrate velocity). `angularVelocity` is radians/sec about `x,y,z`, defaults to zero, and is likewise `dynamic`-only. `density` defaults to `1` (drives dynamic mass). `friction`, `restitution`, `linearDamping`, `angularDamping` are pass-through rigid-body material scalars: `friction` is the Coulomb coefficient, `restitution` is bounciness in `[0,1]` (`0` = no bounce), `linearDamping`/`angularDamping` are per-second velocity decay. All four are optional and forwarded straight to Rapier (no JS-side physics math). `kinematicPosition` bodies are not integrated by gravity; their pose is driven externally via `setBodyNextKinematicTranslation`. |
| `ShapeDescriptor` | `{ ball: number } \| { cuboid: readonly [number, number, number] } \| { cylinder: { halfHeight: number; radius: number } } \| { capsule: { halfHeight: number; radius: number } } \| { trimesh: { vertices: Float32Array; indices: Uint32Array } } \| { voxels: { coords: Int32Array; size: readonly [number, number, number] } }` | `ball` = sphere radius; `cuboid` = box half-extents; `cylinder` = Y-axis-aligned half-height + radius (same Y axis as `geometry.cylinder`, whose `height` = `2 × halfHeight`). Backed by Rapier's round-cylinder for solver robustness; the requested `halfHeight`/`radius` are the true outer dimensions. `capsule` = Y-axis-aligned half-height + radius (the player shape). `trimesh` = flat triangle-soup for static level geometry: `vertices` xyz-packed, `indices` u32 triples; requires `indices.length % 3 === 0` and both arrays non-empty (validated by `createBody`). **For static or kinematic bodies only** — trimesh has no interior volume so a `dynamic` body with a trimesh collider produces undefined solver behaviour. Obtain the arrays from `geometry.getCollisionData` when using a mesh-resource geometry. `voxels` = a set of solid grid cells for static (or kinematic) level geometry: `coords` are signed integer grid coordinates, 3 ints per solid voxel (`coords.length % 3 === 0`, non-empty, validated by `createBody`); `size` is the per-axis world size of one voxel. Wraps Rapier's purpose-built voxel collider — sparse storage, and **free of the `trimesh` internal-edge ghost-collision artifact** across shared voxel faces (the reason field-derived level geometry uses it). **Static/kinematic only**, same as `trimesh`. |
| `CastRayOptions` | `{ origin: Vec3Tuple; dir: Vec3Tuple; maxDistance: number; excludeBody?: Body }` | Input for `castRay`. `dir` need not be normalised; `excludeBody` excludes that body's collider from the cast. |
| `CastShapeOptions` | `{ shape: ShapeDescriptor; position: Vec3Tuple; rotation?: QuatTuple; dir: Vec3Tuple; maxDistance: number; excludeBody?: Body }` | Input for `castShape`. `shape` must be convex (ball/cuboid/capsule/cylinder — trimesh is not castable). `rotation` defaults to identity `[0,0,0,1]`. |
| `RayHit` | `{ toi: number; point: [number, number, number]; normal: [number, number, number]; body: Body \| null }` | Result of `castRay`/`castShape`: `toi` = distance along `dir` to the hit; `point` = world-space hit point; `normal` = world-space surface normal at the hit; `body` = the hit body, or `null` if the hit collider has no tracked body (resolved from the world's collider→body map). |
| `Vec3Tuple` | `readonly [number, number, number]` | Plain 3-tuple alias used across the descriptor inputs (`position`, `linearVelocity`, `angularVelocity`, `cuboid`). Re-exported for consumers building descriptor literals. |
| `QuatTuple` | `readonly [number, number, number, number]` | Plain `[x,y,z,w]` quaternion-tuple alias for `rotation`. Re-exported for consumers building descriptor literals. |
| `CollisionEvent` | `{ a: Body; b: Body; started: boolean }` | A contact begin (`started: true`) or end (`started: false`) between bodies `a` and `b`. |
| `DebugLines` | `{ vertices: Float32Array; colors: Float32Array }` | Collider wireframe line data (value-type). |
| `World` | Opaque branded uint48 handle (alias of `PhysicsWorldHandle`) | Owns the backend world + its bodies + event queue. Dispose via `physics.destroyWorld` or the resource-manager cascade (`gpu.dispose` / `resources.disposeAll`). |
| `Body` | Opaque branded uint48 handle (alias of `PhysicsBodyHandle`) | A rigid body inside a `World`. Dispose via `physics.destroyBody`, by destroying its owning `World`, or by the cascade. |
| `CharacterController` | Opaque object handle (treat as opaque — engine-internal fields are underscore-prefixed) | A kinematic character controller owned by its `World` (a world-bounded helper, not a resource-pool handle). Dispose via `physics.destroyCharacterController` or by destroying its owning `World`. |
| `CharacterControllerOptions` | `{ offset?: number; up?: readonly [number, number, number]; autostep?: { maxHeight: number; minWidth: number; includeDynamic?: boolean }; snapToGround?: number; maxSlopeClimbAngle?: number; minSlopeSlideAngle?: number; slide?: boolean; applyImpulsesToDynamicBodies?: boolean; characterMass?: number }` | All optional. `offset` = skin-width solving gap (default `0.01`). `up` = up axis (default `[0,1,0]`). `autostep` auto-steps over ledges up to `maxHeight` for gaps ≥ `minWidth` (`includeDynamic` defaults `true`). `snapToGround` keeps ground contact within the given distance. `maxSlopeClimbAngle` / `minSlopeSlideAngle` are slope thresholds in radians. `slide` slides along blocking geometry instead of stopping (Rapier default on). `applyImpulsesToDynamicBodies` pushes dynamic rigid-bodies the character collides with (default Rapier off — required to shove props). `characterMass` sets the character mass used for impulse resolution when `applyImpulsesToDynamicBodies` is on (omit to use the character body's own mass; tune for shove strength). Omitted fields keep Rapier's defaults (slide on, autostep/snap-to-ground/impulses off). |

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

## `@furnace/core/rng`

`import * as rng from "@furnace/core/rng";`
(types: `import type { Rng } from "@furnace/core/rng";`)

Deterministic, seeded pseudo-random number generators — replay-safe randomness for procedural generation. The same seed always produces the same sequence on every machine (no `Math.random` / `Date`). The algorithm is **sfc32** seeded via splitmix32; string seeds are hashed with xmur3. All state is 32-bit (no BigInt), so determinism is exact across JS engines.

### Public

| Export | Signature | Notes |
|---|---|---|
| `create` | `(seed: number \| string) => Rng` | Create a deterministic `Rng` from a numeric or string seed. A numeric seed is masked to 32 bits (unsigned). A string seed is hashed with xmur3. Calling `create` with the same seed value always returns an independent generator in the same initial state — seed, don't share. |
| `Rng` | `{ float(): number; int(minInclusive, maxExclusive): number; bool(probability?): boolean; pick<T>(items): T; derive(label): Rng }` | The RNG interface. All methods advance the generator state. `float` returns a value in `[0, 1)`. `int` returns an integer in `[minInclusive, maxExclusive)` — throws `FurnaceError` if `maxExclusive <= minInclusive`. `bool` returns `true` with the given `probability` (default `0.5`) — throws `FurnaceError` if `probability` is outside `[0, 1]`. `pick` returns a uniformly-chosen element — throws `FurnaceError` on an empty array. `derive` returns a child `Rng` seeded deterministically from the parent seed + `label` string, so subsystems (e.g. geometry vs props) can draw from isolated, non-desyncing streams; a change to one subsystem's draws does not shift another's. |

### Reference-only (no demo, by design)

- `create`, `Rng` — substrate for procedural generation (dungeon regions, field sampling); no dedicated cookbook demo. Exercised by the dungeon's field + mesher pipeline.

---

## `@furnace/core/scene`

`import { loadScene, encodeMeshBlob, decodeMeshBlob, defineComponent, defineResource } from "@furnace/core/scene";`
(types: `import type { SceneDocument, LoadedScene, LoadSceneOptions, MeshBlob, SceneSettings, EntityDoc, LoadSceneOptions } from "@furnace/core/scene";`)

The scene format: a text-JSON document (`SceneDocument`) with typed resource tables and entity component lists, validated by a consumer-extensible registry, loaded by `loadScene` into live engine objects. Built-in resource kinds and components register automatically at module import.

### Public

| Export | Signature | Notes |
|---|---|---|
| `loadScene` | `(ctx: Context, doc: SceneDocument, opts?: LoadSceneOptions) => Promise<LoadedScene>` | Validate the document against the registry, build resources in fixed table order (`geometries → textures → shaders → materials → effects`), instantiate entity components in registration order with pre-resolved resource refs, and return the scene's render inputs + a `destroy` that frees everything this call created. A failed load tears down everything it already built (no leaks). Throws `FurnaceError` on validation failure, unknown resource kind, or (unless `opts.fragment` is set) a document with no camera entity. With `opts.world`, builds rigid bodies into an existing world (the world is NOT destroyed by the returned `destroy`); without it, a physics world is lazily created and owned by the loaded scene. With `opts.fragment`, suppresses the missing-camera error — the caller owns the camera (used for region fragments: mesh + bodies, no camera). |
| `LoadSceneOptions` | `{ world?: World; fragment?: boolean }` | Options for `loadScene`. `world` injects an existing `World` so the loader builds rigid bodies into it without creating a new one. `fragment` suppresses the missing-camera guard (for documents that contain geometry + bodies but no camera entity). |
| `encodeMeshBlob` | `(blob: MeshBlob) => ArrayBuffer` | Encode a `MeshBlob` to a self-describing little-endian `ArrayBuffer` (the `.fmesh` format). Layout: `magic(4) + headerByteLen(4) + UTF-8 JSON header (padded to 4-byte alignment) + 4-byte-aligned typed-array regions (render first, then optional collision)`. Browser-safe: uses only `DataView`, `TextEncoder`, and typed arrays. |
| `decodeMeshBlob` | `(buf: ArrayBuffer) => MeshBlob` | Decode an `ArrayBuffer` produced by `encodeMeshBlob`. Throws `FurnaceError` if the magic number does not match (`"not a .fmesh buffer"`). |
| `MeshBlob` | `{ render: { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array }; collision?: { vertices: Float32Array; indices: Uint32Array } }` | The in-memory representation of a `.fmesh` sidecar: render buffers (positions, normals, uvs, u32 indices) plus optional collision geometry (xyz positions + u32 indices). The `collision` block is consumed by `geometry.create(..., { retainForCollision: true })` for physics trimesh support. |
| `SceneDocument` | `{ version: number; settings?: SceneSettings; resources?: { geometries?, textures?, shaders?, materials?, effects? }; entities: EntityDoc[] }` | Text-JSON shape of a serialized scene. Resource entries and component entries are open (`unknown`) — the registry is the authority on what is valid; `validateDocument` proves every entry at the load boundary. |
| `SceneSettings` | `{ clearColor?, ambient?, post?, gravity?, lengthUnit?, sim?, msaa?, hdr?, region? }` | Scene-level render/world globals. `region` (added in Slice 2.1) carries optional provenance + theme + origin metadata for baked region documents: `{ provenance?: { generatorId, generatorVersion, seed, kind }; theme?: string; origin?: [x,y,z] }`. Loaded into `LoadedScene.settings`; the loader validates and carries all fields but does not act on `region` (it is metadata for the consumer and for bake tooling). |
| `validateDocument` | `(doc: SceneDocument) => void` | Validate a document against the registry without loading it (throws `FurnaceError` on any invalid entry). Side-effect-free — does not build any resources. |
| `defineComponent` | `(name: string, def: ComponentDefinition) => void` | Register a custom component type with the scene loader. See `registry.ts` for the `ComponentDefinition` shape. |
| `defineResource` | `(table: TableName, kind: string, def: ResourceDefinition) => void` | Register a custom resource kind in one of the five resource tables. |
| `introspect` | `() => SceneSchemaReflection` | Reflect the full registry (built-in + consumer-registered components and resource kinds) as JSON-Schema. Used by the editor inspector. |
| `EntityDoc` | `{ id: string; components: Record<string, unknown> }` | A scene entity: stable string `id` + a map of typed components. |
| `LoadedScene` | includes `meshes, camera, lights, ambient?, effects, world?, settings, destroy, rebuildEntity, setSettings, entityBoxCorners, setEntityTransform, pick` | The live result of `loadScene`. `destroy()` frees everything the call created (reverse build order). `rebuildEntity(id, doc)` is the editor live-preview seam — transactional swap of one entity's components. `pick(ctx, cam, ndcX, ndcY)` is GPU id-buffer viewport picking. See `types.ts` for full shape. |

#### Built-in geometry resource kinds

| Kind | Params | Notes |
|---|---|---|
| `"cube"` | `{}` | Axis-aligned unit cube. |
| `"sphere"` | `{ radius? }` | UV sphere, radius defaults `0.5`. |
| `"cylinder"` | `{ radius?, height? }` | Y-axis cylinder, radius `0.5`, height `1`. |
| `"plane"` | `{ size? }` | `+Z`-facing quad, size defaults `1`. |
| `"mesh"` | `{ src: string }` | Fetches a `.fmesh` binary from `src` (URL or relative path), decodes it via `decodeMeshBlob`, and creates a geometry with `{ retainForCollision: true }` — so a sibling `rigidBody.shape.trimesh` can pull the collision arrays directly. Throws `FurnaceError` on a non-OK HTTP response or bad magic. |

#### Built-in entity components

| Component | Shape | Notes |
|---|---|---|
| `transform` | `{ position?, rotation?, scale? }` | Local TRS. `rotation` is `[x,y,z,w]` quaternion; omitted fields keep identity defaults. |
| `meshRenderer` | `{ geometry: ref, material: ref }` | Renders the entity. Deferred to a sibling `rigidBody` when one is present (the `rigidBody` builder owns the mesh in that case). |
| `camera` | `{ kind: "perspective", aspect, fovYRad?, near?, far? }` | One camera per scene (a second throws at load). Pose from sibling `transform`. |
| `light` | `{ type: "directional" \| "point" \| "spot", ... }` | See `frame.Light` for per-type fields. Pose from sibling `transform`. |
| `rigidBody` | `{ type: "static" \| "dynamic", shape: { cuboid?, ball?, cylinder?, trimesh? }, friction?, ... }` | Builds a `rigidMesh` composite (owns the mesh) and adds the body to the scene world. `shape.trimesh: true` (boolean flag) — when set, reads the collision arrays from `geometry.getCollisionData` on the sibling `meshRenderer`'s geometry (requires the geometry to have been built with `{ retainForCollision: true }`, i.e. from a `"mesh"` resource). Throws `FurnaceError` if `trimesh: true` but the geometry has no retained collision data. |

### Reference-only (no demo, by design)

- `encodeMeshBlob` / `decodeMeshBlob` / `MeshBlob` — the `.fmesh` codec; used by region bake tooling, not a general cookbook topic.
- `defineComponent` / `defineResource` / `introspect` — extension and reflection surface; used by the editor.
- `validateDocument` — load-boundary guard; consumers call `loadScene` which runs it internally.

---

## `@furnace/core/field`

**v0 (One Field F1+F2a, 2026-07-16) — the surface is deliberately minimal and UNSTABLE;
the per-export documentation pass + cookbook demo land at F2b when the API stabilizes (a
One Field charter decision — this row exists so the module is not invisible here).**

The chunked sparse voxel field: 16³ Int8 density chunks (air-positive, solid-by-default,
uniform chunks elided — untouched world costs nothing) plus a per-chunk **material
channel** (uniform|indexed palette encoding behind accessors — `getMaterial` /
`setMaterial`, `MAT_ROCK` default; `MaterialTable` from the project catalog,
`BUILTIN_TABLE` rock-only fallback, `validateMaterialTable`/`classOf`). Store + coords
(`createFieldStore`, `getDensity`/`setDensity`, `extractFieldAprons` — the 20³
density+material window), **brush ops** dig/fill/paint with kit lattice validation
(`BrushOp`, `assertOpValid`, `applyOp`, `logApply`, two-channel chunk-keyed undo/redo),
chunked Surface Nets over the 20³ aprons with owned-crossing quads bucketed per
owning-cell class incl. the kit **backing** surface (`meshChunkField` — watertight seams
by construction), the generic **kit skinner** on the derived coarse view (`skinChunkKit`
— panels/tiles/posts/collar from catalog kit-style data), voxel DDA (`raycastField`),
per-chunk shell colliders (`chunkColliders` — density-only, material classes never
affect collision), and the artifact (`encodeChunkFile`/`decodeChunkFile`,
`encodeMaterialFile`/`decodeMaterialFile`, oplog serialize/parse with F1 legacy-op
mapping, `bakeFieldWorld` — pure; the manifest embeds the resolved material table).
TSDoc on every export (`check:tsdoc` covers the module automatically). Consumers today:
the editor's FieldHost + remesh worker, and the dungeon's v2 field-world loader.

---

## Tier 1 surface NOT in the public API

These appear in module source files but are NOT exported, OR are exported with a leading `_` to mark them internal-only:

- Internal `_*` stats hooks (table above in `@furnace/core/stats`).
- Shader's internal `_createShader` (in `shader/shader.ts`, used by `create`, `load`, and the built-in shader factories). The built-in shader factories (`unlit` / `lit` / `normalColor` / `textured` / `texturedLit`) are now public — see the `@furnace/core/shader` Public table above.
- Texture's internal `_formatOf` / `_mipLevelCountOf` (in `texture/texture.ts`): test-only helpers that read the backing `GPUTextureFormat` / `mipLevelCount`; not exported from `texture/index.ts`, not part of the consumer surface.
- Texture's internal `_getSampler` (in `texture/sampler-cache.ts`): resolves `SamplerParams` → a cached `GPUSampler`; called by `material.create`. Not exported from `texture/index.ts`.
- Texture's internal `_generateMipmaps` / `_mipLevelCount` (in `texture/mipmap.ts`): the render-pass mipmap blit kernel and level-count formula; called by `texture.create`. Not exported from `texture/index.ts`.
- Material's internal `_pipelineCache` (a facade in `material/pipeline.ts` over `acquireMaterialPipeline` / `releaseMaterialPipeline` on the per-ctx `ResourceManager`), `_blendSignature` (in `material/material.ts`), and `_resolveMaterial` (in `material/internal.ts`, used by `frame/render*`). None re-exported from `material/index.ts`.
- Post's internal `_pipelineCache` (a facade in `post/pipeline-cache.ts` over `acquirePostPipeline` / `releasePostPipeline` on the per-ctx `ResourceManager`), `_resolvePassPipeline` + `_effectTeardown` (in `post/effect.ts`, used by `frame/render.ts` and `post/passes.ts`), `_ensureFullscreenVS` (in `post/fullscreen.ts`), `_effectPipelineHashKey` / `_buildEffectPipelineDescriptor` (in `post/pipeline.ts`), the transient-target pool `_acquirePoolTarget` / `_releasePoolTarget` / `_poolStats` (in `post/pool.ts`), and `_ensurePostSampler` (in `post/post-sampler.ts`). None re-exported from `post/index.ts`.
- Frame's internal `_frameRenderInternals` in `frame/render.ts` — a bundle of `{ _ensureDepthTexture, _ensureCameraBuffer, _ensureMeshGroup0 }` consumed by `frame/render-to-texture.ts`. Not re-exported from `frame/index.ts`.
- Mesh's internal `_recomputeModelIfDirty` in `mesh/mesh.ts`, called by `frame/render.ts` and `frame/render-to-texture.ts` per draw. Not re-exported from `mesh/index.ts`.

These are accessed only by other core modules. If consumer code is reaching for one, that is a signal to either (a) export it as a documented public escape hatch or (b) extend the public API to cover the use case.

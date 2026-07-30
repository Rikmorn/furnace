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
| `render` | `(ctx: Context, opts: RenderOptions) => void` | One-shot render pass. Allocates a depth texture and per-camera uniform buffer lazily, sets up `group(0)`, and records draws in a fixed **blend-partitioned order** (F2b): opaque `meshes` → opaque `instanced` groups → blended `meshes` → blended `instanced` (blended = the material carries a `blend` state; submission order preserved within each group — painter's order for translucents, no per-depth sorting). Each `instanced` group is **one** instanced draw call sourcing per-instance model matrix + tint from its instance vertex buffers. If `opts.effects` is non-empty, evaluates the flattened post chain through pool-backed transient targets to the swap chain. |
| `drawLines` | `(ctx: Context, opts: DrawLinesOptions) => void` | Immediate `line-list` overlay (Command). Draws `opts.vertices` (flat xyz line-list) colored per-vertex by `opts.colors` (RGBA), transformed by `opts.camera`, as a second pass composited over the current frame against the scene depth with no depth write. **MSAA-aware (F2b):** on a `sampleCount: 1` context it targets the swap-chain view directly (`loadOp:"load"`); on a `sampleCount: 4` context it renders into the stored MSAA scene color target and resolves to the swap chain (the effects-less scene pass stores its MSAA color + depth for exactly this — pre-F2b this combination built an invalid pass and every line overlay was silently dropped, see `docs/learnings/2026-07-21-invisible-line-overlays.md`). **Documented limitation:** MSAA + a non-empty post chain + `drawLines` is unsupported — the resolve would clobber post output — and is a once-per-context warn + skip, never frame corruption. Depth mode is set by `opts.occlude` (default `true`): `true` → `depthCompare:"less-equal"` (occluded behind nearer meshes — physics wireframes, AABB highlights); `false` → `depthCompare:"always"` (always-on-top — gizmos). Call after `frame.render` in the same frame. Pipelines (per depth mode, at the context's multisample count) + grow-on-demand buffers are engine-owned per context. Warm-path-validate: throws on disposed ctx / null camera / null arrays; empty `vertices` → no-op. |
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

**Context rule (section-wide, F4).** Every entry point below takes a `PhysicsContext`, not a `Context`. A full `Context` from `gpu.requestContext` is assignable to it, so the ordinary path is unchanged and needs no thought; `createHeadlessPhysicsContext` supplies one where `requestContext` cannot run. The widening is type-level only — no signature gained or lost an argument, and no body changed.

### Public

| Export | Signature | Notes |
|---|---|---|
| `createWorld` | `(ctx: PhysicsContext, descriptor: WorldDescriptor) => Promise<World>` | `async` — lazily runs Rapier's one-time wasm init (memoized across all worlds), then constructs the backend world + event queue. Setup-loud: throws `FurnaceError` if `gravity` is not a finite 3-component vector. |
| `step` | `(ctx: PhysicsContext, world: World, dtSeconds: number) => void` | Hot-path Command — sets the backend timestep to `dtSeconds` and advances one step. Runtime-quiet: silent no-op on a stale/destroyed world. Populates the collision-event buffer drained by `drainCollisions`. |
| `drainCollisions` | `(ctx: PhysicsContext, world: World) => CollisionEvent[]` | Drains begin/end contacts recorded by the most recent `step`. Returns `[]` on a stale world or when nothing collided. Events whose collider does not resolve to a live body (e.g. a body destroyed mid-step) are dropped. |
| `getDebugLines` | `(ctx: PhysicsContext, world: World) => DebugLines` | Hot-path read — pass-through to Rapier's `world.debugRender()`. Returns the world's collider wireframe as `{ vertices, colors }` (flat xyz line-list + RGBA per vertex). Returns empty buffers on a stale/destroyed world. The arrays are transient — valid until the next `getDebugLines`/`step`; copy to retain. Pair with `frame.drawLines`. |
| `destroyWorld` | `(ctx: PhysicsContext, world: World) => void` | Tears down every body the world owns (removing each from the still-live backend world), then frees the backend world + its event queue. Idempotent silent no-op on a stale/destroyed handle. |
| `createBody` | `(ctx: PhysicsContext, world: World, descriptor: BodyDescriptor) => Body` | **Synchronous.** Builds a Rapier rigid body + collider (colliders are created event-enabled). Setup-loud: throws `FurnaceError` if the descriptor is `null`, has an unknown `type`, a non-finite `position`, or an invalid `shape`; also throws if `world` is not a live handle. |
| `destroyBody` | `(ctx: PhysicsContext, body: Body) => void` | Removes the body from its world's backend simulation and frees its slot. Idempotent silent no-op on a stale/destroyed handle. |
| `getBodyTranslation` | `(ctx: PhysicsContext, body: Body, out: Vec3) => Vec3` | Hot-path read of world-space translation into the **required** `out` (no per-call alloc); returns `out`. `out` is left unchanged on a stale/destroyed body. |
| `getBodyRotation` | `(ctx: PhysicsContext, body: Body, out: Quat) => Quat` | Hot-path read of the world-space rotation quaternion into the **required** `out` (no per-call alloc); returns `out`. `out` is left unchanged on a stale/destroyed body. |
| `setBodyLinearVelocity` | `(ctx: PhysicsContext, body: Body, v: Vec3Tuple) => void` | First hot-path body **setter**: sets the body's world-space linear velocity (a runtime "kick" — throw/jump/launch) and wakes it. Pure pass-through to Rapier `setLinvel` (no JS-side physics math). Runtime-quiet: log-warns and skips on a non-finite `v`, silent no-op on a stale/destroyed body. |
| `setBodyNextKinematicTranslation` | `(ctx: PhysicsContext, body: Body, pos: readonly [number, number, number]) => void` | Hot-path body **setter** for `kinematicPosition` bodies: queues the next world-space translation, applied by the following `step`. Pure pass-through to Rapier `setNextKinematicTranslation` (no JS-side physics math). Runtime-quiet: log-warns and skips on a non-finite `pos`, silent no-op on a stale/destroyed body. |
| `createCharacterController` | `(ctx: PhysicsContext, world: World, opts?: CharacterControllerOptions) => CharacterController` | Creates a kinematic character controller (a movement solver for a kinematic capsule) owned by `world`. Each `opts` field is a pure pass-through to the matching Rapier `KinematicCharacterController` setter (`setUp`, `enableAutostep`, `enableSnapToGround`, `setMaxSlopeClimbAngle`, `setMinSlopeSlideAngle`, `setSlideEnabled`, `setApplyImpulsesToDynamicBodies`, `setCharacterMass`); omitted fields keep Rapier's defaults. Setup-loud: throws `FurnaceError` if `world` is not a live handle, or if `offset` is non-positive/non-finite. |
| `destroyCharacterController` | `(ctx: PhysicsContext, controller: CharacterController) => void` | Removes the controller from its world's backend and tracking set. Idempotent silent no-op on an already-destroyed controller or a stale world. Controllers left live when their world is destroyed are cleaned up by `destroyWorld` (no leak). |
| `computeMovement` | `(ctx: PhysicsContext, controller: CharacterController, body: Body, desired: readonly [number, number, number], out: Vec3) => boolean` | Hot-path: resolves a kinematic capsule's `desired` translation against the world's colliders (Rapier `computeColliderMovement` → `computedMovement`), writing the corrected slide/blocked movement into the **required** `out` and returning whether the body is grounded (`computedGrounded`). Obstacles come from Rapier's query structures, populated by `step` — query after the world has stepped. Apply `out` via `setBodyNextKinematicTranslation`, then `step`. Runtime-quiet: log-warns and returns `false` with zeroed `out` on a non-finite `desired`; silent `false` + zeroed `out` on a destroyed controller or stale body/world. |
| `castRay` | `(ctx: PhysicsContext, world: World, opts: CastRayOptions) => RayHit \| null` | Query primitive — casts a ray and returns the nearest hit `{ toi, point, normal, body }` within `maxDistance`, else `null`. Wraps Rapier `castRayAndGetNormal`; `dir` is normalised internally (a zero-length `dir` yields a miss); `excludeBody` omits the caller's own collider. Obstacles come from Rapier's query structures, populated by `step` — query after the world has stepped. Setup-loud: throws `FurnaceError` on a non-finite/negative `maxDistance`. Runtime-quiet: `null` on a stale/destroyed world. |
| `castShape` | `(ctx: PhysicsContext, world: World, opts: CastShapeOptions) => RayHit \| null` | Query primitive — sweeps a convex `shape` (ball/cuboid/capsule/cylinder) from `position` along `dir` and returns the nearest hit `{ toi, point, normal, body }` within `maxDistance`, else `null`. Wraps Rapier `castShape`; the returned `normal` (Rapier `normal1`) opposes travel — suitable for collide-and-slide projection. `rotation` defaults to identity; `excludeBody` omits the caller's collider. Setup-loud: throws `FurnaceError` on a non-finite/negative `maxDistance` or a non-castable shape (trimesh). Runtime-quiet: `null` on a stale/destroyed world. |
| `createHeadlessPhysicsContext` | `() => PhysicsContext` | **Escape hatch** — a `PhysicsContext` with no GPU behind it, for callers that need physics where `requestContext` cannot run (a plain unit test, a Web Worker, a headless probe). The ordinary path is to pass the `Context` from `gpu.requestContext`. Valid for `@furnace/core/physics` only: the returned value has no `device`/`queue`/`canvas`/`format`/`pixelRatio`, so handing it to a `gpu`/`mesh`/`material`/`frame` function is a compile error, not a runtime failure. Frozen, holds no GPU objects. Takes the next id from the SAME per-realm counter `gpu.requestContext` draws from, so headless and GPU contexts stay distinct across a realm's first 65535 contexts (ids are 16 bits and recycle beyond that) — one context per session, not one per query. **No dispose:** `gpu.dispose` takes a full `Context` and there is no headless equivalent; the context's own state is ordinary JS and is collected with the last reference. Still call `destroyWorld` on each world — that is what frees the Rapier wasm allocations *promptly*. Skipping it is not an unbounded leak (rapier's wasm-bindgen glue registers a `FinalizationRegistry`) but finalization is non-deterministic. |
| `PhysicsContext` | `Pick<Context, "_internal">` | The structural slice of `Context` this module actually uses — engine-internal state, nothing GPU-owned — and the first argument of every function above. A full `Context` is assignable, so `requestContext` → `physics.*` needs no thought; the type exists so a caller with no GPU can get one from `createHeadlessPhysicsContext`. It is deliberately NOT interchangeable in the other direction: with no `device`/`queue`/`canvas`/`format`/`pixelRatio`, passing a `PhysicsContext` to a `gpu`/`mesh`/`material`/`frame` function fails to compile. |
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

### Reference-only (no demo, by design)

- `createHeadlessPhysicsContext` / `PhysicsContext` — the no-GPU escape hatch. A cookbook demo has a `Context` by construction, so there is nothing for it to show; the surface exists for tests, workers, and headless probes.

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

**Graduated at the F2b seal (2026-07-21): documented surface** — TSDoc on every export
(`check:tsdoc` enforced) is the per-export contract; this section is the grouped map.
The cookbook `field` demo (`packages/cookbook/src/demos/field/`) proves the public API
stands alone: dig + flat-floor fill + paint + snapped masonry fill → mesh buckets + kit
skin, plus an `analyzeChunk` pass whose flags are drawn as floor markers, rendered with
no editor imports. Consumers today: the editor's FieldHost + remesh worker, the
dungeon's v2 field-world loader, and the cookbook demo.

The chunked sparse voxel field: 16³ Int8 density chunks (air-positive, solid-by-default,
uniform chunks elided — untouched world costs nothing) plus a per-chunk **material
channel** (uniform|indexed palette encoding behind accessors — `getMaterial` /
`setMaterial`, `MAT_ROCK` default; `MaterialTable` from the project catalog,
`BUILTIN_TABLE` rock-only fallback, `validateMaterialTable`/`classOf`).

- **Store + coords** — `createFieldStore`, `getDensity`/`setDensity`,
  `extractFieldAprons` (the 20³ density+material window), `chunkKey`/`parseChunkKey`,
  `voxelChunk`, `worldToVoxel`/`sampleToWorld`, `AIR`/`SOLID`.
- **The op log (F2b: one log, op-list undo; F3a: splice-safe entries + patches; F3b:
  placement ops)** — the `FieldOp` union = `BrushOp | EntityOp | PatchOp | PlacementOp`
  (`isBrushOp` narrows to the brush member). **Brush shapes** (`BrushShape`): `sphere`
  (`center` + `radius`), `box` (`center` + `halfExtents`), and **`capsule`** (F3b:
  D-F3-14 — the swept sphere from `a` to `b` with hemispherical endcaps, the editor's
  two-click segment brush; `a === b` degenerates to exactly the sphere at that point).
  A capsule's numbers are validated setup-loud by `assertOpValid` (finite endpoints, a
  finite positive radius) whatever the effect, and a kit class rejects it under the
  same rule that rejects a sphere — kit writes require a lattice-snapped box, so
  capsules write organic classes only. **Brush effects**: dig / fill / paint /
  **smooth**
  (`SmoothParams` — max-delta-clamp strength doubling as the thin-wall guard,
  iterations, both|erode|fill modes, `SMOOTH_DEFAULTS`; density-only, never materials).
  Fill takes an optional **`hollow`** shell-band thickness (non-destructive: interior
  skipped, never dug; kit shells validate to 0.5 m multiples). **Masks** (`BrushMask`:
  organic-only / kit-only / class / solid-only / selection-embedding) evaluate per
  sample and ride the op record — a masked op replays identically; `solid-only` is the
  keep-existing-air building block. Kit lattice validation is per-op and re-checked by
  the applier (`assertOpValid`). `applyOp`, `logApply`, `undo`/`redo`, `opBounds`,
  `createOpLog`. An undo/redo unit is a `LogEntry`: `ops` (an appended op LIST — one
  entry per generator commit), `splice` (an in-place span replacement — `before`/`after`
  chunk images are RESTORED on undo/redo, the span is never re-executed), or
  `entity-update` (an in-place entity-record swap that touches no chunks; its
  `opIndex` is validated to address a real entity op before either direction writes,
  so a hand-built entry cannot grow `log.ops` with holes or install a non-index
  property). `restoreImages` is the shared image→store writer (both channels; a null
  channel deletes). Both stacks are strictly LIFO.
- **Patch ops (F3a)** — `PatchOp` = ABSOLUTE masked per-cell writes, one `PatchChunk`
  slice per chunk: 512-byte density/material bitmasks (bit `lx + 16·(ly + 16·lz)`) plus
  one value per set bit in ascending bit order, each channel tracking its own mask.
  Bounded influence = exactly the masked cells, so a patch reads no surrounding state
  and replays byte-exactly — the primitive for semantic compaction (fold a run of
  dig/fill/paint into one patch) and for procedural emission (the noise math stays in
  the generator; the log stays compact data). `assertPatchValid` is setup-loud
  (canonical + unique chunk keys, mask sizes, value-array lengths == popcount, known
  class ids, no empty slice); `logApplyPatch` validates, CLONES the slice buffers (the
  log owns its copy) and applies; `applyPatchOp` is the bare applier, with the same
  dirty+inverse return as `applyOp`. Kit class ids are accepted — the lattice rule
  constrains a box shape, which a patch does not have. `fieldOpChunks(op, cellSize)`
  gives any op's written chunks (exact for patches, entity AND placement ops write none,
  brush ops quantize their +1-margin sample bounds).
- **Placement ops (F3b: D-F3-8)** — `PlacementOp` = a set of `PlacementRecord`s (each an
  `archetypeId`, world `position`, unit `quat`, per-axis `scale`, `variantIndex`), no
  field-cell writes; the **scatter generator** emits them. Orientation resolves at
  PLACEMENT time — the quat is baked in, so the recorded op replays as context-free data.
  It rides the log like an entity op: replay-ordered, undoable, skipped by every
  store-mutating replay path (`applyFieldOp` returns null, `fieldOpChunks` returns empty,
  cell-local trivially). `assertPlacementsValid` is setup-loud (non-empty `archetypeId`,
  finite `position`/`scale`, unit-length `quat` within 1e-3, non-negative integer
  `variantIndex`) — the commit and the oplog decoder both run it.
- **Selection** — `SelectionSpec` (region | flood-material | flood-void) →
  `materializeSelection` (6-connected BFS, budget-capped LOUDLY via `truncated`, ceiling
  `MAX_SELECTION_BUDGET`; pure query) + `selectionHas`; `MaterializedSelection` keeps
  regions as predicates and floods as chunk-keyed bitsets. Deterministic and embeddable
  in op masks (floods re-evaluate against replayed state).
- **Staged generators (F2b: the first entity ops; F3b: the evaluate widening + the cave + scatter)** —
  `FIELD_GENERATORS` registry (`generatorById`, setup-loud): data-parameterized hall,
  maze, **cave**, and **scatter** (`GeneratorDef` — plain JSON-Schema params; integer-only maze RNG, donor
  bit-parity). `evaluate` → a **`GeneratorResult`** = `{ ops, placements }` (D-F3-8): `ops`
  are lattice-snapped brush AND patch ops, `placements` are explicit `PlacementRecord`s;
  a `MergePolicy` (replace | keep-existing-air) rides in. Each `GeneratorDef` declares
  `contextFree: boolean` — `true` = pure in (params, seed, region), so the recorded span
  replays == re-evaluates (hall/maze/cave); `false` = evaluate reads the field through an
  `EvaluateContext` ({ store }), passed only then (scatter). It also declares
  **`emits: GeneratorEmits`** (F4: D-F4-15) — `"ops"` (placements always empty),
  `"placements"` (ops always empty), or `"both"` (nothing forbidden; the honest
  declaration for a mixed emitter). A DECLARATIVE fact about the result's shape, not a
  capability switch: read it to shape UI without evaluating ("does this generator place
  props?" is `emits !== "ops"`). ORTHOGONAL to `contextFree` (what evaluate READS) — every
  combination is legal; today's registry pairs `contextFree: true` + `"ops"` (hall, maze,
  cave) with `contextFree: false` + `"placements"` (scatter), which is a coincidence of
  the four rather than a rule, and no def declares `"both"`. Enforced setup-loud by the
  COMMITTER: the one shared evaluate path behind `commitGenerator` and
  `reconfigureGenerator` throws, before any write, on a result contradicting the
  declaration (two array-length reads on the result in hand — so it catches a def that DID
  contradict itself on this call, and cannot prove one never will on other params). A
  direct `def.evaluate` (a preview, a test) bypasses the guard, exactly as it bypasses the
  `contextFree` one.
  Each def ALSO declares **`usesSeed: boolean`** (F4.5b) — whether `evaluate` READS `seed`.
  UI-facing like `emits`: a seed control or re-roll button on a generator that ignores the
  seed is a dead control. `false` for the hall alone (its evaluate opens `void seed` —
  structure is entirely params-determined); `true` for maze, cave and scatter. Deliberately
  NOT enforced at runtime, and the two ways of being wrong are not symmetric: declaring
  `true` while IGNORING the seed leaves a re-roll button that visibly does nothing (loud —
  the first press finds it), while declaring `false` while CONSUMING it makes the UI HIDE a
  control that would have worked, so a real axis of variation disappears with no symptom at
  all. Neither corrupts anything — unlike `emits`, whose violation puts a forbidden channel
  into the op log, a wrong `usesSeed` only mis-shapes a form — which is why the pin is
  BEHAVIOURAL instead: every def in `FIELD_GENERATORS` is evaluated at two seeds, and
  `usesSeed` must predict whether the output moved, which catches both directions. The
  shared strict param
  validators (`numParam`/`intParam`/`boolParam`) live in a cycle-free `generator-params.ts`
  leaf (the `rng.ts` precedent — the registry imports the defs, so a def importing validators
  back out of `generators.ts` would cycle). `commitGenerator` applies the field ops
  and, if any, wraps `placements` in ONE placement op appended after them (inside `opSpan`),
  then records the `EntityOp` (`GeneratorEntity`: generator id, params, seed, region, opSpan
  — full provenance) under ONE undo entry; an empty result (no ops AND no placements) is
  rejected setup-loud. **Layout invariant:** a live entity's span ops sit immediately
  BEFORE its entity op in `log.ops` with sequential ids matching `opSpan`, and `entityId`
  is the entity op's own log id.
- **The cave generator (F3b)** — the first PATCH-emitting generator: a deterministic
  macro skeleton (floor-anchored chamber blob clusters, a connected passage graph, boundary
  mouths) stamped into ONE absolute `PatchOp`. Chambers are smooth-unioned blobs (Quilez
  `smax`); passages sweep flat-floored profiles along the polylines (square/mined vs
  round/organic), with the floor CLAMPED at each waypoint's quantized `RISER` (0.25 m) tread
  — cells below stay solid, so floors are flat and stepped by construction. Organic
  wall/ceiling roughness is integer-hash value noise, suppressed within a floor band so the
  walked floor stays clean. Three `theme`s dial the styles: `mined`, `organic`, `mixed`
  (mined passages threading organic chambers — the default). Density matches the dig
  encoding exactly (`clampInt8(sdf · DENSITY_SCALE)`); under `replace` every region cell is
  written (rock elsewhere, overwriting pre-existing air), under `keep-existing-air` only
  carved cells enter the mask. `contextFree`, `materialMask: null` (rock default renders),
  and Pr-2-exact (no transcendentals, no float-seeded tables — the donor's noise perm table
  is rewritten to a hash-direct lookup). There is deliberately NO `rotation` param: the
  skeleton is seeded isotropically in the region.

  | Param | Type | Range / values | Default | Notes |
  |---|---|---|---|---|
  | `theme` | enum | `mined` \| `organic` \| `mixed` | `mixed` | passage/chamber style selector (crisp / rough / mined-passages-through-organic-chambers) |
  | `chambers` | int¹ | 2–6 | 3 | floor-anchored blob-cluster count |
  | `chamberRadius` | number | 3–8 (m) | 5 | base blob radius (per-axis jittered ×0.4–1.3) |
  | `verticality` | number | 0–1 | 0.5 | scales the chambers' floor-height spread across the Y range |
  | `roughness` | number | 0–1 | 0.5 | organic wall/ceiling value-noise displacement (0 = smooth) |
  | `extraLoops` | int¹ | 0–3 | 1 | near-pair passage edges added beyond the spanning tree |
  | `doorNorth`/`doorSouth`/`doorEast`/`doorWest` | boolean | — | North `true`, rest `false` | per-wall boundary mouth on/off |
  | `doorNorthOffset`/…/`doorWestOffset` | int | −1 … 62 | −1 (auto-centre) | lateral mouth offset; **optional on input** (postdates persisted data); validated for every wall even when its door is off |

  ¹ `chambers`/`extraLoops` are schema-typed `number` but validated as integers (`intParam`). All params are setup-loud and range-checked before any emission.
- **The scatter generator (F3b)** — the first `contextFree: false` generator and the first
  PLACEMENT emitter: it READS the carved field through `ctx.store` and projects prop
  instances onto surfaces, returning `{ ops: [], placements }` (no field-cell writes). A
  jittered candidate lattice (pitch `max(minSpacing, 1/√density)`) is projected onto the
  `hemisphere`'s crossing — `floor` (topmost rock→air, normal up), `ceiling` (rock-above-air,
  normal down), or `wall` (horizontal crossing, normal sideways) — with a central-difference
  gradient normal and greedy `minSpacing` rejection. Each record bakes its `quat` from the
  `orientation` mode (`gravity` yaw-only, `normal` aligned to the surface, `blend` an **nlerp**
  of the two — never slerp/trig), a uniform `scale` in `[scaleMin, scaleMax]`, and
  `variantIndex = rng % variants`. Pr-2-exact: integer RNG, `Math.sqrt` + the four ops only.
  The candidate lattice is capped at 4096 sites (setup-loud — shrink the region or lower
  density). Reconfiguring scatter RE-COOKS against a scratch restore of its region's pre-span
  state (so it re-reads a reconfigured cave upstream); reconfiguring an upstream generator
  leaves scatter's records untouched but DRIFTS its placement op when the field beneath the
  props moves (`reconfigureGenerator` placement-drift, D-F3-4).

  | Param | Type | Range / values | Default | Notes |
  |---|---|---|---|---|
  | `archetypeId` | string | non-empty | `"rock"` | the catalog archetype every emitted record names |
  | `density` | number | 0.05–2 | 0.3 | sites per m²; sets lattice pitch `max(minSpacing, 1/√density)` |
  | `minSpacing` | number | 0.25–8 (m) | 1.0 | greedy rejection radius + pitch floor |
  | `scaleMin` | number | 0.05–8 | 0.6 | uniform-scale lower bound |
  | `scaleMax` | number | 0.05–8 | 1.6 | uniform-scale upper bound (`scaleMax ≥ scaleMin` enforced) |
  | `randomYaw` | boolean | — | `true` | random yaw about +Y vs a fixed +X facing |
  | `orientation` | enum | `gravity` \| `normal` \| `blend` | `gravity` | gravity = yaw-only; normal = align +Y→surface normal; blend = nlerp of the two |
  | `blend` | number | 0–1 | 0.5 | nlerp factor, used only when `orientation = "blend"` |
  | `hemisphere` | enum | `floor` \| `wall` \| `ceiling` | `floor` | which surface crossing to project onto |
  | `variants` | int² | 1–8 | 3 | `variantIndex = rng % variants` |

  ² `variants` is schema-typed `number` but validated as an integer (`intParam`). All params are setup-loud and range-checked; the record `scale` is UNIFORM (`[s,s,s]`, `s ∈ [scaleMin, scaleMax]`).
- **Stamp placement authoring (F3a: D-F3-13)** — ONE authoring convention across every
  generator. `rotation` is a quarter turn about +Y, spelled as the STRING enum
  `"0" | "90" | "180" | "270"` (default `"0"`), applied to the finished mini-grid after
  doors are carved and lane-validated — so it is lattice-exact, integer-only, and the
  door walk-lane guarantee is rotation-invariant. Rotation is about the stamp's min
  corner (`snapDown(region.min)`), so a 90/270 stamp on a region that is not square in
  XZ occupies a different world AABB than its unrotated form and may extend past the
  recorded `region`: `region` is the stamp's ANCHOR, not a clip box — the same
  region-vs-params mismatch the editor's field host already documents for oversized
  params. Four per-wall `door<Wall>Offset` knobs place each doorway laterally, `-1` =
  auto-centre. Units are per-generator: the hall counts COARSE CELLS, the maze counts
  MAZE CELLS (multiplied internally by the exported `MAZE_PITCH_CELLS` — 5 coarse
  cells, one passage block plus the single internal wall band that follows it —
  which is what keeps a door on a passage column and off an internal wall band).
  Out-of-range offsets THROW with the wall's legal range rather than silently
  clamping. A `cellsX × cellsZ` maze therefore spans `MAZE_PITCH_CELLS · cells + 1`
  coarse cells per horizontal axis (the passage blocks plus the outer shell), and
  the editor's selection-fit size defaults read the inverse
  `floor((n − 1) / MAZE_PITCH_CELLS)` from this one export — the footprint math is
  single-sourced to the generator. **The five new keys are OPTIONAL on
  input** — absent means rotation 0 and auto-centred doors — because `GeneratorEntity.params`
  is persisted and `reconfigureGenerator` re-evaluates from the recorded set, so entities
  written before F3a must keep evaluating. `GeneratorDef.defaults` still carries all five
  explicitly; optionality is a backward-compatibility allowance for recorded params, not
  the normal path. The nine pre-existing hall keys and seven maze keys remain REQUIRED,
  and each `paramSchema` now carries a JSON-Schema `required` array — DERIVED as "every
  property that is not one of the five post-F3a optionals", so a newly added param is
  required by default. **The standing rule for future params:** anything added after
  entities exist in the wild must be optional with an identity default, or every
  previously-saved entity becomes un-reconfigurable; anything present since a generator's
  first release stays required. Door offsets are validated for EVERY wall, including walls
  whose door is switched off — otherwise a malformed offset on a disabled door would ride
  along in the persisted params and only throw once the user toggled that door on.
- **Smart objects — reconfigure (F3a)** — `reconfigureGenerator(store, log, entityId,
  changes, table, snapshots?)` re-evaluates a committed generator IN PLACE: the old span is spliced
  out, a freshly evaluated one takes new ids from `log.nextId`, and the downstream ops
  the change can reach are replayed. `ReconfigureChanges` = `{params?, seed?, region?,
  policy?}`, each falling back to the recorded provenance — `params` is the COMPLETE
  replacement set, never a patch. `entityId` (and the entity op's id) survive unchanged;
  the span stays contiguous. Replay is CULLED to the affected set (old span's chunks ∪
  the new evaluation's, closed transitively over downstream ops that intersect it); an
  op whose mask embeds a FLOOD selection reads outside its own writes, so it is included
  unconditionally. A `contextFree: false` generator (scatter, F3b) RE-COOKS against a
  scratch restore of its region's pre-span state — built without touching the live store,
  so a rejecting re-cook is as atomic as any other validation failure — instead of reading
  the live end-of-log store. Returns `{dirty, entity, drift}`: `dirty` is the whole affected set
  (a restored-but-unrewritten chunk still needs a remesh), `entity` is a COPY of the new
  record, and `drift` is a `DriftFinding[]` — `orphaned` (the replayed op
  wrote nothing) or `drifted` (its chunks read differently than before), each with
  chunk-quantized `chunks` for jump-to-bounds UI. Downstream PLACEMENT ops never replay
  (they write no cells) but DRIFT when the field beneath them moves: each record's world
  AABB (`position ± scale/2`, a unit-primitive approximation) is intersected with the
  affected set, and a moved chunk flags the op `drifted` (F3b, D-F3-4). Field-op findings
  come first (log order), then placement findings. Drift is chunk-granular and does not
  attribute cause — a place worth a look, not a proof an op misbehaved. One `splice`
  undo entry, redo cleared; undo/redo restore images and never re-execute the span, and
  `log.nextId` is not rolled back (ids are handed out once). Setup-loud: unknown
  entityId, a `frozen`/`baked` entity, an unknown recorded generator id, a corrupt span
  layout, rejected params or an empty evaluation all throw with NOTHING mutated — in
  that ORDER, so a baked entity whose span was compacted away reports what it is rather
  than a corrupt layout. The optional `snapshots` (see Log hygiene) is a cost lever only:
  the bytes are identical with or without it.
  **Known gap (provenance):** `GeneratorEntity` does not record the commit's
  `MergePolicy`, so an omitted `changes.policy` falls back to `"replace"`.
  **Known gap (flood reads):** culling rewinds only the affected chunks, so every other
  chunk keeps its END-OF-LOG bytes. That is exact for ops whose reads stay inside their
  own bounded influence (all four brush effects, class-kind masks, region selections,
  and patch ops, which read nothing), but a FLOOD selection's read set is unbounded, so
  a replayed flood can traverse un-rewound chunks and see edits made by ops that
  originally ran AFTER it — from-scratch equivalence does not hold for such a log. The
  op is always replayed and lands in `drift` when its output differs from the
  PRE-RECONFIGURE bytes (the drift baseline is old-final, not from-scratch), so it is
  loud in practice; the report just cannot say the new output is wrong.
  Tracked in `docs/backlog/engine-architecture/field-reconfigure-flood-read-set.md`.
- **Smart objects — delete (F4.5b)** — `deleteGeneratorEntity(store, log, entityId,
  table)` is the reconfigure splice with NO replacement: the entity's span AND its own
  entity op are spliced out of `log.ops`, the chunks the span wrote rewind to their
  pre-span state, and the downstream ops that reach them replay on top (the same culled
  replay, D-F3-3). The log then reads as though the generator had never been committed,
  with every later edit preserved — a dig that cut through the deleted stamp survives as
  a dig into whatever was underneath. Other entities are untouched: spans are located by
  ID, so removing a contiguous block elsewhere leaves each survivor's span sitting
  immediately before its own entity op. `log.nextId` is NOT rewound (ids are handed out
  once, so the removed span parked on the redo stack cannot collide with a later op).
  Returns `{dirty}` only — the whole affected set, since a restored-but-unrewritten chunk
  still needs a remesh. **`dirty` can be EMPTY, and empty does not mean nothing happened:**
  a placements-only entity (scatter) writes no field cells, so deleting it moves no chunk
  and there is nothing to remesh — but its placement op is gone from `log.ops`, and with it
  every prop it placed. Props are derived from the LOG, never from `dirty`; a consumer that
  re-reads placements only when `dirty` is non-empty will leave deleted props on screen.
  **No `drift` report** — a cost/scope choice, not an impossibility, and two real signals
  are given up by it: an `orphaned` finding for a downstream op that replays and now writes
  NOTHING (a dig that only ever cut the deleted stamp's masonry — the verb discards exactly
  the `applyFieldOp` result that would produce it), and a placement `drifted` finding for
  props left floating when the field beneath them goes (delete a cave under a scatter and
  every prop keeps its recorded pose over air). Both are SUBSETS of the downstream ops, not
  "everything". Widening the return to carry them is additive and non-breaking whenever a
  caller earns it. **No `snapshots`
  argument** either: the rewind is identical and the lever would work, but no caller holds
  records today, so it is left off rather than added speculatively. One `splice` undo entry
  with `inserted: []`, redo cleared; undo puts the whole entity back and restores the
  images byte-for-byte, redo re-deletes, and neither re-executes the span. Setup-loud on
  an unknown entityId, a `frozen` entity (freeze protects against an accidental edit and
  deletion is the largest edit there is — unfreeze first, unlike `bakeGeneratorEntity`
  which ignores the flag), a `baked` entity, or a corrupt span layout — all with NOTHING
  mutated, and in that ORDER for reconfigure's reason. The **baked** refusal is permanent
  and structural: a baked record's span ops are compaction-eligible and `compactRuns`
  folds them without updating the record, so a baked `opSpan` is no longer a claim about
  the log's contents and splicing by it could delete ops the entity never owned. Bake
  retires an entity; it is not a step towards deleting one.
- **Smart objects — freeze / bake (F3a)** — the two protection verbs, both
  `(log, entityId, …)` and deliberately WITHOUT `store`: each writes only the entity
  RECORD, so no chunk changes and there is no `dirty` set to return. Each records one
  `entity-update` undo entry and clears redo; undo swaps the previous record back and
  reports an empty dirty set. Neither verifies the entity's span layout — being unable
  to protect or retire a corrupt entity would be the wrong failure mode — so a
  compactor must derive span eligibility from LIVE (non-baked) entity spans, which
  reconfigure does verify. Both return a COPY of the record, carrying fields they have
  no opinion about verbatim.
  `setGeneratorFrozen(log, entityId, frozen)` blocks/unblocks `reconfigureGenerator`.
  It is a SETTER, not a toggle: a redundant call (freeze what is frozen, unfreeze what
  is not) does nothing at all — no undo entry and no redo CLEAR, which would otherwise
  destroy a live redo entry for a call that changed nothing. Unfreezing DELETES the
  field (`GeneratorEntity.frozen` is a literal-`true` optional). Setup-loud on an
  unknown entityId or a BAKED entity (nothing left to protect).
  `bakeGeneratorEntity(log, entityId)` severs the recipe — the one irreversible verb.
  Provenance (generator, params, seed, region, `opSpan`) is RETAINED for history;
  `frozen` is cleared; reconfigure refuses the entity permanently and its span ops
  become plain history eligible for compaction. **"Permanent" = no VERB reverses it**
  — there is no unbake, and a second bake throws rather than repeating (a one-way
  transition is not an idempotent setter, and logging it would push a before === after
  entry: a ⌘Z that visibly does nothing). ⌘Z still undoes it for as long as the entry
  is on the undo stack; past that — stack discarded, or a save/reload, since
  `serializeOps` writes `log.ops` only and never the stacks — it is baked for good.
  Setup-loud on an unknown entityId or an already-baked entity.
- **Log hygiene — stats, compaction, snapshots (F3a)** — `logStats(log, opts?)` is the
  op-cost readout (D-F3-16): `totalOps`, `liveGenerators` (recipes still intact —
  `frozenGenerators` is a SUBSET of it, `bakedGenerators` the disjoint remainder),
  `compactableOps`, `undoDepth`/`redoDepth`. Pure query; no store parameter. Passing the
  caller's real `CompactOptions` makes `compactableOps` agree with what a fold would
  remove; omitting them reports the ceiling.
  `compactRuns(store, log, table, opts)` folds runs of plain cell-local brush ops
  (`dig`/`fill`/`paint`, any mask but a FLOOD selection) into ONE `PatchOp` each — the log
  shrinks, the field does not move. `smooth` breaks a run (it reads its neighbourhood, so
  absolute cell values cannot stand in for it); so do patch and entity ops. Ops inside a
  LIVE entity's span are excluded, as are `opts.keepIds`; runs shorter than 4 ops are left
  alone; a run whose net effect is nothing is removed outright. `store` is read for
  `cellSize` ONLY — no chunk is read or written. Every fold is verified against a real
  from-scratch replay of the log's own prefix BEFORE anything is discarded (the charter
  §2.3 discard guard) and the synthesized patch passes `assertPatchValid`, so a producer
  that splices straight into `log.ops` still cannot plant an op a later replay chokes on.
  **Requires a quiescent history — both stacks empty, setup-loud otherwise**: undo entries
  address `log.ops` positionally (tail length / `at` / `opIndex`) and a fold shifts every
  position after it, which no id-based opt-out can fix. `serializeOps` never persists the
  stacks, so a freshly loaded project satisfies it for free — compact on open, edit after.
  **What a fold gives up:** a patch replays ABSOLUTE values, so folded ops stop adapting
  to an upstream reconfigure
  (`docs/backlog/engine-architecture/field-compaction-downstream-of-live-entity.md`;
  the index-anchoring alternative to the quiescence rule is
  `docs/backlog/engine-architecture/field-log-entries-anchored-by-index.md`).
  `captureDueSnapshots(store, log, records, tailBudgetOps)` captures a `SnapshotRecord`
  (`{key, position, density, materials}`) for every chunk whose replay tail has outgrown
  the budget, and RETURNS them rather than appending — a pure query that mutates nothing,
  whose captured channels are COPIES rather than views onto the store. The caller owns the
  list, its persistence (D-F3-7 sibling files) and its lifetime. Passing records to
  `reconfigureGenerator`'s optional sixth argument shortens the rewind: an affected chunk
  is rebuilt ALONE from its newest usable record forward, valid exactly while every op in
  that window touching it is cell-local. The choice is all-or-nothing — if one affected
  chunk is disqualified the full-prefix replay happens anyway, so it is used for all of
  them. Measured on a 2850-op log (`packages/core/scripts/field-replay-bench.ts`):
  346 ms full-prefix (the F3a behaviour) → 83 ms culled with NO records → 8 ms with a
  2-op tail budget. **A record is bound to the log that produced it** and nothing detects
  staleness — any edit below its `position` (an undo, a reconfigure splice, a compaction
  fold) makes the restore silently produce bytes a from-scratch replay would NOT, with no
  throw, no warning, and no `drift` attribution (drift's baseline is the pre-reconfigure
  bytes, not a rebuild). Dropping stale records is the record owner's job:
  `docs/backlog/engine-architecture/field-snapshot-record-lifecycle.md`.
- **Mesh + skin** — chunked Surface Nets over the 20³ aprons with owned-crossing quads
  bucketed per owning-cell class incl. the kit **backing** surface (`meshChunkField` —
  watertight seams by construction); the generic **kit skinner** on the derived coarse
  view (`skinChunkKit` — panels/tiles/posts/collar from catalog kit-style data,
  `variantHash` tint jitter).
- **Kit + placement render math (F3b: `kit-render.ts`)** — the pure, GPU-free single
  source of truth for the FIELD's per-instance matrices + tints, shared by every
  consumer that draws or bakes instances (the editor field-host preview, the dungeon
  field-world loader, and F3 explicit placements). Public: `packKitMatrices(kit, origin)`
  packs one chunk's kit pieces into a column-major `Float32Array` (16 floats/instance) —
  each `(yaw quaternion · box scale)` TRS at chunk-local position offset by the chunk's
  world `origin` — for one bulk `setInstanceMatrices` upload. **Invariant:** every kit
  matrix is a quarter-turn yaw about +Y times a per-axis box scale on an AXIS-ALIGNED
  UNIT CUBE, which is what lets the `litInstanced` shader skip the per-instance normal
  matrix; callers must NOT feed non-axis-aligned kit geometry or arbitrary rotations.
  `packPlacementMatrices(records)` is the sibling packer for explicit placements: each
  record's baked-in ARBITRARY quat, world position and per-axis scale composed as one
  `T·R·S` via the same `mat4.fromRotationTranslationScale`, so placement instances share
  the kit layout + winding — but because the rotation is arbitrary the no-normal-matrix
  shortcut does NOT apply (a placement's instanced material must supply proper normals, or
  the archetype mesh must use uniform scale). `pieceColor(table, k)` is the per-instance
  kit tint: the class's `KitStyle` piece colour (via the piece-kind→bucket map) jittered
  by the instance variant (RGB only, alpha carried through); a non-kit class passes through
  white. `yawQuat`/`PIECE_COLOR_KEY` are module-internal (not re-exported from
  `field/index.ts`). Consumed but never overlapping: each caller keeps its own GPU calls
  (geometry/mesh creation, uploads) and per-consumer material cache.
- **Raycast + collision** — voxel DDA (`raycastField`, optional `maxY` display-slice
  clip — cells at/above read as air for targeting); per-chunk shell colliders
  (`chunkColliders` — density-only, material classes never affect collision).
- **Placement colliders as solidity (F4: D-F4-5, D-F4-14)** — props carry their OWN
  colliders in the runtime physics world ("if you can dig it, it's field; else it's an
  entity with its own collider"), so anything reading chunk density alone is blind to
  them. `placement-collision.ts` is the bridge, and is deliberately NOT an analysis
  module: the same functions position the dungeon's rigid bodies and an editor's ghosts.
  `PlacementCollision` = the catalog's authored primitive in the archetype's own unit
  frame — `box` `halfExtents` | `sphere` `radius` | `capsule` `halfHeight`+`radius` — each
  with an optional **`anchor: "center" | "base"`** (`"center"` is the default and every
  pre-F4 catalog's implicit meaning; `"base"` puts `position` at the primitive's BOTTOM,
  what a floor-standing prop wants). `PlacementCollisionGroup` = `{ collision, records }`,
  the per-archetype batching a placement artifact already has.
  `collisionExtentY(c, scale)` is the primitive's half-extent along its OWN Y after scale
  — box `halfExtents[1]`, sphere `radius`, capsule `halfHeight + radius` — under the
  runtime collider's scale rule: per-axis for a box, MAX axis for the round primitives,
  MAGNITUDES throughout (a mirrored record covers the same box). `collisionCenter(c, r)`
  is the pose to give the body/proxy/ghost: `"center"` returns `r.position` unchanged,
  `"base"` lifts it by that extent along the record's LOCAL +Y. Call it rather than
  composing the lift — the analyzer's rasterized solidity, the dungeon loader's rigid
  body and an editor's proxy come from this ONE function, not from a recipe. Both are
  pure queries and validate NOTHING (the caller already parsed the data); a non-unit
  `quat` mis-scales the lift WITHOUT BOUND above `|q| = 1` — `voxelizePlacements` is where
  such a record is refused.
  `voxelizePlacements(groups, cellSize)` rasterizes those colliders into per-chunk
  solidity for the analyzer: one `Uint8Array` per touched chunk, in `AnalyzeOptions`'
  `extraSolid` encoding exactly. Coverage is CONSERVATIVE — each record contributes the
  world AABB of its anchored, scaled, quaternion-rotated primitive and every cell that
  AABB touches is marked, so a rotated or round collider reads slightly larger than it is.
  Over-solidity is the miss-safe direction for a trap hunt (it can invent a `narrow`,
  never hide one) with one honest cost: filled cells stop being floor anchors, so the
  analyzer says nothing about the ground immediately under a prop — matching the runtime,
  where the mover cannot stand there either. Chunks no collider reaches are absent
  (readers treat that as "no extras"), so the map need not align with the store's
  allocated chunks. Setup-loud on every way of covering LESS than the collider does: a
  non-positive/non-finite collision dimension (checked per group even when it holds no
  records) or `cellSize`, a non-unit `quat` (it would rotate only PARTIALLY and
  under-cover), a pose whose world AABB is non-finite (which would rasterize to silent
  nothing), or a record past the per-record budget of `1 << 18` cells (a 64-cell cube —
  16 m on a side at the default `cellSize`, so crossing it means garbage dimensions).
- **Walkability analysis (F4: D-F4-1..8, D-F4-18) — `AgentProfile`, `FieldFlag`,
  `analyzeChunk` / `analyzeWorld` / `markUnreachable` / `detectPits`** — the walkability
  advisor: a
  Recast-style walkable-column pass over the field's OWN solidity (the same `density < 0`
  predicate `chunkColliders` derives from, so it analyses at the resolution the capsule
  actually touches). **ADVISORY ONLY** — it never mutates the store, never blocks a verb,
  never auto-fixes. Demoed in `cookbook/field`.
  `AgentProfile` is the consuming project's capsule as DATA (core hard-codes no game's
  mover): `capsule {radius, halfHeight}`, `stepHeight`, `climbCeiling`, `clearance`,
  `slopeLimitDeg`, `skin` (the mover's collide-and-slide contact margin, which must be
  positive and below `radius`). Cell thresholds are derived from it against
  `store.cellSize` ASYMMETRICALLY on purpose — `ceil` on what the capsule REQUIRES
  (clearance, radius, probe heights), `floor` on what it is ALLOWED (step, climb) — but
  be exact about what that buys, because the halves differ. **Against a lattice-quantized
  measurement it is EXACT, not merely tight** (`clearCells`, `stepCells`, `climbCells`):
  floor surfaces sit at whole multiples of `cellSize` and the runtime collider is
  `cellSize` boxes on that same lattice, so a rise between anchors is exactly `Δy·cellSize`
  and a headroom exactly `run·cellSize`; for integer `n`, `n ≤ floor(t/cellSize)` ⟺
  `n·cellSize ≤ t`. These ARE the mover's predicates — there is no borderline band for the
  rounding to shave off, and **no safe direction to reason from**. Against a continuous
  quantity it really is a bound, and the `ceil` over-demands as intended: the PROBE REACHES
  (`wallCellsXZ`, `wallProbeUp`, `torsoCells`) look slightly further than the capsule does.
  The `narrow` pinch width is the one threshold that is NOT rounded to cells at all (it is
  a metre comparison; only its scan bound rounds up).
  `slopeLimitDeg` is validated but NOT read by
  this pass (it is carried for stage-2 movers; a voxel column has no slope concept).
  A `FieldFlag` is `{kind, severity, cell, world, chunk, unreachable?, chunks?, cells?}`.
  `FlagKind`: `low-clearance` (headroom below `clearance`), `ledge` (a neighbour floor
  higher than `stepHeight`), `lip-near-wall` (a sub-step lip with a wall within capsule
  radius beyond it — the wedge CONJUNCTION, since a sub-step lip alone is harmless),
  `narrow` (less than `2·radius + skin` of free width at torso height between the near
  faces of the nearest solid on OPPOSING sides of one XZ axis), and `pit` (a REGION the
  agent can enter and not leave — the only kind that is not a per-cell property, produced
  by `detectPits` alone). Both halves of `narrow` are load-bearing and were measured
  (P-F4-3): counting the four cardinals INDEPENDENTLY made every inside corner a pinch,
  which on cave terrain is most of the map, and rounding the reach to cells made
  `ceil(0.30/0.25) = 2` cells mean a 0.75 m lane for a 0.60 m capsule.
  `FlagSeverity` is the triage band (D-F4-7): `candidate` = shown by default, worth a
  stage-2 verify; `info` = a known-benign class the current mover handles. Nothing
  varies with height: `low-clearance`, `narrow` and `pit` are always `candidate`,
  `ledge` and `lip-near-wall` always `info`. **`ledge` carried a `candidate` band past
  `climbCeiling` until D-F4-18 retired it**, and the reason is measured rather than
  stylistic: on deliberately vertical cave terrain a rise past the climb ceiling
  describes the TERRAIN (P-F4-3 counted 787 such candidates in the largest committed
  world and 323 in a default cave). Being trapped by one is a connectivity property no
  per-cell filter can express, so it moved to `detectPits`, where `climbCeiling` lives on
  as the graph's edge rule.
  `cell` is the anchor AIR cell above the floor and is NOT guaranteed walkable
  (`low-clearance` anchors on the offending NEIGHBOUR); `world` is the floor surface
  centre under it (cell XZ centre, Y of its bottom face); `chunk` is the OWNER — the chunk
  whose pass emitted the flag, which for a `low-clearance` anchor may differ from the
  chunk holding `cell`, so re-analysing a chunk can wholesale replace what its own pass
  produced. `chunks` (every chunk the region touches, sorted by KEY STRING — determinism,
  not spatial order) and `cells` (region size in columns) are present on `pit` flags ONLY — and they are the tell that a pit does not
  fit the per-owner-chunk replacement model at all: it is produced whole-world and must
  be replaced wholesale per `detectPits` run.
  `analyzeChunk(store, key, profile, opts?)` anchors on that chunk's own 16³ cells and
  returns flags in scan order, deduplicated by (kind, cell). Neighbour reads cross chunk
  borders freely and are UNBOUNDED UPWARD in Y (the ceiling search runs until it finds
  rock, deliberately uncapped — any cap silently drops every rise standing above it), so
  the caller must hold the whole vertical column above the analysed chunk or accept
  clipped ceilings and say so downstream. An unallocated key is legal and yields nothing
  (air, and therefore every anchor, exists only in allocated chunks). `analyzeWorld` is
  the same pass over every allocated chunk, returning one entry per chunk — empty arrays
  included. `AnalyzeOptions.extraSolid` widens solidity with the caller's placement
  colliders: `ReadonlyMap<ChunkKey, Uint8Array>`, **ONE BYTE PER SAMPLE**, length exactly
  `CHUNK_SAMPLES`, in `localIndex` order, non-zero = solid; a missing chunk key means that
  chunk has no extras. It is **NOT a packed bitset** — a packed producer would read as
  plausible partial garbage rather than failing, so the length is checked SETUP-LOUD (once
  at entry, not per probe). All four entry points here — `analyzeChunk`, `analyzeWorld`,
  `markUnreachable`, `detectPits` — share that gate, and also throw setup-loud on a
  profile that is not internally consistent: a non-positive or non-finite field,
  `climbCeiling` not above `stepHeight` (a mover that auto-steps higher than it climbs is
  not a profile these passes can read), `clearance` below the capsule's own
  `2 × (halfHeight + radius)`, or `skin` at or above `capsule.radius` (which would put the
  `narrow` bar past three radii). The gate runs BEFORE any early return, so a bad profile
  throws even when there is nothing to do — an empty seed list, or a store with no
  allocated chunks at all.
  `markUnreachable(store, profile, flags, seeds, opts?)` (D-F4-8) is triage, not
  filtering: it floods from each seed's floor surface (4-connected in XZ, any |Δy| within
  `climbCells` — the CLIMB BAND, the edge rule it shares with `detectPits`, so
  "climbable" means one thing in the module) and WRITES `unreachable` into
  the flags passed in. It removes no flag, changes no severity and never touches the
  store. Seeds are WORLD positions, each snapped DOWN to the floor surface at or below it;
  a seed buried in rock warns and is ignored. With no usable seed the pass skips entirely,
  leaving every tag as it was — because with nothing known reachable, tagging would demote
  the whole world. (An EMPTY seed list returns silently, without a warning; so does a flag
  map with nothing in it, which is the common case in an edit loop.) The filter is
  deliberately UNSOUND, and demote-not-delete is what makes that safe: **falling is
  ignored** (a shelf reachable only by dropping reads unreachable — `detectPits` models
  that edge, and the two are deliberately NOT merged: this one answers "can the agent get
  there at all", where the conservative undirected answer is the honest basis for a
  demotion. One consequence is HANDLED rather than left to the caller: this flood cannot
  enter a pit by definition, so tagging one would demote every `detectPits` finding — the
  pass therefore SKIPS `pit` flags outright and leaves their tag `undefined`, which makes
  mixing the two sets into one list a no-op instead of a silent hiding);
  **headroom is ignored**, so the flood crosses gaps the capsule cannot fit
  through, and a `cellSize` COARSER than `climbCeiling` floors `climbCells` to 0 and
  strands everything off the seed's own level; and steps are
  **4-connected in XZ**, so a floor whose only route in is a DIAGONAL step reads
  unreachable though the mover walks there fine. `unreachable` is therefore a TRI-STATE —
  `undefined` = this pass never ran over that flag, or the flag is a `pit` it deliberately
  does not answer for; `false` = reached; `true` = demoted —
  and mixed vintages are the normal steady state (analysis is per-dirty-chunk, this pass
  is whole-world). **Filter on `=== true`** (hide those, show everything else); testing
  `=== false` for "reachable" silently hides every not-yet-flooded flag.
  `detectPits(store, profile, seeds, opts?)` (D-F4-18) answers the question no per-cell
  filter can: **which regions can the agent get INTO and not back OUT of.** Same nodes as
  the flood above (standable columns, headroom ignored), with a DIRECTED edge rule between
  XZ-4-adjacent ones: within `climbCeiling` they connect both ways; further apart the
  higher connects to the lower and not back — walking off an edge, which the mover does
  freely (no fall-damage model, and so no fall-distance limit: a 50 m drop is an entrance
  like a 1 m one). A pit is ENTERABLE ∧ ¬CAN-RETURN — the flood from the seeds minus the
  flood that reaches the seeds over REVERSED edges — clustered 4-connected into regions,
  ONE `candidate` flag per region anchored at its LOWEST column. Returns a FLAT array, not
  a per-chunk map: a pit is a global property, so this is a **world-cadence pass for the
  idle tail**, not a per-dirty-chunk one (one dug cell can open or seal a trap anywhere).
  Empty or wholly-unusable seeds return NO flags — with no known start there is no
  "enterable", and guessing a spawn would be the advisor inventing its own premise.
  Its unsoundness is the flood's, minus the safety: this pass REPORTS rather than demotes,
  so an error either way is a wrong finding, not a conservative one. Headroom ignored can
  both hide a pit whose only modelled exit is a crawlspace and invent one whose only
  modelled entrance is; 4-connected steps make a region whose only way out is DIAGONAL
  read as a pit. **The climb band has no safe direction either** — it is exact (above),
  and region count is not monotone in it in EITHER direction: measured 2026-07-26 over
  4000 random stores, shrinking the band from 3 cells to 2 added a region in 1561 and LOST
  one in 34, because a narrower band deletes ENTERABLE edges as readily as return ones.
  **A missing pit is possible; the caveat list is not a proof otherwise.** Separately, and
  not a rounding error: at a `cellSize` as coarse as `climbCeiling` the band is one cell
  and coarser still it is zero, where the lattice cannot represent a climbable step at all
  and everything the agent can only drop to reads trapped. **Budget it as a second
  whole-world pass, not a cheap post-step:** measured 1.21–1.34x the `analyzeWorld` beside
  it on the F3b default cave (2026-07-26, warm; an independent reviewer saw up to 1.79x
  over eight runs), because the reverse flood scans each column's air pocket to its
  ceiling — cost tracks open air as well as floor area.
  Two properties of the column pass consumers must plan for. **The rim divergence:**
  unallocated chunks read SOLID — the field's own rule, which the runtime collider
  derivation inherits — but the runtime emits NO collider there at all, so at the OUTER
  rim of the allocated region the two disagree in both directions. Under-flagging: a floor
  within `clearance` of the rim reads headroom-limited, or as no anchor at all, where the
  runtime would let the capsule stand. Over-flagging: the rim reads as walls, so a
  sub-step lip beside one earns a `lip-near-wall` against rock the runtime does not have.
  It no longer grows a `narrow` fringe along the edge — that was the side-counting
  predicate, for which a rim corner counted as a pinch. Interior chunk borders are
  unaffected as long as the neighbouring chunks are present. **Deliberate
  cross-chunk duplicates:** a `low-clearance` cell straddling a chunk border is emitted by
  BOTH neighbouring passes under different owners. Suppressing the copy whose cell lies
  outside the analysed chunk would LOSE the flag whenever its only walkable neighbour sits
  across that border, so the pass over-emits instead — a presentation layer that cares
  must dedupe by cell.
- **Artifact** — `encodeChunkFile`/`decodeChunkFile`,
  `encodeMaterialFile`/`decodeMaterialFile`, oplog serialize/parse,
  `serializePlacements`/`parsePlacements` (the placement artifact), `bakeFieldWorld`
  (pure; the manifest embeds the resolved material table).
- **The placement artifact (F3b: D-F3-10)** — `placements.json` is a **`{ version: 1,
  archetypes: [{ id, count, records }] }`** envelope, where `records` is a base64
  **Float32Array packed 11 floats/record** (`pos3 + quat4 + scale3 + variantIndex`) —
  the archetype id is the GROUP key, never in the float array (the packed per-archetype
  instance-buffer shape: Unity TreeInstance / Godot MultiMesh). `bakeFieldWorld` folds
  every `PlacementOp` still in `log.ops` (in order, grouped per archetype) into it and
  adds an **optional** `placements: "placements.json"` manifest field — **additive within
  manifest version 2** (absent = no props; the loader must not require it). This is the
  SERIALIZED record, distinct from `packPlacementMatrices`' 16-float render matrix: the
  loader `parsePlacements` → per-archetype groups → `packPlacementMatrices` per group. No
  collider data, no clustering (both derived at load). `parsePlacements` is **setup-loud**
  — envelope shape + version, each group's `id`/`count`/`records` shape, a payload length
  that must equal `count × 11 × 4`, and each group's records value-validated with
  `assertPlacementsValid` (finite vectors, unit quat, non-negative integer variant).
- **The oplog wire format (F3a: v2; F3b: v3)** — `oplog.json` is a **v3 envelope**,
  `{ version: 3, ops: [...] }`. Every `FieldOp` member round-trips: brush, entity AND
  placement ops are plain JSON (so an entity's `frozen`/`baked` flags persist, and ABSENCE
  stays absence — the literal-`true` optionals never materialize as `false`; a placement
  op's records are small literal JSON, no binary payload); a patch op's four typed arrays
  per slice encode as **base64** strings. Plain `JSON.stringify` would render them as
  index-keyed objects (~8× the bytes, and no longer typed arrays coming back) — the reason
  the envelope exists. `parseOps` reads **v3 AND v2** envelopes (a v2 file carries no
  placement ops by construction; the version gate rejects anything > 3 as a FUTURE build)
  and **v1**, a BARE JSON array with no envelope (every world baked before F3a), including
  F1's `kind:"dig"` literals, which map forward to brush/dig ops; a JSON array is never a
  JSON object, so envelope and bare-array cannot be confused.
  It is **setup-loud**, and the line it draws is **strings vs numbers**: every closed
  string union that reaches the wire is checked; every numeric field is not.
  **Checked:** malformed JSON (wrapped with the `field oplog:` locator — three JSON files
  sit side by side in a world dir); an unknown or FUTURE envelope version; a non-array
  `ops`; an INTEGER `id` on every op (unchecked, one id-less op makes the editor's
  `nextId` reduce `NaN`, every later op is stamped `id: NaN`, and `JSON.stringify` writes
  those back as `null` — a corrupt log made plausible); a known `kind`; **every** closed
  string union — a brush's `effect`, `shape.kind`, `mask.kind` and an embedded
  `mask.selection.kind`, its `smooth.mode`, an entity's `action` and `entity.type`; that a
  present optional `mask`/`smooth` is actually a record; for patch ops, the full
  table-independent structure (canonical unique chunk keys, 512-byte masks, value arrays
  exactly as long as their mask's popcount), so a TRUNCATED payload is rejected at parse;
  and, for placement ops, each record's shape (the vector field lengths + primitive types)
  AND values (`assertPlacementsValid` — non-empty id, finite vectors, unit quat, valid
  variant).
  The union tables are `satisfies Record<Union, true>` keyed records, exhaustive in BOTH
  directions — adding a member to a union in `types.ts` without extending the table is a
  compile error (TS1360), not an op the engine emits and its own parser refuses.
  **Not checked — every NUMERIC field:** a shape's centre/radius/half-extents/capsule
  endpoints (`assertOpValid`'s capsule leg guards the AUTHORING path, not this one), a brush's
  `material` and `mask.classId`, `smooth.strength`/`iterations`, a flood selection's
  `seed`/`budget`, an entity record's `entityId`/`seed`/`region`/`opSpan`, and a patch
  slice's material class ids. The class ids need a `MaterialTable` (`parseOps` takes none);
  the rest are deferred — `assertSmoothValid` and `assertSelectionSpecValid` already own
  the right predicates and are simply not wired to this path.
  **Nothing downstream re-checks any of it:** loaded ops are pushed straight into
  `log.ops` and never pass through `logApply`/`logApplyPatch`, and `applyOp`/`applyPatchOp`
  trust their input by contract — so a bad class id surfaces late, at mesh time. The writer
  trusts its input (`logApplyPatch` already validated everything in the log); the reader
  does not.

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

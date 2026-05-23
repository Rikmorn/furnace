# bun-webgpu 0.1.7 drops swapchain viewFormats in the mock

`bun-webgpu`'s `GPUCanvasContextMock.createRenderTexture` does NOT forward the configured `viewFormats` array to `device.createTexture`. The result: when `gpu.requestContext` uses the default sRGB surface format and tries to acquire an sRGB view of the swapchain texture (via `getCurrentTextureView`), the underlying texture has no compatible sRGB view format and `createView({ format: "bgra8unorm-srgb" })` raises a `GPUValidationError`.

Chrome handles this correctly per spec — the sRGB default is the right production behavior. The `frame.render` GPU tests in tranche 4 work around the mock bug by calling `gpu.requestContext(canvas, { surfaceFormat: "linear" })` in `_helpers/gpu-fixture.ts`-style setups, bypassing the sRGB view requirement.

Implementation paths:
1. Upstream fix: PR `bun-webgpu` to forward `viewFormats` from `configure` into the texture creation in the mock. Cleanest; benefits everyone.
2. Engine workaround: keep using `surfaceFormat: "linear"` in the GPU test fixture; document the mock divergence explicitly in `tests/_helpers/gpu-fixture.ts` so future test authors don't waste time debugging.
3. Replace bun-webgpu with another headless WebGPU runner that handles viewFormats correctly.

**Trigger to revisit:** Next time a GPU test fails with a "no compatible sRGB view format" / texture format validation error against bun-webgpu, OR when bun-webgpu publishes a release fixing this.

**Reference:** Tranche-4 Task 14 review (`docs/superpowers/plans/2026-05-23-core-tranche-4-drawable-primitives.md`). Test impact: `packages/core/tests/frame/render.gpu.test.ts` uses `surfaceFormat: "linear"` to bypass.

// Bun-webgpu fixture helper. Tests using a real WebGPU device import bunWebGpuAvailable()
// and wrap their assertions in test.skipIf(!bunWebGpuAvailable())(...).
//
// bun-webgpu 0.1.7 exports an async setupGlobals() that installs navigator.gpu but
// does NOT shim HTMLCanvasElement. Callers needing a canvas use makeOffscreenCanvas(),
// which wires canvas.getContext("webgpu") to a real GPUCanvasContextMock.

// IMPORTANT: GPU tests using bun-webgpu must pass `surfaceFormat: "linear"` to
// `gpu.requestContext(canvas, ...)`. The bun-webgpu mock drops the `viewFormats`
// array configured on the canvas context, so the engine's default sRGB surface
// format causes `createView({ format: "bgra8unorm-srgb" })` to fail validation.
//
// This means sRGB-specific code paths are NOT exercised in unit tests under
// bun-webgpu; coverage for the production surface format comes from manual
// Safari / Chrome runs of hello-world and the cookbook demos. See
// `docs/reference/engine-conventions.md` for the color-space convention.

import { suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

let _setup: Promise<boolean> | null = null;
let _availableSync = false;

/**
 * Resolve bun-webgpu's native library ourselves, SYNCHRONOUSLY, so `setupGlobals` can be
 * handed an explicit `libPath` instead of running the library's own resolver.
 *
 * THIS IS A WORKAROUND FOR A BUN DEFECT, NOT FOR A PACKAGING PROBLEM. Without it, under
 * `bun test --isolate`, the library throws `bun-webgpu is not supported on the current
 * platform: darwin-arm64` on a machine where it loads fine under the serial runner —
 * `dlopen` is never reached. bun-webgpu resolves its library through
 * `await import("bun-webgpu-<platform>-<arch>/index.ts")`; that platform package is an
 * async module, and under `--isolate` the dynamic import resolves before its top-level
 * await settles, so reading `.default` throws a TDZ `ReferenceError` the library swallows.
 * Mechanism, repro and revert trigger:
 * `docs/backlog/infrastructure/bun-isolate-top-level-await-tdz.md`.
 *
 * Must stay SYNCHRONOUS — another `await import` would reintroduce the async-module
 * dependency this routes around. Twin of the same function in
 * `packages/core/tests/_helpers/gpu-fixture.ts`, which this whole file already duplicates.
 */
function resolveBunWebGpuLib(): string | undefined {
  try {
    const fromFixture = createRequire(import.meta.url);
    const fromLibrary = createRequire(fromFixture.resolve("bun-webgpu"));
    const platformPkg = `bun-webgpu-${process.platform}-${process.arch}`;
    const dir = dirname(fromLibrary.resolve(`${platformPkg}/index.ts`));
    for (const name of [
      `libwebgpu_wrapper.${suffix}`,
      `webgpu_wrapper.${suffix}`,
    ]) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** One report per realm; the bare `catch` this replaces made a whole skipped tier
 *  unreadable. */
let _reportedFailure = false;

async function trySetup(): Promise<boolean> {
  try {
    const mod = await import("bun-webgpu");
    if (typeof mod.setupGlobals !== "function") return false;
    await mod.setupGlobals({ libPath: resolveBunWebGpuLib() });
    const ok = typeof navigator !== "undefined" && !!navigator.gpu;
    _availableSync = ok;
    return ok;
  } catch (err) {
    if (!_reportedFailure) {
      _reportedFailure = true;
      console.warn(
        "[gpu-fixture] bun-webgpu setup failed; GPU tests will skip:",
        err,
      );
    }
    return false;
  }
}

/**
 * Synchronous availability check used by test.skipIf at module top-level.
 * Returns false until ensureBunWebGpu() has resolved successfully; the first
 * .gpu.test.ts run will therefore skip. Tests that want to hot-init the
 * fixture should call ensureBunWebGpu() inside the test body.
 */
export function bunWebGpuAvailable(): boolean {
  return _availableSync;
}

/**
 * Eagerly initialize the bun-webgpu globals. Returns true if navigator.gpu is now usable.
 * Idempotent.
 */
export function ensureBunWebGpu(): Promise<boolean> {
  if (_setup) return _setup;
  _setup = trySetup();
  return _setup;
}

/**
 * Construct a canvas-shaped object whose getContext("webgpu") returns a real
 * bun-webgpu GPUCanvasContextMock. Throws if bun-webgpu isn't available — callers
 * should gate on ensureBunWebGpu() / bunWebGpuAvailable() before invoking.
 */
export async function makeOffscreenCanvas(
  width = 800,
  height = 600,
): Promise<HTMLCanvasElement> {
  const ok = await ensureBunWebGpu();
  if (!ok) throw new Error("bun-webgpu not available");
  const mod = await import("bun-webgpu");
  const mockCtx = new mod.GPUCanvasContextMock(
    {
      width,
      height,
      clientWidth: width,
      clientHeight: height,
    } as unknown as HTMLCanvasElement,
    width,
    height,
  );
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext(kind: string) {
      return kind === "webgpu"
        ? (mockCtx as unknown as GPUCanvasContext)
        : null;
    },
  } as unknown as HTMLCanvasElement;
  return canvas;
}

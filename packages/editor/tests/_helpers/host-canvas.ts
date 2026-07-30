// The canvas a real `FieldHost` can `init` on under bun-webgpu.
//
// `makeOffscreenCanvas` (core's gpu-fixture) supplies the one thing bun-webgpu
// cannot fake by itself — a `getContext("webgpu")` that answers with a real
// GPUCanvasContextMock — and nothing else. `attachListeners` and the camera bind
// reach past that for DOM surface the mock has no notion of, so this wraps it
// with exactly what they touch and no more.
//
// Pass `listeners` to RECORD what the host registers, so a test can fire the
// host's own handlers with synthetic events. That is the only route to a gesture
// or a real stroke: `pointerdown` → `cursorRay` → `applyTool` has no method seam.
// Omit it and the registrations are dropped, which is what tests that drive the
// host through its methods want.
import { makeOffscreenCanvas } from "../../../core/tests/_helpers/gpu-fixture.ts";

/** The host's own event registrations, keyed by type, as a test collects them. */
export type HostListeners = Map<string, (e: unknown) => void>;

/**
 * A 64×64 fixture canvas with the DOM surface `FieldHost.init` needs.
 *
 * @param listeners - When given, every `addEventListener` call is recorded here
 *   instead of dropped.
 */
export async function makeHostCanvas(
  listeners?: HostListeners,
): Promise<HTMLCanvasElement> {
  const canvas = await makeOffscreenCanvas(64, 64);
  // Boundary cast: bun-webgpu's mock canvas stands in for HTMLCanvasElement.
  return Object.assign(canvas, {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners?.set(type, fn);
    },
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 64, height: 64 }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    style: {},
  }) as unknown as HTMLCanvasElement;
}

// resolveCssColor is the ONE token→engine-colour bridge (the M5B selection accent +
// viewport clear). These pins lock its two
// load-bearing behaviours: it reads sRGB bytes back from a 1×1 canvas 2D context,
// and it returns the caller's fallback when resolution is impossible.
//
// The real oklch→sRGB conversion is BROWSER-verified (canvas 2D in Safari/Chrome:
// oklch(0.62 0.11 240) → rgb(62,142,193)); happy-dom has no 2D raster, so these
// tests stub the canvas to return known bytes and pin the readback/normalize logic
// deterministically without depending on a CSS colour engine. We do NOT parse
// getComputedStyle().color: modern browsers PRESERVE oklch() there (CSS Color 4
// CSSOM serialization), which a string parse would mis-read as raw RGB.
//
// PLACEMENT: this file lives in tests/inspector/ (with the other DOM tests), NOT
// tests/, on purpose. bun test shares ONE process across files and walks top-level
// files before this subdir; `_register.ts` installs happy-dom's `navigator` (which
// has no `.gpu`), so a happy-dom test that runs BEFORE a top-level *.gpu.test.ts
// clobbers `navigator.gpu` and the GPU tests throw "WebGPU unavailable". Keeping DOM
// tests in this subdir keeps them after the top-level GPU files. Do not move this up.
import "./_register.ts";
import { afterEach, expect, test } from "bun:test";
import { resolveCssColor } from "../../src/frontend/lib/theme.ts";

const FALLBACK: [number, number, number] = [0.36, 0.58, 0.8];

// Stub document.createElement so a <canvas> yields a fake 2D context — the only way
// to exercise the raster path under happy-dom (no real 2D). Restored after each test.
const realCreateElement = document.createElement.bind(document);
afterEach(() => {
  document.createElement = realCreateElement as typeof document.createElement;
});

function stubCanvas(getContextResult: unknown): void {
  document.createElement = ((tag: string) =>
    tag === "canvas"
      ? ({ getContext: () => getContextResult } as unknown as HTMLElement)
      : realCreateElement(tag)) as typeof document.createElement;
}

test("resolveCssColor: reads back sRGB bytes from the canvas 2D context as [0,1] floats", () => {
  document.documentElement.style.setProperty("--probe", "oklch(0.62 0.11 240)");
  stubCanvas({
    fillStyle: "",
    fillRect: () => undefined,
    getImageData: () => ({ data: new Uint8ClampedArray([62, 142, 193, 255]) }),
  });
  expect(resolveCssColor("--probe", FALLBACK)).toEqual([
    62 / 255,
    142 / 255,
    193 / 255,
  ]);
});

test("resolveCssColor: returns the passed fallback when the 2D context is unavailable", () => {
  document.documentElement.style.setProperty("--probe2", "oklch(0.5 0.1 200)");
  stubCanvas(null);
  expect(resolveCssColor("--probe2", FALLBACK)).toEqual(FALLBACK);
});

test("resolveCssColor: returns the passed fallback for an unset custom property", () => {
  expect(resolveCssColor("--does-not-exist", FALLBACK)).toEqual(FALLBACK);
});

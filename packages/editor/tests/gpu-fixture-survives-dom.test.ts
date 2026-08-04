// The ordering that co-location makes routine and that today cannot happen: happy-dom
// registers FIRST, then a GPU test acquires a device. happy-dom replaces globalThis.navigator
// and takes navigator.gpu with it, and bun-webgpu's setupGlobals() CANNOT put it back
// (measured: "Attempted to assign to readonly property"). The fixture must re-attach it.
import { expect, test } from "bun:test";
import { ensureBunWebGpu } from "../../core/tests/_helpers/gpu-fixture.ts";

test("a device is acquirable after happy-dom has registered", async () => {
  expect(await ensureBunWebGpu()).toBe(true);

  const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
  const alreadyRegistered =
    typeof (globalThis as { document?: unknown }).document !== "undefined";
  // Captured before registration so they can be put back afterward — see the `finally`
  // below for why a targeted restore, not GlobalRegistrator.unregister(), is what runs
  // there.
  const originalFetch = globalThis.fetch;
  const hadCreateImageBitmap = "createImageBitmap" in globalThis;
  const hadImageData = "ImageData" in globalThis;
  if (!alreadyRegistered) {
    GlobalRegistrator.register();
  }

  try {
    // Without the fix this is false: happy-dom's navigator has no .gpu.
    expect(await ensureBunWebGpu()).toBe(true);
    expect(!!navigator.gpu).toBe(true);

    const adapter = await navigator.gpu.requestAdapter();
    expect(await adapter?.requestDevice()).toBeTruthy();
  } finally {
    // This file lives in bare tests/ so it proves the fix against the harshest ordering —
    // sibling GPU and daemon suites in the SAME bun process, not a namespaced subdir. A
    // registration left standing here leaks past this file: happy-dom's fetch enforces the
    // Same-Origin Policy, and its createImageBitmap/ImageData exist where bun's don't —
    // which together flip 14 unrelated tests in this process from pass to fail (measured:
    // 12 packages/editor/tests/server.test.ts + 1 bundle-watch.test.ts, both on the fetch
    // mechanism tests/chrome/keybindings-dom.test.ts already documents for bare tests/
    // placement; 1 packages/core/src/texture/load.gpu.test.ts on the ImageBitmap one).
    //
    // GlobalRegistrator.unregister() would fix that correctly but was measured to cost the
    // REST OF THE PROCESS ~3x wall-clock (65s baseline → 205s, confirmed via a clean
    // sequential A/B, not ambient load) — it restores ~100 happy-dom-only globals via
    // `delete globalThis[key]`, and a delete storm on the global object is a well-known
    // engine de-optimization trigger that a same-scale `Object.defineProperty` (what
    // `register()` itself uses, and what this file leans on below) does not trigger. A
    // handful of targeted deletes, restoring only the two globals actually observed to leak
    // (`createImageBitmap`, `ImageData` — a repo-wide grep for
    // `typeof <X> === "function"` found no third), reproduces none of that cost.
    if (!alreadyRegistered) {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
        writable: true,
      });
      if (!hadCreateImageBitmap)
        delete (globalThis as { createImageBitmap?: unknown })
          .createImageBitmap;
      if (!hadImageData)
        delete (globalThis as { ImageData?: unknown }).ImageData;
    }
  }
});

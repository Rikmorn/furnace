import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { registerBuiltins } from "./builtins.ts";
import * as scene from "./index.ts";
import { resetRegistryForTests } from "./registry.ts";
import type { SceneDocument } from "./types.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

// A camera-only scene (no meshes/materials needed) — the focus is the
// settings schema + ambient/post loader wiring, not rendering.
function cameraScene(
  settings: SceneDocument["settings"],
  resources: SceneDocument["resources"] = {},
): SceneDocument {
  return {
    version: 1,
    settings,
    resources,
    entities: [
      {
        id: "cam",
        components: {
          camera: { kind: "perspective", aspect: 1 },
          transform: { position: [0, 0, 3] },
        },
      },
    ],
  };
}

test.skipIf(!bunWebGpuAvailable())(
  "settings ambient + post resolve into LoadedScene.ambient + effects",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    // bloom requires an HDR context.
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      hdr: true,
    });

    const loaded = await scene.loadScene(
      ctx,
      cameraScene(
        {
          ambient: {
            sky: [0.5, 0.6, 0.7],
            ground: [0.1, 0.1, 0.1],
            intensity: 0.05,
          },
          post: ["fx_bloom"],
        },
        { effects: { fx_bloom: { kind: "bloom" } } },
      ),
    );

    expect(loaded.ambient).toEqual({
      sky: [0.5, 0.6, 0.7],
      ground: [0.1, 0.1, 0.1],
      intensity: 0.05,
    });
    expect(loaded.effects).toHaveLength(1);
    expect(loaded.effects[0]).toBeDefined();

    loaded.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "settings.post referencing an unknown effect id fails loud at load",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });

    await expect(
      scene.loadScene(ctx, cameraScene({ post: ["nope"] })),
    ).rejects.toThrow(/unknown effect.*nope/i);

    gpu.dispose(ctx);
  },
);

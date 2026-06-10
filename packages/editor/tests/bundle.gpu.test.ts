import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Cross-package test-helper import: core's bun-webgpu fixture (documented pattern).
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { createEngineBundler } from "../src/daemon/bundle.ts";
import type { ViewportHost } from "../src/viewport-host/index.ts";
import cubeScene from "./fixtures/mini-project/scenes/cube.scene.json";

await ensureBunWebGpu();

const FIXTURE = join(import.meta.dir, "fixtures", "mini-project");

async function importBundle(extensions: string | undefined): Promise<{
  createViewportHost: () => ViewportHost;
}> {
  const bundler = await createEngineBundler(FIXTURE, extensions);
  const result = await bundler.build();
  await bundler.dispose();
  if (!result.ok) throw new Error(result.error);
  const file = join(
    mkdtempSync(join(tmpdir(), "furnace-bundle-")),
    "engine.mjs",
  );
  writeFileSync(file, result.code);
  return import(file) as Promise<{ createViewportHost: () => ViewportHost }>;
}

test.skipIf(!bunWebGpuAvailable())(
  "THE BRANCH-A GATE: bundled consumer extension registers, reflects, loads, draws, destroys",
  async () => {
    const { createViewportHost } = await importBundle(
      "src/editor-extensions.ts",
    );
    const host = createViewportHost();
    const canvas = await makeOffscreenCanvas(64, 64);
    // Boundary cast: bun-webgpu's mock canvas stands in for HTMLCanvasElement.
    await host.init(canvas as unknown as HTMLCanvasElement, {
      surfaceFormat: "linear",
    });

    // 1. Reflection: the consumer's component came through the bundle.
    expect(host.introspect().components["fixtureGlow"]).toMatchObject({
      properties: { intensity: { type: "number" } },
    });

    // 2. Load + draw: the scene (which USES fixtureGlow) renders one mesh.
    await host.loadScene(cubeScene as never);

    // 3. Teardown: nothing leaks.
    host.destroy();
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "counter-gate: same scene WITHOUT the extension import fails loud naming fixtureGlow",
  async () => {
    const { createViewportHost } = await importBundle(undefined);
    const host = createViewportHost();
    const canvas = await makeOffscreenCanvas(64, 64);
    await host.init(canvas as unknown as HTMLCanvasElement, {
      surfaceFormat: "linear",
    });
    await expect(host.loadScene(cubeScene as never)).rejects.toThrow(
      /"fixtureGlow".*not registered.*imported/i,
    );
    host.destroy();
  },
);

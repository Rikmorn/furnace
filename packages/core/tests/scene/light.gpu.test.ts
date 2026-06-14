import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { registerBuiltins } from "../../src/scene/builtins.ts";
import { loadScene } from "../../src/scene/loader.ts";
import { resetRegistryForTests } from "../../src/scene/registry.ts";
import type { SceneDocument } from "../../src/scene/types.ts";
import { quat } from "../../src/transform/quat.ts";
import { vec3 } from "../../src/transform/vec3.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
resetRegistryForTests();
registerBuiltins();

test.skipIf(!bunWebGpuAvailable())(
  "light entity projects to LoadedScene.lights with derived direction",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const doc = {
      version: 1,
      settings: {},
      resources: {},
      entities: [
        // a camera so the scene loads (one camera per scene is required)
        {
          id: "cam",
          components: {
            camera: { kind: "perspective", aspect: 1 },
            transform: { position: [0, 0, 3] },
          },
        },
        // identity rotation → forward -Z
        {
          id: "key",
          components: {
            transform: { rotation: [0, 0, 0, 1] },
            light: { type: "directional", color: [1, 1, 1], intensity: 1 },
          },
        },
      ],
    } as unknown as SceneDocument;
    const loaded = await loadScene(ctx, doc);
    expect(loaded.lights.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    const l = loaded.lights[0]!;
    expect(l.type).toBe("directional");
    expect(
      (l as { direction: readonly number[] }).direction[2] as number,
    ).toBeCloseTo(-1, 5);
    loaded.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "directional light with 90° Y rotation derives direction [-1,0,0]",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    // 90° about +Y: rotates FORWARD [0,0,-1] → [-1,0,0] (right-handed Y-up).
    const q = quat.create();
    quat.fromAxisAngle(q, vec3.fromValues(0, 1, 0), Math.PI / 2);
    const rotation: [number, number, number, number] = [
      q[0] as number,
      q[1] as number,
      q[2] as number,
      q[3] as number,
    ];
    const doc = {
      version: 1,
      settings: {},
      resources: {},
      entities: [
        {
          id: "cam",
          components: {
            camera: { kind: "perspective", aspect: 1 },
            transform: { position: [0, 0, 3] },
          },
        },
        {
          id: "sun",
          components: {
            transform: { rotation },
            light: { type: "directional", color: [1, 1, 1], intensity: 1 },
          },
        },
      ],
    } as unknown as SceneDocument;
    const loaded = await loadScene(ctx, doc);
    expect(loaded.lights.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    const l = loaded.lights[0]!;
    expect(l.type).toBe("directional");
    const dir = (l as { direction: readonly number[] }).direction;
    expect(dir[0] as number).toBeCloseTo(-1, 5);
    expect(dir[1] as number).toBeCloseTo(0, 5);
    expect(dir[2] as number).toBeCloseTo(0, 5);
    loaded.destroy();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "point light entity projects position and carries no direction field",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const doc = {
      version: 1,
      settings: {},
      resources: {},
      entities: [
        {
          id: "cam",
          components: {
            camera: { kind: "perspective", aspect: 1 },
            transform: { position: [0, 0, 3] },
          },
        },
        {
          id: "pt",
          components: {
            transform: { position: [2, 3, 4] },
            light: { type: "point", color: [1, 1, 1], intensity: 1 },
          },
        },
      ],
    } as unknown as SceneDocument;
    const loaded = await loadScene(ctx, doc);
    expect(loaded.lights.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    const l = loaded.lights[0]!;
    expect(l.type).toBe("point");
    const pos = (l as { position: readonly number[] }).position;
    expect(pos[0] as number).toBeCloseTo(2, 5);
    expect(pos[1] as number).toBeCloseTo(3, 5);
    expect(pos[2] as number).toBeCloseTo(4, 5);
    expect("direction" in l).toBe(false);
    loaded.destroy();
    gpu.dispose(ctx);
  },
);

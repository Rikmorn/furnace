// Slice 3.1 · Task 12 — the P4 preview-at-scale PROBE (spec §7 Pr-3).
//
// A MEASUREMENT, not a gate: does the cockpit preview path survive a full generated wing
// at the cockpit config BEFORE curation UX builds on it? It times (a) the total
// `realizeRegion` wall-clock for every generated piece of a wing, and (b) the mean of 60
// sequential `frame.render` calls — mirroring main.ts's HDR render options (hdr context,
// bloom→tonemap, fog, ambient). The numbers are logged as the probe deliverable.
//
// Dungeon-side (not the editor host wrapper) because P4's question is realize + render cost,
// which lives here in `realizeRegion` + a plain HDR context — the same path the cockpit
// preview host drives. Assertion FLOORS only (working-standards: perf creaking at scale is
// prioritization signal, not a gate); the console.info line is what the probe reports.
import { expect, test } from "bun:test";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import * as post from "@furnace/core/post";
import { vec3, vec4 } from "@furnace/core/transform";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import { buildWorld, COCKPIT_BUDGET, COCKPIT_CONFIG } from "../src/world.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// A base seed that places under COCKPIT_CONFIG. buildWorld retries derived seeds (seed:1,
// seed:2, …) up to COCKPIT_CONFIG.attempts (12), so the base only needs one attempt in that
// window to yield a placed wing. "wing-1" verified placing in this session (see report).
const SEED = "wing-1";

// Assertion floors — MEASURED, not gated. Generous headroom above the observed numbers; a
// breach is a REAL finding (report it, do NOT weaken the floor).
const REALIZE_FLOOR_MS = 30_000;
const RENDER_MEAN_FLOOR_MS = 100;
const RENDER_SAMPLES = 60;

const FOG_COLOR: [number, number, number] = [0.015, 0.02, 0.03];

test.skipIf(!bunWebGpuAvailable())(
  "preview realizes + renders a full wing at cockpit scale",
  async () => {
    // 1) Generate a full wing at the cockpit config (authored phantom excluded — it has no
    //    meshes; main.ts realizes the authored level itself).
    const { layout } = buildWorld(SEED, COCKPIT_CONFIG, COCKPIT_BUDGET);
    const pieces = [
      ...layout.regions.filter((r) => r.provenance.theme !== "authored"),
      ...layout.connectors,
    ];

    // 2) HDR context (+ MSAA, mirroring main.ts) + physics world + MaterialCache. The
    //    bun-webgpu mock needs surfaceFormat:"linear" (see gpu-fixture.ts) alongside hdr.
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, {
      sampleCount: 4,
      hdr: true,
      surfaceFormat: "linear",
    });
    const world = await physics.createWorld(ctx, {
      gravity: [0, -9.81, 0],
      lengthUnit: 1,
    });
    const matCache = new MaterialCache(ctx);

    // 3) TIME realize — every piece, SEQUENTIALLY (MaterialCache is not concurrency-safe).
    const tRealize0 = performance.now();
    const area: Awaited<ReturnType<typeof realizeRegion>>[] = [];
    for (const r of pieces)
      area.push(await realizeRegion(ctx, world, matCache, r));
    const realizeMs = performance.now() - tRealize0;

    const meshes = area.flatMap((a) => a.meshes);
    const instanced = area.flatMap((a) => a.instanced);

    // 4) Post chain + camera + render options (mirror main.ts).
    const bloom = await post.bloom(ctx, {
      intensity: 0.9,
      threshold: 1.0,
      softness: 0.2,
    });
    const tonemap = await post.tonemap(ctx, {
      exposure: 1.0,
      operator: "neutral",
    });
    const cam = camera.perspective({
      position: vec3.fromValues(0, 3, 12),
      target: vec3.fromValues(0, 0, 0),
    });
    const fog: frame.Fog = { color: FOG_COLOR, density: 0.12 };
    const ambient: frame.Ambient = {
      sky: [0.06, 0.07, 0.1],
      ground: [0.02, 0.02, 0.03],
      intensity: 0.4,
    };
    const renderOpts: frame.RenderOptions = {
      meshes,
      instanced,
      camera: cam,
      clearColor: vec4.fromValues(FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2], 1),
      lights: [],
      ambient,
      fog,
      effects: [bloom, tonemap],
    };

    // 5) TIME 60 sequential renders (one warm-up first, not timed).
    frame.render(ctx, renderOpts);
    const tRender0 = performance.now();
    for (let i = 0; i < RENDER_SAMPLES; i++) frame.render(ctx, renderOpts);
    const renderMeanMs = (performance.now() - tRender0) / RENDER_SAMPLES;

    console.info(
      `P4 preview-scale: seed=${SEED} pieces=${pieces.length} meshes=${meshes.length} instanced=${instanced.length} realizeMs=${realizeMs.toFixed(0)} renderMeanMs=${renderMeanMs.toFixed(2)}`,
    );

    // MEASURED, not gated — floors only. A breach is a real finding, not a reason to relax.
    expect(realizeMs).toBeLessThan(REALIZE_FLOOR_MS);
    expect(renderMeanMs).toBeLessThan(RENDER_MEAN_FLOOR_MS);

    // Teardown in reverse dependency order (mirror main.ts): regions before matCache (meshes
    // reference its materials), then effects, world, and gpu.dispose LAST — it warns on any
    // leaked resource-manager slot, so a clean shutdown IS the leak check.
    for (const a of area) a.destroy();
    matCache.destroy();
    post.destroy(ctx, bloom);
    post.destroy(ctx, tonemap);
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

// THE PROJECT-FIRST GATE. Everything else about the bundle is a string check
// (bundle.test.ts, "does `createFieldHost` appear in the output"); this file is the only
// place the bundled graph is EXECUTED — built from the fixture project's root, written to
// disk, imported, and driven against a real bun-webgpu device until it draws.
//
// WHAT THE SCENE-ERA VERSION PROVED AND THIS ONE DOES NOT: the old gate booted
// `createViewportHost` and asserted `introspect()` saw the fixture's `defineComponent`
// registration, then loaded a scene that used it — a direct proof that the consumer's
// extension module and the host shared ONE core instance. A counter-gate pinned the other
// direction (same scene, extension import removed, load fails loud naming `fixtureGlow`).
// The scene path is gone and there is no field-side equivalent: core's `FIELD_GENERATORS`
// is a fixed const array, not a registry a consumer can extend, so nothing a project
// registers is observable through `FieldHost`. What survives here is the other half —
// "the bundled consumer graph boots and draws" — plus bundle.test.ts's containment check
// that the consumer's module is in the output at all.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldManifest, MaterialTable } from "@furnace/core/field";
import {
  AIR,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  DEFAULT_CELL_SIZE,
  encodeChunkFile,
  SOLID,
} from "@furnace/core/field";
import { consoleSink, setSink } from "@furnace/core/log";
// Cross-package test-helper imports: core's bun-webgpu fixture (documented pattern).
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
} from "../../core/tests/_helpers/gpu-fixture.ts";
import { installMockResizeObserver } from "../../core/tests/_helpers/mock-resize-observer.ts";
import { createEngineBundler } from "../src/daemon/bundle.ts";
import type {
  FieldHost,
  FieldStats,
  FieldTool,
} from "../src/field-host/index.ts";
import { makeHostCanvas } from "./_helpers/host-canvas.ts";
import { stubAnimationFrameCaptured } from "./_helpers/raf.ts";

await ensureBunWebGpu();

// The host binds its canvas through core's resize path, which lazily creates a
// ResizeObserver. bun-webgpu does not provide one, so install the core mock globally
// before any test runs — the bundled engine.mjs shares this process, so it picks up
// globalThis.ResizeObserver at call time.
installMockResizeObserver();

// The host requests its context WITHOUT `surfaceFormat: "linear"`, so under bun-webgpu
// `createView({ format: "bgra8unorm-srgb" })` fails validation against the mock canvas's
// texture (see the gpu-fixture header). It fails ASYNCHRONOUSLY, as uncaptured device
// errors rather than a throw, so the frame still completes and everything upstream of the
// submit is exercised for real. Muted so the expected wall of device errors does not
// drown the suite — the `field-host-analyzer.gpu.test.ts` pattern, and the reason the
// assertion below is "the tool wrote cells and the frame ran clean" rather than a pixel
// read.
beforeAll(() => setSink(null));
afterAll(() => setSink(consoleSink));

const FIXTURE = join(import.meta.dir, "fixtures", "mini-project");

const ROCK_ONLY: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
  ],
};

const DIG_TOOL: FieldTool = {
  effect: "dig",
  materialId: 0,
  mask: { kind: "none" },
  smooth: { strength: 16, iterations: 1, mode: "both" },
  hollow: null,
};

/** One chunk with a room carved out of it, so the world the bundled host loads has real
 *  geometry to remesh and the dig has somewhere to land. */
const ROOM = { floorY: 4, topY: 15, xz: [1, 14] } as const;

const roomChunk = (): Uint8Array => {
  const density = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
  for (let z = ROOM.xz[0]; z <= ROOM.xz[1]; z++)
    for (let y = ROOM.floorY; y <= ROOM.topY; y++)
      for (let x = ROOM.xz[0]; x <= ROOM.xz[1]; x++)
        density[x + CHUNK_DIM * (y + CHUNK_DIM * z)] = AIR;
  return encodeChunkFile(density);
};

const MANIFEST: FieldManifest = {
  version: 2,
  kind: "field",
  cellSize: DEFAULT_CELL_SIZE,
  playerStart: [
    4 * DEFAULT_CELL_SIZE,
    4.5 * DEFAULT_CELL_SIZE,
    6 * DEFAULT_CELL_SIZE,
  ],
  playerYaw: 0,
  chunks: [],
  meshes: [],
};

async function importBundle(extensions: string | undefined): Promise<{
  createFieldHost: () => FieldHost;
  extensions: Record<string, unknown>;
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
  return import(file) as Promise<{
    createFieldHost: () => FieldHost;
    extensions: Record<string, unknown>;
  }>;
}

test.skipIf(!bunWebGpuAvailable())(
  "THE PROJECT-FIRST GATE: the bundled consumer graph boots a field host, digs, and draws",
  async () => {
    const mod = await importBundle("src/editor-extensions.ts");
    // The consumer's own module crossed the bundle boundary as `extensions` — the seam
    // the chrome reads it through (see daemon/bundle.ts's virtual entry).
    expect(mod.extensions).toBeDefined();

    // The CAPTURED rAF variant: a hand-driven tick is the only way to make the host
    // render on demand. The canvas records its listeners so the test can fire the
    // host's own pointer handler — the only route to a real stroke.
    const raf = stubAnimationFrameCaptured();
    const listeners = new Map<string, (e: unknown) => void>();
    const host = mod.createFieldHost();
    try {
      host.setMaterialTable(ROCK_ONLY);
      // No agent profile: the walkability analyzer never spawns, so the bundled graph is
      // exercised without a Worker (one never settles in-process under `bun test`).
      host.loadWorld({
        manifest: MANIFEST,
        chunks: [{ key: chunkKey(0, 0, 0), bytes: roomChunk() }],
        oplog: null,
      });
      await host.init(await makeHostCanvas(listeners));

      const errors: string[] = [];
      host.subscribeToolError((m) => errors.push(m));
      const stats: FieldStats[] = [];
      host.subscribeStats((s) => stats.push(s));

      // 1. One dig, through the host's real pointer path. `setGesture(null)` is
      // what ARMS the brush: a host opens with the pointer gesture armed
      // (D-F4.5-7), where LMB selects rather than strokes, and the chrome's own
      // brush pick is what disarms it in the product.
      host.setGesture(null);
      host.setTool(DIG_TOOL);
      host.setDigRadius(0.75);
      const pointerdown = listeners.get("pointerdown");
      if (pointerdown === undefined)
        throw new Error(
          "test: the bundled host registered no pointerdown listener",
        );
      pointerdown({
        button: 0,
        altKey: false,
        clientX: 32,
        clientY: 32,
        pointerId: 1,
      });

      // 2. One frame of the host's own loop — the render path, end to end. Stats are
      // pushed at the top of the tick, so this is also how the dig becomes observable.
      raf.tick(16);
      const s = stats.at(-1);
      // The world loaded into the bundled host's own store…
      expect(s?.chunks).toBeGreaterThan(0);
      // …and the stroke reached the field: an op was logged. A dig that silently no-op'd
      // (wrong core instance, unregistered material, dead raycast) leaves this at 0.
      expect(s?.totalOps).toBeGreaterThan(0);

      // 3. Clean: no swallowed tool failure anywhere in the stroke or the frame.
      expect(errors).toEqual([]);
    } finally {
      host.dispose();
      raf.restore();
    }
  },
);

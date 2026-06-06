import type { Binding } from "@furnace/core/binding";
import * as binding from "@furnace/core/binding";
import type { Camera } from "@furnace/core/camera";
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as geometry from "@furnace/core/geometry";
import type { Context } from "@furnace/core/gpu";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import type { Effect } from "@furnace/core/post";
import * as post from "@furnace/core/post";
import type { Shader } from "@furnace/core/shader";
import * as shader from "@furnace/core/shader";
import type { Quat, Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";

import { mountDemo } from "../../shared/mount.ts";
import blurShaderUrl from "./blur.wgsl";
import Controls from "./controls.svelte";
import help from "./help.ts";
import { state } from "./state.svelte.ts";
import vignetteShaderUrl from "./vignette.wgsl";

const CAMERA_Z = 3.5;
const ROTATION_SPEED_RAD_PER_S = 0.5;
const MS_PER_S = 1000;

/** @group(1) param schemas — field order + tokens match the WGSL structs. */
const VIGNETTE_LAYOUT = { strength: "f32", falloff: "f32" } as const;
/** Consumer blur direction + per-tap UV offset (matches blur.wgsl BlurParams). */
const BLUR_LAYOUT = { dir: "vec2f", radius: "f32" } as const;

/** A bright (>1.0) white emissive so bloom has a true HDR source to extract.
 *  On an LDR clamp this would just be white; under HDR it survives as a real
 *  super-bright value that the bloom prefilter can pull a halo from. */
const EMISSIVE_COLOR: Vec4 = vec4.fromValues(3, 3, 3, 1);
const ACCENT_SIZE = 0.35;
const ACCENT_OFFSET = vec3.fromValues(0.9, 0.6, 0);
/** Per-tap UV offset for the separable blur (~3 px on a 1000-wide canvas). */
const BLUR_RADIUS = 0.003;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.02, 0.02, 0.03, 1);

// Cookbook escape hatch: controls callbacks reach the setup-scope effect
// recreate via these globals. Mirrors cookbook/render-target's pattern — the
// callbacks are defined at mountDemo-call time (before setup runs), so they
// cannot close over the scene directly.
declare global {
  interface Window {
    __cookbookPostRecreateTonemap?: () => Promise<void>;
    __cookbookPostRecreateBloom?: () => Promise<void>;
  }
}

type Scene = {
  cube: ReturnType<typeof mesh.create>;
  accent: ReturnType<typeof mesh.create>;
  cam: Camera;
  vignette: Effect;
  vignetteShader: Shader;
  vignetteBinding: Binding;
  blur: Effect;
  blurShader: Shader;
  blurBindingH: Binding;
  blurBindingV: Binding;
  /** Recreated when operator/exposure change — always the FINAL effect. */
  tonemap: Effect;
  /** Recreated when intensity changes. */
  bloom: Effect;
  rotBuf: Quat;
};

async function loadShaderSource(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`[furnace/cookbook] post shader load: HTTP ${resp.status}`);
  }
  return resp.text();
}

type AbortFlag = { disposed: boolean };
type Queue = { inFlight: boolean; pending: boolean };

/**
 * Wrap an async "destroy old + create new" recreate in a single-in-flight,
 * one-pending queue. Rapid slider releases coalesce to one trailing rebuild;
 * the rebuild always reads the latest `state`, and never leaks (the old effect
 * is destroyed before the new one is assigned; a rebuild that finishes after
 * dispose destroys its fresh effect instead of leaking it).
 */
function makeRecreate(
  rebuildOnce: () => Promise<void>,
  abortFlag: AbortFlag,
): () => Promise<void> {
  const queue: Queue = { inFlight: false, pending: false };
  return async () => {
    if (queue.inFlight) {
      queue.pending = true;
      return;
    }
    queue.inFlight = true;
    try {
      do {
        queue.pending = false;
        await rebuildOnce();
        if (abortFlag.disposed) return;
      } while (queue.pending);
    } finally {
      queue.inFlight = false;
    }
  };
}

/** Build the consumer 2-pass separable blur from one shader + two direction
 *  bindings. Pass H writes a named intermediate; pass V reads it → chain output.
 *  Returns the effect plus its consumer-owned resources (shader + the two
 *  direction bindings) — the demo frees them in teardown. createPasses does NOT
 *  free them: consumer-supplied bindings/shaders stay consumer-owned. */
async function buildBlur(ctx: Context): Promise<{
  blur: Effect;
  blurShader: Shader;
  bindingH: Binding;
  bindingV: Binding;
}> {
  const blurSource = await loadShaderSource(blurShaderUrl);
  const blurShader = await shader.create(ctx, blurSource, {
    layout: BLUR_LAYOUT,
  });
  const bindingH = binding.create(ctx, blurShader);
  const bindingV = binding.create(ctx, blurShader);
  binding.set(ctx, bindingH, { dir: [1, 0], radius: BLUR_RADIUS });
  binding.set(ctx, bindingV, { dir: [0, 1], radius: BLUR_RADIUS });
  const blur = await post.createPasses(ctx, {
    passes: [
      {
        shader: blurShader,
        inputs: ["scene"],
        output: { intermediate: "blurH" },
        binding: bindingH,
      },
      {
        shader: blurShader,
        inputs: [{ intermediate: "blurH" }],
        output: {},
        binding: bindingV,
      },
    ],
  });
  return { blur, blurShader, bindingH, bindingV };
}

await mountDemo({
  help,
  controls: Controls,
  ctxOptions: { hdr: true },
  controlsProps: {
    get operator() {
      return state.operator;
    },
    get exposure() {
      return state.exposure;
    },
    get bloomIntensity() {
      return state.bloomIntensity;
    },
    get bloomOn() {
      return state.bloomOn;
    },
    get blurOn() {
      return state.blurOn;
    },
    get vignetteOn() {
      return state.vignetteOn;
    },
    get vignetteStrength() {
      return state.vignetteStrength;
    },
    get vignetteFalloff() {
      return state.vignetteFalloff;
    },
    onOperatorChange: (v: typeof state.operator) => {
      state.operator = v;
      void window.__cookbookPostRecreateTonemap?.();
    },
    onExposureChange: (v: number) => {
      state.exposure = v;
    },
    onExposureCommit: (v: number) => {
      state.exposure = v;
      void window.__cookbookPostRecreateTonemap?.();
    },
    onBloomIntensityChange: (v: number) => {
      state.bloomIntensity = v;
    },
    onBloomIntensityCommit: (v: number) => {
      state.bloomIntensity = v;
      void window.__cookbookPostRecreateBloom?.();
    },
    onBloomOnChange: (v: boolean) => {
      state.bloomOn = v;
    },
    onBlurOnChange: (v: boolean) => {
      state.blurOn = v;
    },
    onVignetteOnChange: (v: boolean) => {
      state.vignetteOn = v;
    },
    onVignetteStrengthChange: (v: number) => {
      state.vignetteStrength = v;
    },
    onVignetteFalloffChange: (v: number) => {
      state.vignetteFalloff = v;
    },
  },
  setup: async (ctx) => {
    // Consumer single-pass vignette (kept from the LDR demo) — clean 1-in-1-out.
    const vignetteSource = await loadShaderSource(vignetteShaderUrl);
    const vignetteShader = await shader.create(ctx, vignetteSource, {
      layout: VIGNETTE_LAYOUT,
    });
    const vignetteBinding = binding.create(ctx, vignetteShader);
    const vignette = await post.create(ctx, {
      shader: vignetteShader,
      binding: vignetteBinding,
    });

    const { blur, blurShader, bindingH, bindingV } = await buildBlur(ctx);

    // Built-in effects (recreated on param change). tonemap is ALWAYS the final
    // effect under HDR — a non-empty chain reaching the LDR swapchain is required.
    const bloom = await post.bloom(ctx, { intensity: state.bloomIntensity });
    const tonemap = await post.tonemap(ctx, {
      operator: state.operator,
      exposure: state.exposure,
    });

    // Scene: a rotating normalColor cube + a bright unlit accent (the emissive
    // source bloom extracts from).
    const normalMat = await material.create(ctx, {
      shader: await shader.normalColor(ctx),
    });
    const cubeGeo = geometry.cube(ctx);
    const cube = mesh.create(ctx, { geometry: cubeGeo, material: normalMat });

    const unlitShader = await shader.unlit(ctx);
    const accentBinding = binding.create(ctx, unlitShader);
    binding.set(ctx, accentBinding, { color: EMISSIVE_COLOR });
    const accentMat = await material.create(ctx, {
      shader: unlitShader,
      binding: accentBinding,
    });
    const accentGeo = geometry.cube(ctx, { size: ACCENT_SIZE });
    const accent = mesh.create(ctx, {
      geometry: accentGeo,
      material: accentMat,
    });
    mesh.setPosition(ctx, accent, ACCENT_OFFSET);

    const cam = camera.perspective({
      aspect: ctx.canvas.width / ctx.canvas.height,
      position: vec3.fromValues(0, 0, CAMERA_Z),
    });
    camera.bindToCanvas(ctx, cam);

    const scene: Scene = {
      cube,
      accent,
      cam,
      vignette,
      vignetteShader,
      vignetteBinding,
      blur,
      blurShader,
      blurBindingH: bindingH,
      blurBindingV: bindingV,
      tonemap,
      bloom,
      rotBuf: quat.create(),
    };

    const abortFlag: AbortFlag = { disposed: false };
    window.__cookbookPostRecreateTonemap = makeRecreate(async () => {
      const next = await post.tonemap(ctx, {
        operator: state.operator,
        exposure: state.exposure,
      });
      if (abortFlag.disposed) {
        post.destroy(ctx, next);
        return;
      }
      post.destroy(ctx, scene.tonemap);
      scene.tonemap = next;
    }, abortFlag);
    window.__cookbookPostRecreateBloom = makeRecreate(async () => {
      const next = await post.bloom(ctx, { intensity: state.bloomIntensity });
      if (abortFlag.disposed) {
        post.destroy(ctx, next);
        return;
      }
      post.destroy(ctx, scene.bloom);
      scene.bloom = next;
    }, abortFlag);

    return {
      scene,
      dispose: () => {
        // gpu.dispose (mountDemo's cleanup) cascades meshes/materials/geometry/
        // effects + the engine-owned bindings inside built-in effects (bloom +
        // tonemap), and auto-disconnects the resize binding. Consumer-owned
        // resources — the two consumer post shaders (vignette + blur) and their
        // three @group(1) bindings (blurH, blurV, vignette) — are freed here.
        // Clear the recreate globals first so an in-flight rebuild that resolves
        // after dispose destroys its fresh effect (abortFlag) rather than
        // assigning into a torn-down scene.
        abortFlag.disposed = true;
        window.__cookbookPostRecreateTonemap = undefined;
        window.__cookbookPostRecreateBloom = undefined;
        binding.destroy(ctx, scene.blurBindingH);
        binding.destroy(ctx, scene.blurBindingV);
        binding.destroy(ctx, scene.vignetteBinding);
        shader.destroy(ctx, scene.blurShader);
        shader.destroy(ctx, scene.vignetteShader);
      },
    };
  },
  frame: ({ ctx, scene, info }) => {
    state.angle += (info.deltaMs / MS_PER_S) * ROTATION_SPEED_RAD_PER_S;
    quat.fromEuler(scene.rotBuf, 0, state.angle, 0);
    mesh.setRotation(ctx, scene.cube, scene.rotBuf);
    mesh.setRotation(ctx, scene.accent, scene.rotBuf);

    // Vignette params are live (cheap) — written every frame.
    binding.set(ctx, scene.vignetteBinding, {
      strength: state.vignetteStrength,
      falloff: state.vignetteFalloff,
    });

    // Chain: enabled mid-chain effects, then tonemap ALWAYS last + always
    // present (HDR requires a non-empty chain reaching the LDR swapchain).
    const midChain: Effect[] = [];
    if (state.bloomOn) midChain.push(scene.bloom);
    if (state.blurOn) midChain.push(scene.blur);
    if (state.vignetteOn) midChain.push(scene.vignette);

    frame.render(ctx, {
      meshes: [scene.cube, scene.accent],
      camera: scene.cam,
      effects: [...midChain, scene.tonemap],
      clearColor: CLEAR_COLOR,
    });
  },
});

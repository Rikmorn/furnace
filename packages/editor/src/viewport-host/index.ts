import * as frame from "@furnace/core/frame";
import type { Context, RequestContextOptions } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import type {
  LoadedScene,
  SceneDocument,
  SceneSchemaReflection,
} from "@furnace/core/scene";
import * as scene from "@furnace/core/scene";
import type { Vec4 } from "@furnace/core/transform";
import { vec4 } from "@furnace/core/transform";

/**
 * The chrome↔engine protocol. The editor chrome (which contains no engine
 * code) drives the viewport exclusively through this interface; the host owns
 * the GPU context and the loaded scene. Render-on-demand: a render is issued
 * on load; nothing animates in M3.
 */
export type ViewportHost = {
  init(
    canvas: HTMLCanvasElement,
    gpuOptions?: RequestContextOptions,
  ): Promise<void>;
  loadScene(doc: SceneDocument): Promise<void>;
  introspect(): SceneSchemaReflection;
  destroy(): void;
};

// Boundary: scene-document settings store clearColor as a hand-authored RGBA
// tuple, but frame.render wants a Vec4 (Float32Array). Convert at the call
// site; undefined passes through so render falls back to its own default.
function toVec4(
  rgba: readonly [number, number, number, number] | undefined,
): Vec4 | undefined {
  return rgba ? vec4.fromValues(rgba[0], rgba[1], rgba[2], rgba[3]) : undefined;
}

/** Create an uninitialized viewport host. Call `init` before `loadScene`. */
export function createViewportHost(): ViewportHost {
  let ctx: Context | undefined;
  let loaded: LoadedScene | undefined;

  const requireCtx = (): Context => {
    if (!ctx)
      throw new Error("viewport-host: init(canvas) must be called first");
    return ctx;
  };

  return {
    async init(canvas, gpuOptions) {
      if (ctx) throw new Error("viewport-host: already initialized");
      ctx = await gpu.requestContext(canvas, gpuOptions);
    },
    async loadScene(doc) {
      const c = requireCtx();
      // Destroy-before-build: M2's partial-load cleanup guarantees a failed
      // load leaks nothing; the viewport simply ends up empty.
      loaded?.destroy();
      loaded = undefined;
      loaded = await scene.loadScene(c, doc);
      frame.render(c, {
        meshes: loaded.meshes,
        camera: loaded.camera,
        clearColor: toVec4(loaded.settings.clearColor),
      });
    },
    introspect: () => scene.introspect(),
    destroy() {
      loaded?.destroy();
      loaded = undefined;
      if (ctx) gpu.dispose(ctx);
      ctx = undefined;
    },
  };
}

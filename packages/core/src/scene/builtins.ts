import { z } from "zod";
import * as binding from "../binding/index.ts";
import type { Binding } from "../binding/types.ts";
import * as camera from "../camera/index.ts";
import * as geometry from "../geometry/index.ts";
import type { Context } from "../gpu/context-types.ts";
import * as material from "../material/index.ts";
import * as mesh from "../mesh/index.ts";
import type { Mesh } from "../mesh/types.ts";
import * as shader from "../shader/index.ts";
import { quat } from "../transform/quat.ts";
import { vec3 } from "../transform/vec3.ts";
import { vec4 } from "../transform/vec4.ts";
import {
  defineComponent,
  defineResource,
  getComponent,
  setSettingsSchema,
} from "./registry.ts";
import * as t from "./t.ts";

const transformShape = {
  position: t.vec3().optional(),
  rotation: t.quat().optional(),
  scale: t.vec3().optional(),
};

const cameraShape = {
  kind: z.literal("perspective"),
  aspect: z.number(),
  fovYRad: z.number().optional(),
  near: z.number().optional(),
  far: z.number().optional(),
};

const settingsShape = {
  clearColor: t.color().optional(),
};

/** Local-transform component params. Rotation is a quaternion `[x,y,z,w]`; omitted fields keep identity defaults. */
export type TransformParams = z.infer<z.ZodObject<typeof transformShape>>;
/** Camera component params (non-spatial; pose comes from the entity's transform). */
export type CameraParams = z.infer<z.ZodObject<typeof cameraShape>>;
/** Scene-level render/world globals. M2 content: clearColor only. */
export type SceneSettings = z.infer<z.ZodObject<typeof settingsShape>>;

/** Apply a transform component's params to a mesh. Omitted fields keep the mesh's identity defaults. */
function applyTransform(
  ctx: Context,
  m: Mesh,
  tf: TransformParams | undefined,
): void {
  if (!tf) return;
  if (tf.position) {
    mesh.setPosition(
      ctx,
      m,
      vec3.fromValues(tf.position[0], tf.position[1], tf.position[2]),
    );
  }
  if (tf.rotation) {
    mesh.setRotation(
      ctx,
      m,
      quat.fromValues(
        tf.rotation[0],
        tf.rotation[1],
        tf.rotation[2],
        tf.rotation[3],
      ),
    );
  }
  if (tf.scale) {
    mesh.setScale(
      ctx,
      m,
      vec3.fromValues(tf.scale[0], tf.scale[1], tf.scale[2]),
    );
  }
}

/**
 * Register the built-in component types, resource kinds, and the settings
 * schema. Runs once at `@furnace/core/scene` module init — the same
 * side-effect path consumer extensions use. Exported (internally) so test
 * suites can re-register after `resetRegistryForTests`; NOT part of the
 * public scene surface. Idempotent: a second call without an intervening
 * `resetRegistryForTests` is a no-op (guards on the sentinel "transform"
 * component already being present in the registry).
 */
export function registerBuiltins(): void {
  if (getComponent("transform")) return;
  // --- components ---
  defineComponent("transform", { params: transformShape }); // pure data

  defineComponent("meshRenderer", {
    params: {
      geometry: t.resource("geometries"),
      material: t.resource("materials"),
    },
    build(ctx, bx) {
      const m = mesh.create(ctx, {
        geometry: bx.params.geometry,
        material: bx.params.material,
      });
      // Boundary cast: sibling params were validated against the transform
      // schema at the load boundary; the type system can't carry that link.
      applyTransform(
        ctx,
        m,
        bx.sibling("transform") as TransformParams | undefined,
      );
      bx.out.addMesh(m);
      return m;
    },
    destroy: (ctx, m) => mesh.destroy(ctx, m),
  });

  defineComponent("camera", {
    params: cameraShape,
    build(_ctx, bx) {
      // Boundary cast: see meshRenderer.
      const tf = bx.sibling("transform") as TransformParams | undefined;
      const p = tf?.position ?? [0, 0, 0];
      // Identity-rotation only — forward is -Z (engine right-handed Y-up);
      // general quaternion → look-direction is a follow-on slice.
      const cam = camera.perspective({
        aspect: bx.params.aspect,
        fovYRad: bx.params.fovYRad,
        near: bx.params.near,
        far: bx.params.far,
        position: vec3.fromValues(p[0], p[1], p[2]),
        target: vec3.fromValues(p[0], p[1], p[2] - 1),
      });
      bx.out.setCamera(cam);
      return cam;
    },
    // No destroy: Camera is a CPU-side value, not a pooled GPU resource.
  });

  // --- resource kinds ---
  defineResource("geometries", "cube", {
    build: (ctx) => geometry.cube(ctx),
    destroy: (ctx, g) => geometry.destroy(ctx, g),
  });

  defineResource("shaders", "unlit", {
    // Boundary cast: unlit returns Shader<{color:"vec4f"}> — widened so all
    // shaders fit the uniform table.
    build: (ctx) => shader.unlit(ctx) as Promise<shader.Shader>,
    // No destroy: built-in shaders are ctx-cached singletons.
  });

  defineResource("materials", "standard", {
    params: {
      shader: t.resource("shaders"),
      params: z.strictObject({ color: t.color().optional() }).optional(),
    },
    async build(ctx, rx) {
      const s = rx.params.shader;
      const color = rx.params.params?.color;
      if (color !== undefined) {
        const b = binding.create(ctx, s);
        try {
          binding.set(ctx, b, {
            color: vec4.fromValues(color[0], color[1], color[2], color[3]),
          });
          return {
            material: await material.create(ctx, { shader: s, binding: b }),
            binding: b,
          };
        } catch (err) {
          // Atomic build: if material.create (or set) throws after the binding
          // is allocated, free it here — the loader only owns what build RETURNS,
          // so an un-returned binding would otherwise leak.
          binding.destroy(ctx, b);
          throw err;
        }
      }
      // No params: valid only for shaders with no @group(1) layout.
      return {
        material: await material.create(ctx, { shader: s }),
        binding: undefined as Binding | undefined,
      };
    },
    handle: (i) => i.material,
    destroy: (ctx, i) => {
      material.destroy(ctx, i.material);
      if (i.binding) binding.destroy(ctx, i.binding);
    },
  });

  // --- settings (the second reflection surface) ---
  setSettingsSchema(settingsShape);
}

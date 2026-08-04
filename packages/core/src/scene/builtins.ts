import { z } from "zod";
import * as binding from "../binding/index.ts";
import type { Binding } from "../binding/types.ts";
import * as camera from "../camera/index.ts";
import { FurnaceError } from "../errors.ts";
import type { DirectionalShadow, Light, SpotShadow } from "../frame/index.ts";
import * as geometry from "../geometry/index.ts";
import type { Geometry } from "../geometry/types.ts";
import type { Context } from "../gpu/context-types.ts";
import * as material from "../material/index.ts";
import type { Material } from "../material/types.ts";
import * as mesh from "../mesh/index.ts";
import type { Mesh } from "../mesh/types.ts";
import { decodeMeshBlob } from "../mesh-blob/index.ts";
import type { ShapeDescriptor } from "../physics/index.ts";
import * as post from "../post/index.ts";
import * as rigidMesh from "../rigid-mesh/index.ts";
import * as shader from "../shader/index.ts";
import * as texture from "../texture/index.ts";
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

const samplerShape = z.strictObject({
  maxAnisotropy: z.number().optional(),
  magFilter: z.enum(["nearest", "linear"]).optional(),
  minFilter: z.enum(["nearest", "linear"]).optional(),
  mipmapFilter: z.enum(["nearest", "linear"]).optional(),
  addressU: z.enum(["clamp-to-edge", "repeat", "mirror-repeat"]).optional(),
  addressV: z.enum(["clamp-to-edge", "repeat", "mirror-repeat"]).optional(),
});

// .default() exists so z.toJSONSchema (used by introspect()) emits a "default"
// key on each JSON-Schema node, which the inspector reads to seed omitted fields
// for display. In zod 4, safeParse({}) DOES fill the value with its default, but
// the daemon stores/serializes the raw document (validateDocument returns void),
// so saved files are unchanged; applyTransform's filled values exactly match
// the mesh/camera build-time defaults, so the built scene is identical.
const transformShape = {
  position: t.vec3().default([0, 0, 0]).optional(),
  rotation: t.quat().default([0, 0, 0, 1]).optional(),
  scale: t.vec3().default([1, 1, 1]).optional(),
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
  ambient: z
    .strictObject({ sky: t.vec3(), ground: t.vec3(), intensity: z.number() })
    .optional(),
  post: z.array(z.string()).optional(),
  gravity: t.vec3().optional(),
  lengthUnit: z.number().optional(),
  sim: z.strictObject({ fixedHz: z.number() }).optional(),
  msaa: z.union([z.literal(1), z.literal(4), z.literal(8)]).optional(),
  hdr: z.boolean().optional(),
  region: z
    .strictObject({
      provenance: z
        .strictObject({
          generatorId: z.string(),
          generatorVersion: z.number(),
          seed: z.string(),
          kind: z.string(),
        })
        .optional(),
      theme: z.string().optional(),
      origin: t.vec3().optional(),
    })
    .optional(),
};

/** Local-transform component params. Rotation is a quaternion `[x,y,z,w]`; omitted fields keep identity defaults. */
export type TransformParams = z.infer<z.ZodObject<typeof transformShape>>;
/** Camera component params (non-spatial; pose comes from the entity's transform). */
export type CameraParams = z.infer<z.ZodObject<typeof cameraShape>>;
/**
 * Scene-level render/world globals. `clearColor`, `ambient`, and `post` (a
 * chain of effect ids) are applied by the loader (clearColor → `LoadedScene.settings`;
 * consumers pass it to the render clear pass. ambient → `LoadedScene.ambient`,
 * post → `LoadedScene.effects`). `gravity`/`lengthUnit`/`sim` are physics globals
 * consumed downstream (M6+). `msaa`/`hdr` are advisory context-creation inputs:
 * the loader validates and carries them in `LoadedScene.settings` but does NOT
 * create the context or apply them.
 */
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

/** Engine forward axis (right-handed Y-up): -Z. Rotated by the transform's
 *  quaternion to derive a light's / camera's look direction. */
const FORWARD = vec3.fromValues(0, 0, -1);

/** Derive a world-space forward direction from a transform's rotation quaternion
 *  (identity → -Z). Used by both the `light` and `camera` builds. */
function dirFromRotation(
  rot: TransformParams["rotation"],
): [number, number, number] {
  const out = vec3.create();
  const q = rot
    ? quat.fromValues(rot[0], rot[1], rot[2], rot[3])
    : quat.fromValues(0, 0, 0, 1);
  vec3.transformQuat(out, FORWARD, q);
  return [out[0] as number, out[1] as number, out[2] as number];
}

// Defaults for required core *Shadow fields the all-optional component schema
// leaves out, so a bare `shadow: {}` opt-in still yields a valid shadow config.
const DEFAULT_ORTHO_HALF_EXTENT = 10;
const DEFAULT_SHADOW_NEAR = 0.1;
const DEFAULT_SHADOW_FAR = 50;
const DEFAULT_LIGHT_COLOR: [number, number, number] = [1, 1, 1];
const DEFAULT_LIGHT_INTENSITY = 1;
const DEFAULT_LIGHT_RANGE = 10;
const DEFAULT_SPOT_INNER_ANGLE = Math.PI / 8;
const DEFAULT_SPOT_OUTER_ANGLE = Math.PI / 6;

/** Raw `shadow` params off the (all-optional) light component schema. */
type ShadowParams = {
  orthoHalfExtent?: number;
  near?: number;
  far?: number;
  target?: [number, number, number];
  distance?: number;
  depthBias?: number;
  normalBias?: number;
};

/** Build a `DirectionalShadow`, filling the core-required fields the schema
 *  leaves optional with sensible defaults. */
function buildDirectionalShadow(s: ShadowParams): DirectionalShadow {
  return {
    orthoHalfExtent: s.orthoHalfExtent ?? DEFAULT_ORTHO_HALF_EXTENT,
    near: s.near ?? DEFAULT_SHADOW_NEAR,
    far: s.far ?? DEFAULT_SHADOW_FAR,
    target: s.target,
    distance: s.distance,
    depthBias: s.depthBias,
    normalBias: s.normalBias,
  };
}

/** Build a `SpotShadow` (all core fields optional).
 *  Projects only the spot-relevant subset of `ShadowParams` — `s.orthoHalfExtent`,
 *  `s.target`, and `s.distance` are directional-only and are intentionally dropped here. */
function buildSpotShadow(s: ShadowParams): SpotShadow {
  return {
    near: s.near,
    far: s.far,
    depthBias: s.depthBias,
    normalBias: s.normalBias,
  };
}

/**
 * Construct a `Light` per its discriminated-union variant from a `light`
 * component's raw params + its sibling transform. Direction (directional/spot)
 * is derived from the transform rotation; position (point/spot) from the
 * transform position. Per-type construction — no union-erasing casts.
 */
function buildLight(
  p: Record<string, unknown>,
  tf: TransformParams | undefined,
): Light {
  const type = p["type"] as "directional" | "point" | "spot";
  const color =
    (p["color"] as [number, number, number] | undefined) ?? DEFAULT_LIGHT_COLOR;
  const intensity =
    (p["intensity"] as number | undefined) ?? DEFAULT_LIGHT_INTENSITY;
  const range = (p["range"] as number | undefined) ?? DEFAULT_LIGHT_RANGE;
  const shadow = p["shadow"] as ShadowParams | undefined;
  const direction = dirFromRotation(tf?.rotation);
  const pos = tf?.position;
  const position: [number, number, number] = pos
    ? [pos[0], pos[1], pos[2]]
    : [0, 0, 0];

  switch (type) {
    case "directional":
      return {
        type: "directional",
        direction,
        color,
        intensity,
        ...(shadow ? { shadow: buildDirectionalShadow(shadow) } : {}),
      };
    case "point":
      return { type: "point", position, color, intensity, range };
    case "spot":
      return {
        type: "spot",
        position,
        direction,
        color,
        intensity,
        range,
        innerAngle:
          (p["innerAngle"] as number | undefined) ?? DEFAULT_SPOT_INNER_ANGLE,
        outerAngle:
          (p["outerAngle"] as number | undefined) ?? DEFAULT_SPOT_OUTER_ANGLE,
        ...(shadow ? { shadow: buildSpotShadow(shadow) } : {}),
      };
    default:
      throw new FurnaceError(`scene: unknown light type "${type}"`);
  }
}

/** Raw `rigidBody.shape` params off the (one-of-three-optional) component schema. */
type ShapeParams = {
  cuboid?: [number, number, number];
  ball?: number;
  cylinder?: { halfHeight: number; radius: number };
};

/** Project a `rigidBody.shape` param bundle to a physics {@link ShapeDescriptor},
 *  enforcing exactly one of cuboid/ball/cylinder. */
function toShape(s: ShapeParams): ShapeDescriptor {
  const set = [
    s.cuboid !== undefined,
    s.ball !== undefined,
    s.cylinder !== undefined,
  ].filter(Boolean).length;
  if (set !== 1) {
    throw new FurnaceError(
      "scene: rigidBody.shape must set exactly one of cuboid/ball/cylinder",
    );
  }
  if (s.cuboid !== undefined) return { cuboid: s.cuboid };
  if (s.ball !== undefined) return { ball: s.ball };
  // Exactly-one invariant proven above: cylinder is the remaining case.
  return { cylinder: s.cylinder as { halfHeight: number; radius: number } };
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
      // A rigidBody sibling owns the mesh (via a rigidMesh composite) — defer:
      // return undefined so the loader tracks nothing and the rigidBody builds
      // the one mesh, seated at the body's initial pose.
      if (bx.sibling("rigidBody") !== undefined) return undefined;
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
    // `m` is `Mesh | undefined` (build defers to a rigidBody sibling by returning
    // undefined). The loader never tracks the deferred case, so destroy only ever
    // runs on a real mesh; the guard satisfies the inferred union type.
    destroy: (ctx, m) => {
      if (m) mesh.destroy(ctx, m);
    },
  });

  defineComponent("camera", {
    params: cameraShape,
    build(_ctx, bx) {
      // Boundary cast: see meshRenderer.
      const tf = bx.sibling("transform") as TransformParams | undefined;
      const p = tf?.position ?? [0, 0, 0];
      // Look direction derives from the transform rotation (identity → -Z,
      // engine right-handed Y-up); target = position + forward.
      const dir = dirFromRotation(tf?.rotation);
      const cam = camera.perspective({
        aspect: bx.params.aspect,
        fovYRad: bx.params.fovYRad,
        near: bx.params.near,
        far: bx.params.far,
        position: vec3.fromValues(p[0], p[1], p[2]),
        target: vec3.fromValues(p[0] + dir[0], p[1] + dir[1], p[2] + dir[2]),
      });
      bx.out.setCamera(cam);
      return cam;
    },
    // No destroy: Camera is a CPU-side value, not a pooled GPU resource.
  });

  defineComponent("light", {
    params: {
      type: z.enum(["directional", "point", "spot"]),
      color: t.vec3().optional(),
      intensity: z.number().optional(),
      range: z.number().optional(),
      innerAngle: z.number().optional(),
      outerAngle: z.number().optional(),
      shadow: z
        .strictObject({
          orthoHalfExtent: z.number().optional(),
          near: z.number().optional(),
          far: z.number().optional(),
          target: t.vec3().optional(),
          distance: z.number().optional(),
          depthBias: z.number().optional(),
          normalBias: z.number().optional(),
        })
        .optional(),
    },
    build(_ctx, bx) {
      // Boundary cast: see meshRenderer.
      const tf = bx.sibling("transform") as TransformParams | undefined;
      const light = buildLight(bx.params as Record<string, unknown>, tf);
      bx.out.addLight(light);
      return light; // no destroy — Light is plain CPU data
    },
    // No destroy: Light is a per-frame value type, not a pooled GPU resource.
  });

  defineComponent("rigidBody", {
    params: {
      type: z.enum(["static", "dynamic"]),
      shape: z.strictObject({
        cuboid: t.vec3().optional(),
        ball: z.number().optional(),
        cylinder: z
          .strictObject({ halfHeight: z.number(), radius: z.number() })
          .optional(),
        trimesh: z.boolean().optional(),
      }),
      friction: z.number().optional(),
      restitution: z.number().optional(),
      density: z.number().optional(),
      linearDamping: z.number().optional(),
      angularDamping: z.number().optional(),
    },
    build(ctx, bx) {
      const world = bx.world();
      // Boundary cast: sibling params were validated at the load boundary
      // (meshRenderer's geometry/material are resolved handles after T8).
      const mr = bx.sibling("meshRenderer") as
        | { geometry: Geometry; material: Material }
        | undefined;
      if (!mr) {
        throw new FurnaceError(
          "scene: rigidBody requires a sibling meshRenderer (geometry+material)",
        );
      }
      // Boundary cast: see meshRenderer — the transform sibling is schema-validated.
      const tf = bx.sibling("transform") as TransformParams | undefined;
      const p = bx.params;
      const shape: ShapeDescriptor = p.shape.trimesh
        ? (() => {
            const col = geometry.getCollisionData(ctx, mr.geometry);
            if (!col) {
              throw new FurnaceError(
                "scene: rigidBody shape.trimesh requires its meshRenderer geometry to retain collision data (use a 'mesh' geometry resource)",
              );
            }
            return {
              trimesh: { vertices: col.vertices, indices: col.indices },
            };
          })()
        : toShape(p.shape);
      const rm = rigidMesh.create(ctx, world, {
        body: {
          type: p.type,
          shape,
          position: tf?.position ?? [0, 0, 0],
          rotation: tf?.rotation,
          friction: p.friction,
          restitution: p.restitution,
          density: p.density,
          linearDamping: p.linearDamping,
          angularDamping: p.angularDamping,
        },
        mesh: { geometry: mr.geometry, material: mr.material },
      });
      // rigidMesh seats the mesh at the body's initial pose (= the seed transform),
      // so the scene renders correctly at rest before any physics step (M6).
      bx.out.addMesh(rigidMesh.getMesh(ctx, rm));
      return rm;
    },
    destroy: (ctx, rm) => rigidMesh.destroy(ctx, rm),
  });

  // --- resource kinds ---
  defineResource("geometries", "cube", {
    build: (ctx) => geometry.cube(ctx),
    destroy: (ctx, g) => geometry.destroy(ctx, g),
  });

  defineResource("geometries", "sphere", {
    params: { radius: z.number().optional() },
    build: (ctx, rx) => geometry.sphere(ctx, { radius: rx.params.radius }),
    destroy: (ctx, g) => geometry.destroy(ctx, g),
  });

  defineResource("geometries", "cylinder", {
    params: { radius: z.number().optional(), height: z.number().optional() },
    build: (ctx, rx) =>
      geometry.cylinder(ctx, {
        radius: rx.params.radius,
        height: rx.params.height,
      }),
    destroy: (ctx, g) => geometry.destroy(ctx, g),
  });

  defineResource("geometries", "plane", {
    params: { size: z.number().optional() },
    build: (ctx, rx) => geometry.plane(ctx, { size: rx.params.size }),
    destroy: (ctx, g) => geometry.destroy(ctx, g),
  });

  defineResource("geometries", "mesh", {
    params: { src: z.string() },
    async build(ctx, rx) {
      const res = await fetch(rx.params.src);
      if (!res.ok) {
        throw new FurnaceError(
          `scene: failed to fetch mesh blob "${rx.params.src}" (${res.status})`,
        );
      }
      const blob = decodeMeshBlob(await res.arrayBuffer());
      return geometry.create(ctx, blob.render, { retainForCollision: true });
    },
    destroy: (ctx, g) => geometry.destroy(ctx, g),
  });

  defineResource("shaders", "unlit", {
    // Boundary cast: unlit returns Shader<{color:"vec4f"}> — widened so all
    // shaders fit the uniform table.
    build: (ctx) => shader.unlit(ctx) as Promise<shader.Shader>,
    // No destroy: built-in shaders are ctx-cached singletons.
  });

  defineResource("shaders", "lit", {
    // Boundary cast: lit returns Shader<{color:"vec4f";specular:"vec4f"}> — widened.
    build: (ctx) => shader.lit(ctx) as Promise<shader.Shader>,
    // No destroy: built-in shaders are ctx-cached singletons.
  });

  defineResource("shaders", "texturedLit", {
    // Boundary cast: texturedLit returns Shader<Record<string,never>> — widened.
    build: (ctx) => shader.texturedLit(ctx) as Promise<shader.Shader>,
    // No destroy: built-in shaders are ctx-cached singletons.
  });

  defineResource("shaders", "textured", {
    // Boundary cast: textured returns Shader<Record<string,never>> — widened.
    build: (ctx) => shader.textured(ctx) as Promise<shader.Shader>,
    // No destroy: built-in shaders are ctx-cached singletons.
  });

  defineResource("shaders", "normalColor", {
    // Boundary cast: normalColor returns Shader<Record<string,never>> — widened.
    build: (ctx) => shader.normalColor(ctx) as Promise<shader.Shader>,
    // No destroy: built-in shaders are ctx-cached singletons.
  });

  defineResource("textures", "checkerboard", {
    params: {
      size: z.number().optional(),
      cells: z.number().optional(),
      colorA: t.vec3().optional(),
      colorB: t.vec3().optional(),
      mipmaps: z.boolean().optional(),
    },
    build: (ctx, rx) =>
      texture.create(ctx, {
        ...texture.checkerboard({
          size: rx.params.size,
          cells: rx.params.cells,
          colorA: rx.params.colorA,
          colorB: rx.params.colorB,
        }),
        mipmaps: rx.params.mipmaps,
      }),
    destroy: (ctx, tex) => texture.destroy(ctx, tex),
  });

  defineResource("textures", "load", {
    params: {
      src: z.string(),
      colorSpace: z.enum(["srgb", "linear"]).optional(),
      mipmaps: z.boolean().optional(),
    },
    build: (ctx, rx) =>
      texture.load(ctx, rx.params.src, {
        colorSpace: rx.params.colorSpace,
        mipmaps: rx.params.mipmaps,
      }),
    destroy: (ctx, tex) => texture.destroy(ctx, tex),
  });

  defineResource("materials", "standard", {
    params: {
      shader: t.resource("shaders"),
      texture: z
        .strictObject({
          texture: t.resource("textures"),
          sampler: samplerShape.optional(),
        })
        .optional(),
      params: z.strictObject({ color: t.color().optional() }).optional(),
    },
    async build(ctx, rx) {
      const s = rx.params.shader;
      const color = rx.params.params?.color;
      if (rx.params.texture && color !== undefined) {
        throw new FurnaceError(
          "scene: material has both a texture and a color param (mutually exclusive)",
        );
      }
      if (rx.params.texture) {
        return {
          material: await material.create(ctx, {
            shader: s,
            texture: {
              texture: rx.params.texture.texture,
              sampler: rx.params.texture.sampler,
            },
          }),
          binding: undefined as Binding | undefined,
        };
      }
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

  defineResource("effects", "bloom", {
    params: {
      intensity: z.number().optional(),
      threshold: z.number().optional(),
      softness: z.number().optional(),
    },
    build: (ctx, rx) =>
      post.bloom(ctx, {
        intensity: rx.params.intensity,
        threshold: rx.params.threshold,
        softness: rx.params.softness,
      }),
    destroy: (ctx, e) => post.destroy(ctx, e),
  });

  defineResource("effects", "tonemap", {
    params: {
      exposure: z.number().optional(),
      operator: z.enum(["neutral", "reinhard"]).optional(),
    },
    build: (ctx, rx) =>
      post.tonemap(ctx, {
        exposure: rx.params.exposure,
        operator: rx.params.operator,
      }),
    destroy: (ctx, e) => post.destroy(ctx, e),
  });

  // --- settings (the second reflection surface) ---
  setSettingsSchema(settingsShape);
}

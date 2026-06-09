import * as binding from "../binding/index.ts";
import type { Binding } from "../binding/types.ts";
import * as camera from "../camera/index.ts";
import type { Camera } from "../camera/types.ts";
import { FurnaceError } from "../errors.ts";
import * as geometry from "../geometry/index.ts";
import type { Context } from "../gpu/context-types.ts";
import * as material from "../material/index.ts";
import * as mesh from "../mesh/index.ts";
import type { Mesh } from "../mesh/types.ts";
import type { Shader } from "../shader/types.ts";
import { quat } from "../transform/quat.ts";
import { vec3 } from "../transform/vec3.ts";
import { buildGeometry, buildMaterial, buildShader } from "./resources.ts";
import type {
  CameraParams,
  LoadedScene,
  SceneDocument,
  TransformParams,
} from "./types.ts";
import { validateDocument } from "./validate.ts";

/**
 * Load a serialized scene document into live core objects.
 *
 * Validates the document, builds all resources in dependency order
 * (geometries → shaders → materials), instantiates entities (meshRenderer
 * → `mesh.create` + transform; camera → `camera.perspective` + pose), and
 * returns the scene's render inputs together with a `destroy` that frees
 * everything this call created.
 *
 * @param ctx - the GPU context to create resources in
 * @param doc - the parsed scene document
 * @returns the loaded scene's render inputs + a `destroy` that frees everything created
 * @throws {FurnaceError} if the document fails boundary validation
 * @throws {FurnaceError} if no entity carries a camera component
 */
export async function loadScene(
  ctx: Context,
  doc: SceneDocument,
): Promise<LoadedScene> {
  validateDocument(doc);

  // Resources, in fixed dependency order: geometries → shaders → materials.
  const geometries = new Map<string, geometry.Geometry>();
  for (const [id, res] of Object.entries(doc.resources?.geometries ?? {})) {
    geometries.set(id, buildGeometry(ctx, res));
  }

  const shaders = new Map<string, Shader>();
  for (const [id, res] of Object.entries(doc.resources?.shaders ?? {})) {
    shaders.set(id, await buildShader(ctx, res));
  }

  // resolveShader is hoisted out of the loop — it only captures the shaders Map,
  // which is fully built before the materials loop begins.
  const resolveShader = (sid: string): Shader => {
    const s = shaders.get(sid);
    if (!s) throw new FurnaceError(`scene: shader "${sid}" not built`);
    return s;
  };

  const materials = new Map<string, material.Material>();
  const bindings: Binding[] = [];
  for (const [id, res] of Object.entries(doc.resources?.materials ?? {})) {
    const { material: mat, binding: b } = await buildMaterial(
      ctx,
      res,
      resolveShader,
    );
    materials.set(id, mat);
    if (b) bindings.push(b);
  }

  // Entities → meshes + camera.
  const meshes: Mesh[] = [];
  let loadedCamera: Camera | undefined;

  for (const entity of doc.entities) {
    const c = entity.components;

    if (c.meshRenderer) {
      const geo = geometries.get(c.meshRenderer.geometry);
      const mat = materials.get(c.meshRenderer.material);
      if (!geo || !mat) {
        // Invariant: validateDocument already verified these refs resolve. Reaching here means a validator bug.
        throw new FurnaceError(
          `scene [internal]: entity "${entity.id}" mesh ref resolved to null after validation — geometry="${c.meshRenderer.geometry}" material="${c.meshRenderer.material}"`,
        );
      }
      const m = mesh.create(ctx, { geometry: geo, material: mat });
      applyTransform(ctx, m, c.transform);
      meshes.push(m);
    }

    if (c.camera) {
      loadedCamera = buildCamera(c.camera, c.transform);
    }
  }

  if (!loadedCamera) {
    throw new FurnaceError("scene: no entity carries a camera component");
  }

  // Rebind to a non-optional local so the destroy closure captures Camera, not Camera | undefined.
  // Can't name it `camera` — that would shadow the `import * as camera` namespace above.
  const loadedCam = loadedCamera;
  return {
    meshes,
    camera: loadedCam,
    settings: doc.settings ?? {},
    destroy: () => {
      for (const m of meshes) mesh.destroy(ctx, m);
      for (const mat of materials.values()) material.destroy(ctx, mat);
      for (const b of bindings) binding.destroy(ctx, b);
      for (const geo of geometries.values()) geometry.destroy(ctx, geo);
      // Built-in shaders (e.g. unlit) are ctx-cached singletons — not destroyed here.
    },
  };
}

/** Apply a transform component to a mesh. Omitted fields keep the mesh's identity defaults. */
function applyTransform(
  ctx: Context,
  m: Mesh,
  t: TransformParams | undefined,
): void {
  if (!t) return;
  if (t.position) {
    mesh.setPosition(
      ctx,
      m,
      vec3.fromValues(t.position[0], t.position[1], t.position[2]),
    );
  }
  if (t.rotation) {
    mesh.setRotation(
      ctx,
      m,
      quat.fromValues(
        t.rotation[0],
        t.rotation[1],
        t.rotation[2],
        t.rotation[3],
      ),
    );
  }
  if (t.scale) {
    mesh.setScale(ctx, m, vec3.fromValues(t.scale[0], t.scale[1], t.scale[2]));
  }
}

/**
 * Build a Camera from its params + the entity's transform.
 *
 * Slice 1: identity-rotation only — forward is -Z, so target = position + (0,0,-1).
 * General quaternion → look-direction is a follow-on slice.
 */
function buildCamera(
  params: CameraParams,
  t: TransformParams | undefined,
): Camera {
  const p = t?.position ?? [0, 0, 0];
  const pos = vec3.fromValues(p[0], p[1], p[2]);
  const target = vec3.fromValues(p[0], p[1], p[2] - 1); // -1 on Z: engine forward = -Z (right-handed Y-up)
  return camera.perspective({
    aspect: params.aspect,
    fovYRad: params.fovYRad,
    near: params.near,
    far: params.far,
    position: pos,
    target,
  });
}

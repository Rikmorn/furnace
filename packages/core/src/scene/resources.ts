import * as binding from "../binding/index.ts";
import { FurnaceError } from "../errors.ts";
import * as geometry from "../geometry/index.ts";
import type { Context } from "../gpu/context-types.ts";
import * as material from "../material/index.ts";
import * as shader from "../shader/index.ts";
import { vec4 } from "../transform/vec4.ts";
import type {
  GeometryResource,
  MaterialResource,
  ShaderResource,
} from "./types.ts";

/** Build a geometry resource. Slice 1: cube. */
export function buildGeometry(
  ctx: Context,
  res: GeometryResource,
): geometry.Geometry {
  switch (res.kind) {
    case "cube":
      return geometry.cube(ctx);
    default: {
      // Exhaustiveness guard: adding a new GeometryResource kind without a case fails to compile here.
      const _exhaustive: never = res.kind;
      void _exhaustive;
      // Boundary cast: this branch is unreachable for typed callers but reachable from malformed
      // runtime JSON — read the offending kind for a useful loud-fail message.
      throw new FurnaceError(
        `scene: unknown geometry kind "${(res as { kind: string }).kind}"`,
      );
    }
  }
}

/** Build a built-in shader resource by kind. Slice 1: unlit. */
export function buildShader(
  ctx: Context,
  res: ShaderResource,
): Promise<shader.Shader> {
  switch (res.kind) {
    case "unlit":
      // Boundary cast: unlit returns Shader<{color:"vec4f"}> — widened to Shader<LayoutSchema>
      // so the loader can store all shaders in a uniform Record<string, shader.Shader>.
      return shader.unlit(ctx) as Promise<shader.Shader>;
    default: {
      // Exhaustiveness guard: adding a new ShaderResource kind without a case fails to compile here.
      const _exhaustive: never = res.kind;
      void _exhaustive;
      // Boundary cast: this branch is unreachable for typed callers but reachable from malformed
      // runtime JSON — read the offending kind for a useful loud-fail message.
      throw new FurnaceError(
        `scene: unknown shader kind "${(res as { kind: string }).kind}"`,
      );
    }
  }
}

/**
 * Build a material: resolve its shader handle, bind any uniform `params` (Slice 1:
 * optional `color` vec4f), and create the material.
 *
 * Returns both the created material and the binding it allocated (if any). The
 * **caller owns teardown of the returned binding** — `material.destroy` does not
 * free consumer-passed bindings (the creator owns them). When the returned
 * `binding` is defined, the caller must call `binding.destroy(ctx, b)` to free it.
 *
 * @param ctx - the GPU context
 * @param res - the material resource descriptor from the scene document
 * @param resolveShader - callback that returns an already-built shader handle by document id
 * @returns `{ material, binding }` — `binding` is `undefined` for the no-color branch
 * @throws {FurnaceError} if the shader id is not found (caller's responsibility to throw)
 */
export async function buildMaterial(
  ctx: Context,
  res: MaterialResource,
  resolveShader: (id: string) => shader.Shader,
): Promise<{
  material: material.Material;
  binding: binding.Binding | undefined;
}> {
  const s = resolveShader(res.shader);
  const color = res.params?.color;
  if (color !== undefined) {
    const b = binding.create(ctx, s);
    binding.set(ctx, b, {
      color: vec4.fromValues(color[0], color[1], color[2], color[3]),
    });
    return {
      material: await material.create(ctx, { shader: s, binding: b }),
      binding: b,
    };
  }
  // No params: valid only for shaders with no @group(1) layout. Unlit requires a color binding,
  // so a paramless unlit material is rejected by material.create — Task 4's loader supplies params.color.
  return {
    material: await material.create(ctx, { shader: s }),
    binding: undefined,
  };
}

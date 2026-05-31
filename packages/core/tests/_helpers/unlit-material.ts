// Test helper: bridge composition replacing the retired `material.unlit`.
// An unlit material is now `shader.unlit` (a shared per-ctx Shader<{ color }>)
// + a colour Binding + material.create. This helper bundles the three calls so
// the 14 GPU test files that just needed "a material" don't each repeat them.
//
// Render-state flat→grouped mapping (was the deleted `_flatRenderState`):
//   cullMode/topology → primitive: { cullMode, topology }
//   depthEnabled === false → depth: false
//   else depthWrite/depthCompare → depth: { write, compare }
//   blend → blend

import * as binding from "../../src/binding/index.ts";
import type { Binding } from "../../src/binding/types.ts";
import type { Context } from "../../src/gpu/index.ts";
import * as mat from "../../src/material/index.ts";
import type { Material, MaterialDescriptor } from "../../src/material/types.ts";
import * as shader from "../../src/shader/index.ts";
import type { Vec4 } from "../../src/transform/types.ts";

type UnlitLayout = { color: "vec4f" };

/** Render-state overrides accepted by {@link makeUnlitMaterial}, in the same
 *  grouped shape as {@link MaterialDescriptor}. */
export type UnlitMaterialOpts = Pick<
  MaterialDescriptor<UnlitLayout>,
  "primitive" | "depth" | "blend"
>;

/**
 * Compose an unlit material via the binding bridge: shared `shader.unlit`
 * shader + a colour {@link Binding} + `material.create`. Returns both handles
 * so the caller can destroy/track them — the {@link Binding} OWNS the colour
 * buffer, so callers that explicitly destroy the material must also destroy the
 * binding (or let the dispose cascade free it).
 */
export async function makeUnlitMaterial(
  ctx: Context,
  color: Vec4,
  opts?: UnlitMaterialOpts,
): Promise<{ material: Material<UnlitLayout>; binding: Binding<UnlitLayout> }> {
  const s = await shader.unlit(ctx);
  const b = binding.create(ctx, s);
  binding.set(ctx, b, { color });
  const material = await mat.create(ctx, { shader: s, binding: b, ...opts });
  return { material, binding: b };
}

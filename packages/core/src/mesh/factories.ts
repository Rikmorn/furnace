import type { Context } from "../gpu/index.ts";
import type { Material } from "../material/types.ts";
import { create } from "./mesh.ts";
import { cubeGeometry, planeGeometry } from "./primitives.ts";
import type { Mesh } from "./types.ts";

export function cube(
  ctx: Context,
  opts: { material: Material; size?: number },
): Mesh {
  const geometry = cubeGeometry(
    ctx,
    opts.size !== undefined ? { size: opts.size } : undefined,
  );
  return create(ctx, { geometry, material: opts.material });
}

export function plane(
  ctx: Context,
  opts: { material: Material; size?: number },
): Mesh {
  const geometry = planeGeometry(
    ctx,
    opts.size !== undefined ? { size: opts.size } : undefined,
  );
  return create(ctx, { geometry, material: opts.material });
}

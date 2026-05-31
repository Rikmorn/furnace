import { FurnaceError } from "../errors.ts";
import type {
  AddressSpace,
  LayoutSchema,
  ResolvedField,
  ResolvedLayout,
  Token,
} from "./types.ts";

// WGSL §14.4.1 AlignOf/SizeOf for the supported tokens (research §2.1).
const ALIGN: Record<Token, number> = {
  f32: 4,
  i32: 4,
  u32: 4,
  vec2f: 8,
  vec3f: 16,
  vec4f: 16,
  mat2x2f: 8,
  mat3x3f: 16,
  mat4x4f: 16,
};
const SIZE: Record<Token, number> = {
  f32: 4,
  i32: 4,
  u32: 4,
  vec2f: 8,
  vec3f: 12,
  vec4f: 16,
  mat2x2f: 16,
  mat3x3f: 48,
  mat4x4f: 64,
};

/** Uniform buffers round their total size up to this (always-valid; matches
 * the manual `_pad` consumers wrote by hand, which the calculator replaces). */
const UNIFORM_SIZE_GRANULARITY = 16;
const MAX_UNIFORM_BUFFER_BYTES = 65536; // WebGPU maxUniformBufferBindingSize (research §2.2)

/** roundUp(k, n) = ⌈n / k⌉ × k (WGSL CRD-WGSL §alignment-and-size). */
function roundUp(k: number, n: number): number {
  return Math.ceil(n / k) * k;
}

/**
 * Compute byte offsets + total size for a uniform buffer from a declared
 * {@link LayoutSchema}, per WGSL §14.4 alignment/size rules. (Group-agnostic:
 * the bridge uses it for `@group(1)` params, but the math is the same for any.)
 *
 * Setup-loud: throws on an unsupported token, a non-uniform address space
 * (storage admitted but not yet implemented), or a uniform buffer exceeding
 * `maxUniformBufferBindingSize` (64 KiB → "too big for uniform; use storage").
 *
 * @throws FurnaceError - unsupported token / unimplemented address space /
 *   uniform size cap exceeded.
 */
export function computeLayout(
  schema: LayoutSchema,
  addressSpace: AddressSpace = "uniform",
): ResolvedLayout {
  if (addressSpace !== "uniform") {
    throw new FurnaceError(
      `binding layout: addressSpace "${addressSpace}" is admitted but not yet implemented (E-B implements "uniform")`,
    );
  }
  const fields: Record<string, ResolvedField> = {};
  let offset = 0;
  for (const [name, token] of Object.entries(schema)) {
    const align = ALIGN[token];
    const size = SIZE[token];
    // Runtime guard: `token` is typed as Token, but a bad value can still
    // arrive via an `as Token` cast or untyped JSON — fail loud, don't emit NaN.
    if (align === undefined || size === undefined) {
      throw new FurnaceError(
        `binding layout: unsupported WGSL token "${token}" for field "${name}"`,
      );
    }
    offset = roundUp(align, offset);
    fields[name] = { offset, size, token };
    // WGSL §14.4.2: a struct member's running offset advances by SizeOf, NOT
    // by roundUp(align, size). The roundUp-to-align stride rule is for ARRAY
    // elements (§14.4.4), a distinct rule. So `{ vec3f, f32 }` packs the f32 at
    // offset 12 (into the vec3's tail padding), giving a 16-byte struct — the
    // next field only pads up when ITS own align exceeds the running offset.
    offset += size;
  }
  const byteSize = roundUp(UNIFORM_SIZE_GRANULARITY, offset);
  if (byteSize > MAX_UNIFORM_BUFFER_BYTES) {
    throw new FurnaceError(
      `binding layout: ${byteSize} bytes exceeds maxUniformBufferBindingSize (${MAX_UNIFORM_BUFFER_BYTES}); too big for a uniform buffer`,
    );
  }
  return { fields, byteSize, addressSpace };
}

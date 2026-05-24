const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const FIELD_SEPARATOR_BYTE = 0x1f;

function fnv1a(parts: readonly string[]): string {
  let hash = FNV_OFFSET_BASIS;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i);
      hash = (hash * FNV_PRIME) >>> 0;
    }
    hash ^= FIELD_SEPARATOR_BYTE;
    hash = (hash * FNV_PRIME) >>> 0;
  }
  return hash.toString(16);
}

function blendSignature(blend: GPUBlendState | undefined): string {
  if (!blend) return "none";
  const color = blend.color;
  const alpha = blend.alpha;
  return [
    color.srcFactor ?? "one",
    color.dstFactor ?? "zero",
    color.operation ?? "add",
    alpha.srcFactor ?? "one",
    alpha.dstFactor ?? "zero",
    alpha.operation ?? "add",
  ].join("|");
}

export function _effectPipelineHashKey(
  shaderSource: string,
  targetFormat: GPUTextureFormat,
  blend: GPUBlendState | undefined,
): string {
  return fnv1a([shaderSource, targetFormat, blendSignature(blend)]);
}

export function _buildEffectPipelineDescriptor(
  fsModule: GPUShaderModule,
  vsModule: GPUShaderModule,
  targetFormat: GPUTextureFormat,
  blend: GPUBlendState | undefined,
): GPURenderPipelineDescriptor {
  return {
    layout: "auto",
    vertex: { module: vsModule, entryPoint: "vs_fullscreen" },
    fragment: {
      module: fsModule,
      entryPoint: "fs_main",
      targets: [{ format: targetFormat, blend }],
    },
    primitive: { topology: "triangle-list" },
  };
}

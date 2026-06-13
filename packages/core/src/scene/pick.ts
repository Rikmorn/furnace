import type { Camera } from "../camera/types.ts";
import { _ensureCameraBuffer } from "../frame/render.ts";
import type { GeometrySlot } from "../geometry/types.ts";
import type { Context } from "../gpu/context-types.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { Mesh, MeshSlot } from "../mesh/types.ts";
import { _lookupGeometry, _lookupMesh } from "../resources/internal.ts";

// Camera/Obj struct byte layouts mirror the engine's render UBOs verbatim:
// Camera = viewProjection mat4x4 @0 + position vec4 @64 (frame/render.ts,
// CAMERA_UNIFORM_SIZE = 80); Obj = model mat4x4 @0 + normalMatrix mat4x4 @64
// (mesh/mesh.ts, OBJECT_UNIFORM_SIZE_BYTES = 128). The id pass reuses both
// buffers as-is, so any drift in those layouts must be mirrored here.
const PICK_WGSL = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32>, position: vec4<f32> };
struct Obj { model: mat4x4<f32>, normalMatrix: mat4x4<f32> };
struct Id { value: u32 };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> obj: Obj;
@group(2) @binding(0) var<uniform> id: Id;
@vertex fn vs_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * obj.model * vec4<f32>(position, 1.0);
}
@fragment fn fs_main() -> @location(0) u32 { return id.value; }
`;

const PICK_DEPTH_FORMAT: GPUTextureFormat = "depth24plus";
// Per-mesh id occupies one slot of the shared id buffer; each slot is padded to
// the minimum uniform-buffer offset alignment so dynamic offsets are legal.
const ID_STRIDE = 256;
const VERTEX_STRIDE_BYTES = 32; // matches the engine vertex layout (frame/render.ts)
const READBACK_BYTES_PER_ROW = 256; // copyTextureToBuffer min row alignment

const pipelineByCtx = new WeakMap<Context, GPURenderPipeline>();

/**
 * Lazily build (and cache per context) the id-pass render pipeline: a minimal
 * position-only vertex stage and a fragment stage that writes a per-draw `u32`
 * id into an `r32uint` target. `cullMode: "none"` so back faces still register
 * a hit. The pipeline uses `layout: "auto"`; bind-group layouts are read back
 * via `getBindGroupLayout`.
 */
function ensurePipeline(ctx: Context): GPURenderPipeline {
  const cached = pipelineByCtx.get(ctx);
  if (cached) return cached;
  const module = ctx.device.createShaderModule({ code: PICK_WGSL });
  const pipeline = ctx.device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fs_main",
      targets: [{ format: "r32uint" }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: {
      format: PICK_DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });
  pipelineByCtx.set(ctx, pipeline);
  return pipeline;
}

/**
 * GPU id-buffer pick. Renders `entries`' meshes into an off-screen `r32uint`
 * id target — each entry gets a 1-based integer id — then reads back the single
 * texel under the `(ndcX, ndcY)` cursor and maps that id to its `entityId`.
 *
 * NDC convention: `x`/`y` in `[-1, 1]`, Y-up (matches `camera.screenToRay`).
 * Out-of-range NDC is clamped to the nearest edge texel. Background (cleared id
 * `0`, i.e. no mesh covered the texel) returns `null`.
 *
 * Allocates and frees all transient GPU resources per call (id texture, depth
 * texture, id uniform buffer, readback buffer) — nothing is cached except the
 * per-context pipeline. Renders on demand and awaits one buffer-map readback,
 * so this is a click-time call, not a per-frame one. The camera uniform buffer
 * is the engine's shared per-`(ctx, cam)` buffer (rewritten here from the
 * camera's current matrices), so a pick reflects the camera's latest pose.
 *
 * @param ctx - the GPU context the meshes were created in
 * @param cam - the camera whose viewProjection drives the id pass
 * @param entries - the pickable meshes paired with their entity ids, in id order
 * @param ndcX - cursor X in NDC, `[-1, 1]`
 * @param ndcY - cursor Y in NDC, `[-1, 1]`, Y-up
 * @returns the entity id under the cursor, or `null` for background
 */
export async function pickEntity(
  ctx: Context,
  cam: Camera,
  entries: { mesh: Mesh; entityId: string }[],
  ndcX: number,
  ndcY: number,
): Promise<string | null> {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const px = Math.min(
    width - 1,
    Math.max(0, Math.floor((ndcX * 0.5 + 0.5) * width)),
  );
  const py = Math.min(
    height - 1,
    Math.max(0, Math.floor((1 - (ndcY * 0.5 + 0.5)) * height)),
  );

  const pipeline = ensurePipeline(ctx);
  const cameraBuffer = _ensureCameraBuffer(ctx, cam);

  const idTex = ctx.device.createTexture({
    size: { width, height },
    format: "r32uint",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depthTex = ctx.device.createTexture({
    size: { width, height },
    format: PICK_DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const idBuffer = ctx.device.createBuffer({
    size: Math.max(ID_STRIDE, entries.length * ID_STRIDE),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const idToEntity = new Map<number, string>();
  entries.forEach((e, i) => {
    const id = i + 1;
    idToEntity.set(id, e.entityId);
    ctx.queue.writeBuffer(idBuffer, i * ID_STRIDE, new Uint32Array([id]));
  });

  const camBG = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
  });

  const encoder = ctx.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: idTex.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthTex.createView(),
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, camBG);
  entries.forEach((e, i) => {
    const ms = _lookupMesh<MeshSlot>(ctx, e.mesh);
    if (!ms) return;
    _recomputeModelIfDirty(ctx, ms);
    const gs = _lookupGeometry<GeometrySlot>(ctx, ms.geometry);
    if (!gs) return;
    const objBG = ctx.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: ms.objectBuffer } }],
    });
    const idBG = ctx.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(2),
      entries: [
        {
          binding: 0,
          resource: { buffer: idBuffer, offset: i * ID_STRIDE, size: 4 },
        },
      ],
    });
    pass.setBindGroup(1, objBG);
    pass.setBindGroup(2, idBG);
    pass.setVertexBuffer(0, gs.vertexBuffer);
    if (gs.indexBuffer && gs.indexFormat) {
      pass.setIndexBuffer(gs.indexBuffer, gs.indexFormat);
      pass.drawIndexed(gs.indexCount);
    } else {
      pass.draw(gs.vertexCount);
    }
  });
  pass.end();

  const readback = ctx.device.createBuffer({
    size: READBACK_BYTES_PER_ROW,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  encoder.copyTextureToBuffer(
    { texture: idTex, origin: { x: px, y: py } },
    { buffer: readback, bytesPerRow: READBACK_BYTES_PER_ROW, rowsPerImage: 1 },
    { width: 1, height: 1 },
  );
  ctx.queue.submit([encoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  const id = new Uint32Array(readback.getMappedRange())[0] ?? 0;
  readback.unmap();
  readback.destroy();
  idTex.destroy();
  depthTex.destroy();
  idBuffer.destroy();

  return id === 0 ? null : (idToEntity.get(id) ?? null);
}

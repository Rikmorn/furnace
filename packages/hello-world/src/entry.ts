import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import * as material from "@furnace/core/material";
import type { Geometry, Mesh } from "@furnace/core/mesh";
import * as mesh from "@furnace/core/mesh";
import * as post from "@furnace/core/post";
import type { Vec4 } from "@furnace/core/transform";
import { quat, vec3, vec4 } from "@furnace/core/transform";
import {
  add,
  ready as demoWasmReady,
} from "../plugins/demo-wasm/pkg/demo_wasm";
import bloomShaderUrl from "./bloom.wgsl";
import emissiveShaderUrl from "./emissive.wgsl";
import { mountFpsOverlay } from "./overlay/mount.ts";
import { subscribeOverlay } from "./overlay/state.svelte.ts";
import shaderUrl from "./triangle.wgsl";

const MOVE_SPEED_WORLD_PER_SEC = 1.5;
const DIAGONAL_NORMALIZE = 1 / Math.sqrt(2);
const HALO_WIDTH = 0.3;
const HALO_BUFFER_SIZE_BYTES = 16;
const CUBE_ROTATION_PITCH_RATE = 0.0003;
const CUBE_ROTATION_YAW_RATE = 0.0005;
const PLANE_BACKDROP_SIZE = 6;
const PLANE_Z = -2;
const CUBE_X = 1;
const EMISSIVE_BUFFER_SIZE_BYTES = 16;
const EMISSIVE_COLOR_HOT_PINK = new Float32Array([1.0, 0.8, 1.0, 1.0]);
const BLOOM_BUFFER_SIZE_BYTES = 16;
const BLOOM_THRESHOLD = 0.7;
const BLOOM_INTENSITY = 4.0;
const BLOOM_RADIUS = 0.012;
const CLEAR_COLOR: Vec4 = vec4.fromValues(0.05, 0.05, 0.07, 1);

const sdfTriangle = async (ctx: gpu.Context) => {
  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    document.body.innerText = `Couldn't load shader (HTTP ${shaderResponse.status}): ${shaderUrl}`;
    return;
  }
  const shaderSource = await shaderResponse.text();

  const haloBuffer = ctx.device.createBuffer({
    size: HALO_BUFFER_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  ctx.queue.writeBuffer(haloBuffer, 0, new Float32Array([HALO_WIDTH, 0, 0, 0]));

  const sdfMat = await material.create(ctx, {
    vertex: shaderSource,
    fragment: shaderSource,
    bindings: [{ binding: 0, resource: { buffer: haloBuffer } }],
    cullMode: "none",
    blend: material.PREMULTIPLIED_ALPHA_BLEND,
    depthWrite: false,
  });

  // Meshes. The SDF triangle uses a covering quad in world space; the cube and plane use built-ins.
  const sdfGeo = mesh.createGeometry(ctx, {
    positions: new Float32Array([-10, -10, 0, 30, -10, 0, -10, 30, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  });

  return mesh.create(ctx, { geometry: sdfGeo, material: sdfMat });
};

const emissiveCube = async (
  ctx: gpu.Context,
): Promise<{ mesh: Mesh; geometry: Geometry }> => {
  const shaderResponse = await fetch(emissiveShaderUrl);
  if (!shaderResponse.ok) {
    throw new Error(
      `Couldn't load emissive shader (HTTP ${shaderResponse.status})`,
    );
  }
  const shaderSource = await shaderResponse.text();

  const emissiveBuffer = ctx.device.createBuffer({
    size: EMISSIVE_BUFFER_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(emissiveBuffer, 0, EMISSIVE_COLOR_HOT_PINK);

  const emissiveMat = await material.create(ctx, {
    vertex: shaderSource,
    fragment: shaderSource,
    bindings: [{ binding: 0, resource: { buffer: emissiveBuffer } }],
  });

  const geometry = mesh.cubeGeometry(ctx);
  return {
    mesh: mesh.create(ctx, { geometry, material: emissiveMat }),
    geometry,
  };
};

const createBloomEffect = async (ctx: gpu.Context): Promise<post.Effect> => {
  const shaderResponse = await fetch(bloomShaderUrl);
  if (!shaderResponse.ok) {
    throw new Error(
      `Couldn't load bloom shader (HTTP ${shaderResponse.status})`,
    );
  }
  const shaderSource = await shaderResponse.text();

  const paramsBuffer = ctx.device.createBuffer({
    size: BLOOM_BUFFER_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(
    paramsBuffer,
    0,
    new Float32Array([BLOOM_THRESHOLD, BLOOM_INTENSITY, BLOOM_RADIUS, 0]),
  );

  return post.create(ctx, {
    shader: shaderSource,
    bindings: [{ binding: 0, resource: { buffer: paramsBuffer } }],
  });
};

async function main(): Promise<void> {
  await demoWasmReady;
  console.log("demo-wasm: 2 + 3 =", add(2, 3));

  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (!canvas) throw new Error("canvas#gpu not found");
  if (!uiRoot) throw new Error("#ui-root not found");

  let ctx: gpu.Context;
  try {
    ctx = await gpu.requestContext(canvas);
  } catch (e) {
    document.body.innerText = e instanceof Error ? e.message : String(e);
    return;
  }

  const cam = camera.perspective({
    aspect: ctx.canvas.width / ctx.canvas.height,
  });

  const sdfMesh = await sdfTriangle(ctx);
  if (!sdfMesh) throw new Error("could not load sdf mech");

  const cubeMat = await material.normalColor(ctx);
  const planeMat = await material.unlit(ctx, {
    color: vec4.fromValues(0.1, 0.15, 0.2, 1),
  });

  const cubeMeshGeo = mesh.cubeGeometry(ctx);
  const cubeMesh = mesh.create(ctx, {
    geometry: cubeMeshGeo,
    material: cubeMat,
  });
  const planeMeshGeo = mesh.planeGeometry(ctx, { size: PLANE_BACKDROP_SIZE });
  const planeMesh = mesh.create(ctx, {
    geometry: planeMeshGeo,
    material: planeMat,
  });
  const emissive = await emissiveCube(ctx);
  const bloom = await createBloomEffect(ctx);

  mesh.setPosition(ctx, planeMesh, new Float32Array([0, 0, PLANE_Z]));
  mesh.setPosition(ctx, cubeMesh, new Float32Array([CUBE_X, 0, 0]));
  mesh.setPosition(ctx, emissive.mesh, new Float32Array([-CUBE_X, 0, 0]));

  // No teardown — subscription lives for the page lifetime (no dispose path in hello-world).
  camera.bindToCanvas(cam, ctx);

  input.attach(canvas);
  mountFpsOverlay(uiRoot);
  subscribeOverlay(ctx);

  // const pos = { x: 0, y: 0 };
  const rotation = quat.create();
  // const sdfPosition = new Float32Array(3);
  const sdfPosition = vec3.fromValues(0, 0, 0);

  frame.loop(ctx, ({ deltaMs, elapsedMs }) => {
    const dt = deltaMs / 1000;
    let dx = 0;
    let dy = 0;
    if (input.isKeyDown("ArrowLeft")) dx -= 1;
    if (input.isKeyDown("ArrowRight")) dx += 1;
    if (input.isKeyDown("ArrowDown")) dy -= 1;
    if (input.isKeyDown("ArrowUp")) dy += 1;
    if (dx !== 0 && dy !== 0) {
      dx *= DIAGONAL_NORMALIZE;
      dy *= DIAGONAL_NORMALIZE;
    }
    // are these faster?
    // pos.x += dx * MOVE_SPEED_WORLD_PER_SEC * dt;
    // pos.y += dy * MOVE_SPEED_WORLD_PER_SEC * dt;
    // vec3.set(sdfPosition, pos.x, pos.y, 0);
    vec3.add(
      sdfPosition,
      sdfPosition,
      vec3.fromValues(
        dx * MOVE_SPEED_WORLD_PER_SEC * dt,
        dy * MOVE_SPEED_WORLD_PER_SEC * dt,
        0,
      ),
    );

    // update sdf position
    mesh.setPosition(ctx, sdfMesh, sdfPosition);

    // update cube position
    quat.fromEuler(
      rotation,
      elapsedMs * CUBE_ROTATION_PITCH_RATE,
      elapsedMs * CUBE_ROTATION_YAW_RATE,
      0,
    );
    mesh.setRotation(ctx, cubeMesh, rotation);
    mesh.setRotation(ctx, emissive.mesh, rotation);

    frame.render(ctx, {
      draw: [planeMesh, cubeMesh, emissive.mesh, sdfMesh],
      camera: cam,
      effects: [bloom],
      clearColor: CLEAR_COLOR,
    });
  });
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});

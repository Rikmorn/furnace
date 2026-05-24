import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import * as material from "@furnace/core/material";
import * as mesh from "@furnace/core/mesh";
import { quat, vec3 } from "@furnace/core/transform";
import {
  add,
  ready as demoWasmReady,
} from "../plugins/demo-wasm/pkg/demo_wasm";
import { mountFpsOverlay } from "./overlay/mount.ts";
import { fpsSystem } from "./overlay/state.svelte.ts";
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
  });

  // Meshes. The SDF triangle uses a covering quad in world space; the cube and plane use built-ins.
  const sdfGeo = mesh.createGeometry(ctx, {
    positions: new Float32Array([-10, -10, 0, 30, -10, 0, -10, 30, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  });

  return mesh.create(ctx, { geometry: sdfGeo, material: sdfMat });
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
  const planeMat = await material.unlit(ctx, { color: [0.1, 0.15, 0.2, 1] });

  const cubeMesh = mesh.cube(ctx, { material: cubeMat });
  const planeMesh = mesh.plane(ctx, {
    material: planeMat,
    size: PLANE_BACKDROP_SIZE,
  });

  mesh.setPosition(planeMesh, new Float32Array([0, 0, PLANE_Z]));
  mesh.setPosition(cubeMesh, new Float32Array([CUBE_X, 0, 0]));

  gpu.onResize(ctx, ({ width, height }) => {
    camera.setAspect(cam, width / height);
  });

  input.attach(canvas);
  mountFpsOverlay(uiRoot);

  // const pos = { x: 0, y: 0 };
  const rotation = quat.create();
  // const sdfPosition = new Float32Array(3);
  const sdfPosition = vec3.fromValues(0, 0, 0);

  frame.loop(ctx, ({ deltaMs, elapsedMs }) => {
    fpsSystem.frame();

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
    mesh.setPosition(sdfMesh, sdfPosition);

    // update cube position
    quat.fromEuler(
      rotation,
      elapsedMs * CUBE_ROTATION_PITCH_RATE,
      elapsedMs * CUBE_ROTATION_YAW_RATE,
      0,
    );
    mesh.setRotation(cubeMesh, rotation);

    frame.render(ctx, {
      draw: [planeMesh, cubeMesh, sdfMesh],
      camera: cam,
      clearColor: [0.05, 0.05, 0.07, 1],
    });
  });
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});

// THE PHOTOGRAPH: the editor's own frame, aimed at an off-screen texture, read
// back as pixels and encoded as a PNG an agent can look at. Foundations T4c's
// eyes.
//
// IT BORROWS THE VIEWPORT'S COMPOSITION AND BUILDS NOTHING OF ITS OWN, and that
// is the load-bearing decision rather than an implementation convenience. The
// draw list, the lights, the ambient term, the clear colour and every line
// overlay arrive as one {@link FrameComposition} from `field-render.ts` — the
// same record `Render.scene` submits at the swap chain one statement later in
// the same frame. What this module supplies is a TARGET and a CAMERA and
// nothing else.
//
// The evidence is in `docs/research/2026-08-09-viewport-capture-technique.md`,
// and the short form is that every shipped 3D-editor capture tool read at source
// does this: BlenderMCP's `get_viewport_screenshot` reuses the live view's camera
// matrices AND its shading settings; Unity-MCP's scene-view shot re-renders
// through the actual editor camera; Unity-MCP's one isolated eye INJECTS a
// default light rather than rendering unlit. **A zero-light separate pipeline has
// no precedent**, and shading is a measured input channel for a vision model
// (VISER, arxiv 2605.06311: specular off 10% vs on 90% task success), so an
// unlit capture zeroes out channels the model would otherwise read.
//
// AND IT IS NOT A CANVAS SNAPSHOT, deliberately and permanently. `toDataURL` /
// `toBlob` on the LIVE WebGPU canvas is the obvious cheap route and it does not
// ship, not even as a debug secondary: WebKit bug 316538 (filed 2026-06-08,
// status NEW at 2026-08-09) returns STALE or INCOMPLETE frames from exactly that
// call around active rendering, Safari is the primary browser here, and this
// editor's frame is multi-submit (one `frame.render` plus up to thirteen line
// passes), which makes "incomplete" the likely failure rather than the exotic
// one. A non-blank result is what that bug still produces, so no length check
// can rule it out. Nothing below touches the swap chain.
//
// **THE 2D CANVAS BELOW IS NOT THAT BUG AND IS ALSO NOT MEASURED.** The encode
// path paints a canvas this module created from bytes it already owns
// (`putImageData`) and asks it for a PNG (`toBlob`) — ordinary 2D canvas API with
// no WebGPU interop in it, so 316538 cannot reach it. But the direction has never
// been run on macOS Safari or in the wry shell:
// `docs/learnings/2026-05-17-render-to-texture.md`
// records that the OPPOSITE direction (`copyExternalImageToTexture`, CPU canvas →
// GPU) silently no-ops there and had to be replaced with `writeTexture` +
// `getImageData`. Nothing about that finding implicates this direction, and
// nobody has checked. The first real measurement is the holistic Safari gate at
// this tranche's review, and whoever runs it should know that is what they are
// measuring.
//
// WHAT THE CAPTURE GUARANTEES ABOUT THE WORLD, stated because the honest answer
// is smaller than a reader would assume. It draws **exactly what the viewport is
// drawing** — including chunks whose remesh has not landed yet. `field-world.ts`
// drains at most `REMESH_PER_FRAME` dirty chunks per frame through a worker and
// applies the result asynchronously, so an edit made a millisecond ago may not be
// in ANY mesh, on screen or here. This module deliberately neither drains the set
// nor waits for it: parity with the human's screen is the property the whole
// design is for, and a capture that waited would be a picture of a viewport that
// does not exist yet. A caller that needs post-edit geometry must wait on the
// edit's own completion signal, not on this.
//
// THE STATE IT IS ALLOWED TO TOUCH IS NONE. A supplied view NEVER moves the
// human's camera — `CameraRig.orbit()` hands over a deep copy, `snapToAxis` is a
// pure function on it, and the camera this module aims is its own, built once and
// re-aimed per call. That is the collaboration constraint the research names, and
// it is pinned (`tests/field-capture.gpu.test.ts`) by reading the rig either side
// of a posed capture. The one mutation anywhere on the path is `compose`'s ghost-
// cube pose, which is argued in `field-render.ts`'s header and is idempotent.
//
// EVERY GPU SUBMIT HAPPENS BEFORE THE FIRST AWAIT, which is what makes an async
// capture safe beside a synchronous 60 Hz render loop: compose, the mesh pass,
// the line passes and the copy are recorded and submitted in one synchronous run,
// and only then does `mapAsync` yield. A `tick` cannot interleave with a
// half-recorded capture, and a capture cannot draw a frame the loop has since
// changed.
//
// AND TWO CAPTURES CANNOT SPOIL EACH OTHER EITHER, which is a different question
// and needs its own answer because nothing serializes backchannel asks — a second
// `viewport.capture` can arrive while the first is parked on `mapAsync`. Almost
// everything on the path is per-call (the texture, the depth, the readback buffer,
// the composition), so there is exactly ONE shared mutable binding: the off-screen
// camera `aim` writes. Capture B re-aims it while capture A is suspended.
//
// A's PIXELS ARE ALREADY DECIDED BY THEN, and the mechanism is queue ordering
// rather than luck. `aim` writes CPU-side matrices; `renderToTexture` then calls
// `_ensureCameraBuffer`, which does `queue.writeBuffer(cameraBuffer, …)` and is
// followed by the pass's `queue.submit` — all synchronously, all before A yields.
// B's `writeBuffer` is therefore enqueued AFTER A's submit, and WebGPU orders
// `writeBuffer` against submits on the same queue, so A's draws read A's matrices
// out of the shared buffer no matter what B does to it afterwards. The interleave
// is safe for the same reason the render loop's is: the await is after the work,
// not inside it.
//
// What that argument does NOT license is moving an `aim` (or any other write to a
// binding outside this call) to AFTER the first await. Whoever does that owes this
// paragraph a rewrite, because the ordering it rests on would no longer hold.
import * as camera from "@furnace/core/camera";
import * as frame from "@furnace/core/frame";
import type { Context } from "@furnace/core/gpu";
import {
  type CaptureView,
  DEFAULT_CAPTURE_SIZE,
  MAX_CAPTURE_SIZE,
  MIN_CAPTURE_SIZE,
} from "../shared/capture.ts";
import { type OrbitState, snapToAxis, toEyeTarget } from "./camera-control.ts";
import { EDITOR_PROJECTION } from "./field-camera-rig.ts";
import type { FrameComposition } from "./field-render.ts";
import type { Axis } from "./gizmo.ts";

type Vec3T = [number, number, number];

/** Which axis each named view puts the EYE on, and on which side — `snapToAxis`'
 *  own `(axis, sign)` pair, which is also `FieldHost.snapView`'s. A table rather
 *  than string arithmetic on the two characters: the union is closed and small,
 *  and the compiler checks a table for completeness. */
const AXIS_VIEWS: Record<
  Exclude<CaptureView, "user">,
  { axis: Axis; sign: 1 | -1 }
> = {
  "+x": { axis: "x", sign: 1 },
  "-x": { axis: "x", sign: -1 },
  "+y": { axis: "y", sign: 1 },
  "-y": { axis: "y", sign: -1 },
  "+z": { axis: "z", sign: 1 },
  "-z": { axis: "z", sign: -1 },
};

/** What an agent asks for. Every member is optional; `{}` is the useful default
 *  (the human's own view, 1024 px long edge, overlays on). */
export type CaptureRequest = {
  /** Where to look from. Default `"user"`. The union and the whole
   *  parameter-shape argument live on the neutral floor (`shared/capture.ts`),
   *  because the daemon validates this value and cannot reach anything that
   *  imports the engine. */
  view?: CaptureView;
  /** Longest edge in pixels, CLAMPED to `[MIN_CAPTURE_SIZE, MAX_CAPTURE_SIZE]`
   *  rather than refused — the daemon's schema takes the refusing half, and
   *  `shared/capture.ts` argues why one bound wears two postures. The result
   *  reports the size it actually got, so a clamp is visible to the caller
   *  instead of being a silent surprise. Default `DEFAULT_CAPTURE_SIZE`. */
  size?: number;
  /** Whether the line overlays — grid, selection outlines, gizmo, brush ghost,
   *  cursor mark — are drawn. Default `true`, because they are most of what tells
   *  an agent what the human has armed and selected. `false` gives the geometry
   *  alone. Note this gates the LINE passes only: translucent mesh overlays (the
   *  kit-fill hologram, the stamp ghosts, the void cast) are part of the scene and
   *  ride the layer flags the human set. */
  overlays?: boolean;
};

/** A request with every default resolved and every derivation done — the pure
 *  half of a capture, separated so it can be pinned without a GPU. */
export type CapturePlan = {
  /** The view actually used (the request's, or `"user"`). */
  view: CaptureView;
  width: number;
  height: number;
  overlays: boolean;
  /** Where the off-screen camera sits, aims and stands up — `toEyeTarget` over the
   *  derived orbit. */
  eye: Vec3T;
  target: Vec3T;
  up: Vec3T;
};

/** Canonical RGBA8, tightly packed (no row padding), straight from the readback
 *  after the channel swizzle. `width * height * 4` bytes, exactly. */
export type CapturePixels = {
  rgba: Uint8Array;
  width: number;
  height: number;
};

/** What a capture answers with: PNG bytes plus the size and view they describe. */
export type CaptureImage = {
  /** PNG, not JPEG: the overlays are one-pixel lines and JPEG rings around them. */
  png: Uint8Array;
  width: number;
  height: number;
  /** Echoed so a caller reading a picture knows which one it asked for. */
  view: CaptureView;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Fit the requested longest edge to the canvas's aspect ratio.
 *
 * ASPECT COMES FROM THE CANVAS, never from the request, and that is what makes a
 * `"user"` capture a photograph rather than a re-framing: the off-screen camera
 * gets the same aspect the live one has, so the picture contains what the human
 * can see and nothing else. It is also why there is no `width`/`height` pair on
 * {@link CaptureRequest} — supplying one would let a caller ask for a shape the
 * viewport does not have, and then the capture would either letterbox or lie.
 *
 * @throws Error - if the canvas has no size. A zero-dimension backing store means
 *   the editor is not laid out; producing a 1×1 texture instead would answer a
 *   question nobody asked.
 */
export function captureDimensions(
  canvasWidth: number,
  canvasHeight: number,
  size?: number,
): { width: number; height: number } {
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) {
    throw new Error(
      `field-capture: the editor canvas has no size (${canvasWidth}×${canvasHeight}), so there is nothing to photograph`,
    );
  }
  const longEdge = clamp(
    Math.round(size ?? DEFAULT_CAPTURE_SIZE),
    MIN_CAPTURE_SIZE,
    MAX_CAPTURE_SIZE,
  );
  const scale = longEdge / Math.max(canvasWidth, canvasHeight);
  return {
    width: Math.max(1, Math.round(canvasWidth * scale)),
    height: Math.max(1, Math.round(canvasHeight * scale)),
  };
}

/**
 * The rig state a view is taken from — `orbit` itself for `"user"`, an
 * axis-snapped copy of it for the six named views.
 *
 * PURE, and its input is already a copy (`CameraRig.orbit()` deep-copies before
 * handing anything over). `snapToAxis` keeps the pivot and the distance and moves
 * only the angles, so a named view frames whatever the human framed — which is
 * the property that lets an agent ask for one without knowing where anything is.
 */
export function captureOrbit(orbit: OrbitState, view: CaptureView): OrbitState {
  if (view === "user") return orbit;
  const { axis, sign } = AXIS_VIEWS[view];
  return snapToAxis(orbit, axis, sign);
}

/** Resolve a request against the live canvas and rig. Pure — it reads no GPU and
 *  writes nothing.
 *
 *  @throws Error - if the canvas has no size ({@link captureDimensions}). */
export function resolveCapture(
  req: CaptureRequest,
  canvasWidth: number,
  canvasHeight: number,
  orbit: OrbitState,
): CapturePlan {
  const view = req.view ?? "user";
  const { width, height } = captureDimensions(
    canvasWidth,
    canvasHeight,
    req.size,
  );
  const { eye, target, up } = toEyeTarget(captureOrbit(orbit, view));
  return {
    view,
    width,
    height,
    overlays: req.overlays ?? true,
    eye,
    target,
    up,
  };
}

/**
 * Whether a texture format's first byte is red or blue.
 *
 * **THE READBACK IS BGRA ON THIS PLATFORM AND THE CODE MUST NOT ASSUME IT.**
 * `renderToTexture` demands the capture texture match the context's working
 * colour format, which for the LDR editor is `ctx.format` =
 * `getPreferredCanvasFormat()` + `-srgb` — and the preferred canvas format is
 * `bgra8unorm` under bun-webgpu on this machine, measured at this task (it is the
 * value macOS reports generally, but only the bun-webgpu adapter was probed here).
 * So `copyTextureToBuffer` yields B,G,R,A
 * while `ImageData` demands R,G,B,A, and a capture with red and blue swapped
 * passes every "is it blank" check anyone would think to write. Branching on the
 * format rather than hard-coding the swap is what keeps this correct on a
 * platform whose preferred format is `rgba8unorm` — Android and some Linux
 * configurations report exactly that.
 *
 * @throws Error - for any other format. There is no 8-bit RGBA reading of, say,
 *   `rgb10a2unorm`, and guessing one would produce a plausible-looking wrong
 *   picture.
 */
export function channelOrder(format: GPUTextureFormat): "rgba" | "bgra" {
  if (format.startsWith("rgba8")) return "rgba";
  if (format.startsWith("bgra8")) return "bgra";
  throw new Error(
    `field-capture: cannot read back colour format '${format}' as 8-bit RGBA`,
  );
}

/**
 * Turn one `copyTextureToBuffer` result into canonical, tightly-packed RGBA.
 *
 * TWO JOBS, and both are the kind that silently produce a picture rather than an
 * error when they are wrong. (1) `bytesPerRow` must be a multiple of 256, so
 * every row but the last carries padding that is not image data. **Every width
 * that is a multiple of 64 px is already aligned** (`64 × 4 = 256`), which
 * includes 128, 512 and the default 1024 — so the widths a developer reaches for
 * first are exactly the ones that never exercise the strip. (2) The source
 * channel order is the platform's ({@link channelOrder}), and the destination's
 * is always RGBA.
 *
 * IT REFUSES A SHORT `src` rather than padding it with zeroes, which is
 * {@link channelOrder}'s posture one function up and is here for the same reason:
 * a buffer that ends early yields a picture with a black bottom, and a black
 * bottom is something a scene can legitimately have. The bound checked is the
 * true one — the LAST row needs no padding, which is also all
 * `copyTextureToBuffer` requires of its destination.
 *
 * ALPHA IS COPIED, NOT FORCED. It is 255 everywhere by construction — the pass
 * clears to an opaque colour, the blended materials are premultiplied
 * (`dstA' = srcA + dstA(1−srcA)`, which is a fixed point at 1), and the line
 * pipelines declare no blend state at all — and `tests/field-capture.gpu.test.ts`
 * pins that on a real frame. It matters because `putImageData` interprets its
 * input as STRAIGHT alpha while the readback is premultiplied: the two agree
 * exactly when alpha is 1, and only then.
 *
 * @throws Error - if `format` is not 8-bit RGBA/BGRA, or `src` is too short to
 *   hold a `width × height` image at `bytesPerRow`.
 */
export function toRgba(
  src: Uint8Array,
  format: GPUTextureFormat,
  width: number,
  height: number,
  bytesPerRow: number,
): Uint8Array {
  const order = channelOrder(format);
  const rowBytes = width * 4;
  const needed = bytesPerRow * (height - 1) + rowBytes;
  if (src.length < needed) {
    throw new Error(
      `field-capture: the readback is ${src.length} bytes, short of the ${needed} a ${width}×${height} image at ${bytesPerRow} bytes per row needs`,
    );
  }
  // Un-pad first, in whole rows: `set` over a `subarray` copies without a single
  // indexed read, so the row walk cannot be off by one in either buffer.
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = y * bytesPerRow;
    out.set(src.subarray(from, from + rowBytes), y * rowBytes);
  }
  if (order === "rgba") return out;
  // Then swap R and B in place. A DataView rather than `out[i]` because
  // `noUncheckedIndexedAccess` widens every indexed read to `number | undefined`
  // at a VARIABLE index — which `typescript.md`'s hot-path exemption does not
  // cover — and `getUint8` returns a plain `number` while range-checking for
  // free. This is a once-per-capture pass, not a hot path.
  const bytes = new DataView(out.buffer);
  for (let o = 0; o < out.length; o += 4) {
    const blue = bytes.getUint8(o);
    bytes.setUint8(o, bytes.getUint8(o + 2));
    bytes.setUint8(o + 2, blue);
  }
  return out;
}

/** `copyTextureToBuffer`'s alignment rule, as arithmetic: rows are 256-byte
 *  aligned. */
const ROW_ALIGNMENT = 256;
function alignedBytesPerRow(width: number): number {
  return Math.ceil((width * 4) / ROW_ALIGNMENT) * ROW_ALIGNMENT;
}

/**
 * Draw one composition into a fresh off-screen target and read it back.
 *
 * The mesh pass carries the composition's own lights and ambient, so the surface
 * shading is the viewport's; the line passes composite over it in the same order
 * `Render.scene` issues them, against the same depth buffer, so `occlude: true`
 * still means occluded. Every GPU command is submitted before the `await`.
 *
 * Allocates and frees a colour texture, a depth texture and a mapped read buffer
 * per call. That is the right trade for an on-demand tool — pooling three
 * resources whose SIZE is a per-call parameter would mean holding the largest
 * capture anyone ever asked for, for as long as the editor is open. All three are
 * created INSIDE the `try`, so a failure allocating the second or the third frees
 * the ones before it rather than leaking them.
 *
 * **EXPORTED, and its second caller is a test — which is the point rather than an
 * apology.** Everything this function decides is invisible from {@link Capture.scene}:
 * whether the lights reached the pass, whether the line overlays composited,
 * whether the row padding was stripped, whether the channels were swapped. Reading
 * those off the PNG would mean decoding one, and reading them off `scene` means
 * stubbing a `document`. So the GPU contract is pinned here directly
 * (`tests/field-capture.gpu.test.ts`), on the same footing as {@link toRgba} and
 * {@link captureOrbit} — the pure pieces this module already exports because their
 * correctness cannot be seen from outside. `encodeCapturePng` is deliberately NOT
 * exported beside it: it is a thin adapter over a platform API with one caller and
 * nothing headlessly checkable in it.
 *
 * @throws FurnaceGpuError - from `renderToTexture` / `drawLinesToTexture` if the
 *   context is disposed, multisampled, or HDR. All three are setup-loud there and
 *   are not re-checked here; the editor's context is `sampleCount: 1` and LDR by
 *   construction (`FieldHost.init` states it).
 * @throws Error - if the readback format is not 8-bit RGBA/BGRA.
 */
export async function capturePixels(
  ctx: Context,
  plan: CapturePlan,
  composition: FrameComposition,
  view: camera.Camera,
): Promise<CapturePixels> {
  const { width, height } = plan;
  const size = { width, height };
  const bytesPerRow = alignedBytesPerRow(width);
  let texture: GPUTexture | undefined;
  let depthTexture: GPUTexture | undefined;
  let readback: GPUBuffer | undefined;
  try {
    texture = ctx.device.createTexture({
      size,
      format: ctx.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    // REQUIRED, not optional. `renderToTexture` would take a depth-less pass, but
    // every material here is depth-enabled and BOTH line pipelines declare a
    // depth-stencil state — so `drawLinesToTexture` demands one even for the
    // always-on-top overlays. One texture serves both passes, which is also what
    // makes `occlude: true` mean the same thing off-screen as on.
    depthTexture = ctx.device.createTexture({
      size,
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    readback = ctx.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    frame.renderToTexture(ctx, {
      texture,
      depthTexture,
      camera: view,
      meshes: composition.meshes,
      instanced: composition.instanced,
      lights: composition.lights,
      ambient: composition.ambient,
      clearColor: composition.clearColor,
    });
    if (plan.overlays) {
      for (const pass of composition.lines) {
        frame.drawLinesToTexture(ctx, {
          texture,
          depthTexture,
          camera: view,
          vertices: pass.vertices,
          colors: pass.colors,
          occlude: pass.occlude,
        });
      }
    }
    const encoder = ctx.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readback, bytesPerRow, rowsPerImage: height },
      size,
    );
    ctx.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    // Swizzled and un-padded WHILE MAPPED — `toRgba` writes into its own output,
    // so nothing survives the `unmap` below by reference.
    const rgba = toRgba(
      new Uint8Array(readback.getMappedRange()),
      ctx.format,
      width,
      height,
      bytesPerRow,
    );
    readback.unmap();
    return { rgba, width, height };
  } finally {
    texture?.destroy();
    depthTexture?.destroy();
    readback?.destroy();
  }
}

/**
 * Encode canonical RGBA as PNG bytes, through a 2D canvas.
 *
 * **BROWSER-ONLY, and the only line on the capture path that is.** Everything
 * above runs anywhere there is a WebGPU device, which is what lets the GPU half be
 * pinned headlessly; this needs a `document`. See this module's header for why
 * the direction is believed safe on Safari and why nobody has proved it.
 *
 * **MODULE-PRIVATE, unlike its GPU sibling**, and the asymmetry is the argument.
 * {@link capturePixels} is exported because a test is the only thing that can see
 * what it decides; this has nothing headlessly checkable in it — it is four
 * platform calls whose behaviour is the platform's — so exporting it would add
 * surface no caller and no assertion wants. Its one caller is
 * {@link Capture.scene}, in this file.
 *
 * `createImageData` off the 2D context rather than the `ImageData` constructor, so
 * the encode reaches exactly one global name — `document` — and every other object
 * it touches hangs off the element that call produced.
 *
 * @throws Error - if a 2D context cannot be had, or the canvas declines to encode.
 */
async function encodeCapturePng(px: CapturePixels): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = px.width;
  canvas.height = px.height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("field-capture: no 2D context to encode a PNG with");
  const image = g.createImageData(px.width, px.height);
  image.data.set(px.rgba);
  g.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("field-capture: the canvas produced no PNG");
  return new Uint8Array(await blob.arrayBuffer());
}

/** What a capture needs from the rest of the host. THREE members, every one a
 *  call, and none of them writes anything. */
export type CaptureDeps = {
  /** The GPU context, or `null` before `init` / after `dispose`
   *  (`HostSubstrate.ctx`). Also carries the canvas the aspect is read from. */
  ctx(): Context | null;
  /** The live rig state, deep-copied — `field-camera-rig.ts`'s `orbit`. The copy
   *  is that member's contract, and it is what makes "a posed capture never moves
   *  the human's camera" structural. */
  orbit(): OrbitState;
  /** This frame's draw lists — `field-render.ts`'s `compose`. The whole borrowing
   *  argument is that this is the SAME record the viewport submits. */
  compose(c: Context): FrameComposition;
};

/** The capture seam: one verb. */
export type Capture = {
  /** Photograph the viewport. See {@link CaptureRequest} for the parameters and
   *  this module's header for what the picture is and is not a guarantee about.
   *
   *  @throws Error - if there is no GPU context (the editor has not initialised,
   *    or has been disposed), if the canvas has no size, or if the readback or
   *    the PNG encode fails. Setup-loud throughout: a capture is a one-shot
   *    request with a caller waiting on an answer, so a silent no-op would be the
   *    hang the whole backchannel is written against. */
  scene(req: CaptureRequest): Promise<CaptureImage>;
};

/**
 * Build the capture verb over one host's dependencies.
 *
 * It owns exactly one binding: the off-screen camera, created on the first
 * capture and RE-AIMED on every one after it. That is not micro-optimisation —
 * `frame`'s per-camera uniform buffer cache is keyed by camera IDENTITY in a
 * strong `Map` that lives until the context is disposed, so a fresh
 * `camera.perspective` per capture would leak one GPU buffer per photograph for
 * as long as the editor stays open. One camera, re-aimed, is also the shape the
 * rig itself uses.
 */
export function createCapture(deps: CaptureDeps): Capture {
  let offscreen: camera.Camera | null = null;

  /** Point the off-screen camera at a plan. Its projection is the rig's
   *  ({@link EDITOR_PROJECTION}) with the CAPTURE's aspect, which is the one
   *  number that may differ from the viewport's — and does, by rounding, whenever
   *  the requested pixel size does not divide the canvas exactly. */
  const aim = (plan: CapturePlan): camera.Camera => {
    const cam =
      offscreen ??
      camera.perspective({
        ...EDITOR_PROJECTION,
        aspect: plan.width / plan.height,
      });
    offscreen = cam;
    camera.setAspect(cam, plan.width / plan.height);
    camera.setPosition(cam, new Float32Array(plan.eye));
    camera.setTarget(cam, new Float32Array(plan.target));
    camera.setUp(cam, new Float32Array(plan.up));
    return cam;
  };

  return {
    async scene(req) {
      const c = deps.ctx();
      if (!c) {
        throw new Error(
          "field-capture: no GPU context — the editor has not initialised, or has been disposed",
        );
      }
      const plan = resolveCapture(
        req,
        c.canvas.width,
        c.canvas.height,
        deps.orbit(),
      );
      // Composed AFTER the plan, and the order is not arbitrary: `resolveCapture`
      // is the half that can refuse (a canvas with no size), and composing first
      // would pose the ghost cube for a capture that then throws.
      const pixels = await capturePixels(c, plan, deps.compose(c), aim(plan));
      return {
        png: await encodeCapturePng(pixels),
        width: pixels.width,
        height: pixels.height,
        view: plan.view,
      };
    },
  };
}

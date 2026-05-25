import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "camera",
  blurb:
    "camera fundamentals — perspective vs orthographic, FOV, near/far, orbit",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "drag", action: "orbit the camera around origin (yaw + pitch)" },
    { input: "select: cameraKind", action: "perspective / orthographic" },
    {
      input: "slider: fov",
      action: "field of view in degrees — perspective only",
    },
    {
      input: "slider: zoom",
      action: "vertical half-extent — orthographic only",
    },
    { input: "slider: near", action: "near clip distance" },
    { input: "slider: far", action: "far clip distance" },
  ],
  features: [
    "gpu",
    "frame",
    "camera",
    "camera.perspective",
    "camera.orthographic",
    "camera.setPosition",
    "camera.setTarget",
    "camera.setAspect",
    "camera.setFov",
    "camera.setBounds",
    "camera.setNearFar",
    "input.attach / detach",
    "input.onPointerDown / Move / Up",
  ],
  notes: [
    "FOV (field of view) is the vertical angle the perspective camera sees. Wide → fisheye-ish, the cube shrinks but more of the scene is visible. Narrow → telephoto, the cube fills the frame and parallel lines look almost parallel. Try 20° vs 120°.",
    "Orthographic projection has no FOV — instead, setBounds picks a rectangle in world space that maps to the viewport. The zoom slider sets the vertical half-extent; the horizontal half-extent is derived from the canvas aspect so the cube isn't squashed.",
    "Near and far define the clip volume. Anything closer than near or farther than far is clipped. Try sliding far below ~5 to clip the backdrop plane; slide near above ~3 to clip the cube as you orbit close to it.",
    "Perspective vs orthographic: perspective shrinks far things — the cube's far face looks smaller than its near face, parallel lines converge. Orthographic keeps parallel lines parallel — useful for technical drawings, 2D-style games, isometric views. Switch the cameraKind toggle and orbit a bit to feel the difference.",
  ],
  gaps: [
    "No camera roll (camera.setUp rotates around the forward axis) — could be a follow-up control.",
  ],
  order: 10,
} satisfies DemoHelp;

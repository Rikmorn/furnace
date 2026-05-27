import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "camera",
  blurb:
    "camera fundamentals — perspective vs orthographic, FOV, fit policy, anchor, near/far, orbit",
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
      action: "scale multiplier on the orthographic policy — orthographic only",
    },
    {
      input: "select: fitPolicy",
      action: "stretch / preserve-height / preserve-width — orthographic only",
    },
    {
      input: "select: anchor",
      action: "center / corner anchors for derived-bounds policies",
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
    "camera.policy.preserveHeight / preserveWidth / stretch",
    "camera.setFitPolicy",
    "camera.setScale",
    "camera.getBounds",
    "camera.setPosition",
    "camera.setTarget",
    "camera.setFov",
    "camera.setAspect (perspective only)",
    "camera.setNearFar",
    "camera.bindToCanvas",
    "input.attach / detach",
    "input.onPointerDown / Move / Up",
  ],
  notes: [
    "FOV (field of view) is the vertical angle the perspective camera sees. Wide → fisheye-ish, the cube shrinks but more of the scene is visible. Narrow → telephoto, the cube fills the frame and parallel lines look almost parallel. Try 20° vs 120°.",
    "Orthographic projection has no FOV. Instead, a fit policy decides how the camera's bounds respond to canvas resize. preserve-height keeps the vertical world extent fixed and recomputes horizontal from the canvas aspect — the 2D-game default. preserve-width does the mirror. stretch preserves bounds literally and distorts when the canvas aspect changes.",
    "The zoom slider on orthographic drives setScale, a multiplier on the policy's reference extent. It works uniformly across all three policies — scale=2 means twice the world extent visible.",
    "Anchor moves the world origin around the visible rect. (0.5, 0.5) is centered (default). (0, 0) puts the origin at the bottom-left corner of the visible area. (1, 1) puts it at the top-right. Useful for asymmetric framing (e.g. 2D games where the player needs to see ahead of their position).",
    "Near and far define the clip volume. Anything closer than near or farther than far is clipped. Try sliding far below ~5 to clip the backdrop plane; slide near above ~3 to clip the cube as you orbit close to it.",
    "Perspective vs orthographic: perspective shrinks far things — parallel lines converge. Orthographic keeps parallel lines parallel — useful for technical drawings, 2D-style games, isometric views. Switch the cameraKind toggle and orbit a bit to feel the difference.",
  ],
  gaps: [
    "No camera roll (camera.setUp rotates around the forward axis) — could be a follow-up control.",
    "Anchor presets cover the 5 canonical positions; continuous X/Y sliders are deferred.",
  ],
  order: 10,
} satisfies DemoHelp;

import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "physics",
  blurb:
    "Cubes drop and spin onto a ground via @furnace/core/rigid-mesh — a physics Body driving a render Mesh, interpolated. Toggle interpolation off to see the stutter; reset to re-drop.",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    {
      input: "toggle: interpolate",
      action: "blend between fixed ticks vs pin to latest tick",
    },
    {
      input: "slider: fixed Hz",
      action: "physics tick rate (drag low to expose the stutter)",
    },
    {
      input: "button: reset",
      action: "destroy + recreate the cubes at their start poses",
    },
  ],
  features: [
    "rigidMesh.create — owns a physics Body + a render Mesh, cascade-destroyed together",
    "rigidMesh.commit (per fixed tick) + rigidMesh.interpolate (per frame) — engine-owned prev/curr + alpha-blend",
    "physics.step driven from a hand-rolled fixed-step accumulator (the pattern frame.fixedLoop packages)",
    "interpolation on/off — alpha vs alpha=1, the same lesson as the animation demo, now physics-driven",
    "rigidMesh.getMesh — flatten the ground via mesh.setScale on the underlying mesh",
  ],
  gaps: [
    "collision shape == render shape here (cuboid body, cube mesh); collision≠render (capsule collide, cylinder render) lands with the bowling pins (Stage 3/4)",
    "reset re-drops by destroy+recreate; an in-place teleport + interpolation-buffer reset on rigid-mesh is not yet exposed",
  ],
  order: 25,
} satisfies DemoHelp;

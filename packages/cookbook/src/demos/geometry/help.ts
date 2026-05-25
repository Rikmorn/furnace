import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "geometry",
  blurb: "mesh.createGeometry with a custom grid + topology toggle",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "select: topology", action: "triangles / lines / points" },
    {
      input: "slider: subdiv",
      action: "grid subdivisions (rebuilds geometry)",
    },
    {
      input: "slider: amplitude",
      action: "vertical displacement amplitude",
    },
  ],
  features: [
    "mesh.createGeometry",
    "MaterialDescriptor.topology",
    "GeometryData",
  ],
  order: 40,
} satisfies DemoHelp;

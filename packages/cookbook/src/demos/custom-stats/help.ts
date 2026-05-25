import type { DemoHelp } from "../../shared/help-types.ts";

export default {
  title: "custom-stats",
  blurb: "consumer-owned counters + measure block + custom onFrame subscriber",
  controls: [
    { key: "s", action: "toggle stats" },
    { key: "h", action: "toggle help" },
    { key: "c", action: "toggle controls" },
    { input: "button: spawn cube", action: "add a cube to the scene" },
    { input: "button: despawn cube", action: "remove the last cube" },
    {
      input: "toggle: heavy-loop",
      action: "run an artificial perf block inside stats.measure",
    },
  ],
  features: [
    "stats.onFrame (custom subscriber)",
    "stats.gauge (cubes.alive)",
    "stats.increment (cubes.spawn-total, cubes.despawn-total)",
    "stats.measure (heavy-loop)",
  ],
  gaps: [
    "Custom counters land in snap.custom but the engine overlay doesn't render them — registerCustomCounter API would unify this; deferred until a second consumer wants it. Today the local panel is the only visualisation.",
  ],
  order: 90,
} satisfies DemoHelp;

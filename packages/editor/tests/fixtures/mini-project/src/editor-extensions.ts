import { defineService } from "@furnace/core/registry";
import { defineComponent, z } from "@furnace/core/scene";

// Fixture extension: a pure-data custom component. Its presence in
// introspect() + its acceptance by loadScene IS the Branch-A proof.
defineComponent("fixtureGlow", {
  params: { intensity: z.number() },
});

// Fixture service: registration at import time is the Branch-A proof for the
// service seam, mirroring the component above.
defineService("fixtureService", { fn: () => "ok" });

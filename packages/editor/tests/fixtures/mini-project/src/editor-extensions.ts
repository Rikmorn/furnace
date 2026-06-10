import { defineComponent, z } from "@furnace/core/scene";

// Fixture extension: a pure-data custom component. Its presence in
// introspect() + its acceptance by loadScene IS the Branch-A proof.
defineComponent("fixtureGlow", {
  params: { intensity: z.number() },
});

import { createFpsSystem } from "@furnace/core";

export const fpsSystem = createFpsSystem();
export const fps = $state({ value: 0 });

fpsSystem.subscribe((v) => {
  fps.value = v;
});

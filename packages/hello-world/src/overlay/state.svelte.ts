import { createFpsSystem } from "@furnace/core";

export const fpsSystem = createFpsSystem();
export const fps = $state({ value: 0 });

// Module-lifetime subscription; the page never tears this down, so the
// unsubscribe handle is intentionally discarded.
fpsSystem.subscribe((v) => {
  fps.value = v;
});

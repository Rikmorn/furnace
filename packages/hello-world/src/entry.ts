import * as input from "@furnace/core/input";
import { mount } from "svelte";

import { bowlingScene } from "./demos/bowling/scene.ts";
import { triangleScene } from "./demos/triangle/scene.ts";
import { mountFpsOverlay } from "./overlay/mount.ts";
import SceneButtons from "./shell/SceneButtons.svelte";
import type { SceneController, SceneFactory } from "./shell/scene.ts";
import { switcher } from "./shell/switcher-state.svelte.ts";

const SCENES: SceneFactory[] = [triangleScene, bowlingScene];

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (!canvas) throw new Error("canvas#gpu not found");
  if (!uiRoot) throw new Error("#ui-root not found");

  // Shell owns the DOM-bound, ctx-independent chrome: input attaches to the
  // canvas (persists across scene switches) and the FPS overlay mounts once.
  // Each scene owns its own ctx + render loop + overlay subscription.
  input.attach(canvas);
  mountFpsOverlay(uiRoot);

  let active: SceneController | null = null;

  const selectScene = async (index: number): Promise<void> => {
    const alreadyActive = index === switcher.activeIndex && active !== null;
    if (switcher.switching || alreadyActive) return;
    switcher.switching = true;
    try {
      if (active) {
        active.unload();
        active = null;
      }
      const factory = SCENES[index];
      active = factory ? await factory.load(canvas) : null;
      switcher.activeIndex = index;
    } finally {
      switcher.switching = false;
    }
  };

  mount(SceneButtons, {
    target: uiRoot,
    props: {
      labels: SCENES.map((s) => s.label),
      onSelect: (index: number) => {
        void selectScene(index).catch((e: unknown) => {
          console.error("scene load failed:", e);
        });
      },
    },
  });

  await selectScene(0);
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});

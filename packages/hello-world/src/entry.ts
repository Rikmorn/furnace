import * as frame from "@furnace/core/frame";
import * as gpu from "@furnace/core/gpu";
import * as input from "@furnace/core/input";
import { mount } from "svelte";

import { triangleScene } from "./demos/triangle/scene.ts";
import { mountFpsOverlay } from "./overlay/mount.ts";
import { subscribeOverlay } from "./overlay/state.svelte.ts";
import SceneButtons from "./shell/SceneButtons.svelte";
import type { SceneController, SceneFactory } from "./shell/scene.ts";
import { switcher } from "./shell/switcher-state.svelte.ts";

// Task 9 appends bowlingScene here; the switcher is scene-count-agnostic.
const SCENES: SceneFactory[] = [triangleScene];

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (!canvas) throw new Error("canvas#gpu not found");
  if (!uiRoot) throw new Error("#ui-root not found");

  let ctx: gpu.Context;
  try {
    ctx = await gpu.requestContext(canvas);
  } catch (e) {
    document.body.innerText = e instanceof Error ? e.message : String(e);
    return;
  }

  input.attach(canvas);
  mountFpsOverlay(uiRoot);
  subscribeOverlay(ctx);

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
      active = factory ? await factory.load(ctx) : null;
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

  // The loop starts before the first scene finishes loading; while `active` is
  // null it renders nothing (a blank frame) — intentional and safe.
  frame.loop(ctx, (info) => {
    if (active) active.frame(info);
  });

  await selectScene(0);
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});

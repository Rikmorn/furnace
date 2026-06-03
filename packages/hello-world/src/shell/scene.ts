import type { FrameInfo } from "@furnace/core/frame";
import type { Context } from "@furnace/core/gpu";

/**
 * A loaded scene: drives one frame and tears itself down. State is closed over
 * inside the controller, so the switcher never threads a per-scene type.
 */
export type SceneController = {
  frame(info: FrameInfo): void;
  unload(): void;
};

/** A selectable scene: a label + an async loader that builds its resources. */
export type SceneFactory = {
  label: string;
  load(ctx: Context): Promise<SceneController>;
};

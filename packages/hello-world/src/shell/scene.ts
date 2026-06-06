/**
 * A loaded scene: tears itself down. Each scene owns its own `gpu.Context`,
 * render loop, and overlay subscription, so the switcher only needs to call
 * `unload()` — the controller closes over everything else.
 */
export type SceneController = {
  unload(): void;
};

/**
 * A selectable scene: a label + an async loader. The loader receives the shared
 * DOM canvas and creates its own per-demo `gpu.Context` (so each demo picks its
 * own render config — MSAA, HDR — without forcing it on the others).
 */
export type SceneFactory = {
  label: string;
  load(canvas: HTMLCanvasElement): Promise<SceneController>;
};

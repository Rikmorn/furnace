import { mount, unmount } from "svelte";
import FpsOverlay from "./FpsOverlay.svelte";

export function mountFpsOverlay(target: HTMLElement): () => void {
  const app = mount(FpsOverlay, { target });
  return () => unmount(app);
}

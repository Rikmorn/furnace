import { mount, unmount } from "svelte";
import DebugControls from "./DebugControls.svelte";

export function mountDebugControls(target: HTMLElement): () => void {
  const app = mount(DebugControls, { target });
  return () => unmount(app);
}

import { mount, unmount } from "svelte";
import ChargeMeter from "./ChargeMeter.svelte";

export function mountChargeMeter(target: HTMLElement): () => void {
  const app = mount(ChargeMeter, { target });
  return () => unmount(app);
}

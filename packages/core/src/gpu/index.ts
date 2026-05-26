export type { RequestContextOptions } from "./context.ts";
export {
  dispose,
  getCurrentTextureView,
  isDisposed,
  requestContext,
} from "./context.ts";
export type { Context } from "./context-types.ts";
export { FurnaceError, FurnaceGpuError } from "./errors.ts";
export type { ResizeEvent } from "./resize.ts";

export { onResize } from "./resize.ts";
export { onUncapturedError } from "./uncaptured-error.ts";

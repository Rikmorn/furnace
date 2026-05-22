export type StubCanvasOptions = {
  width?: number; // backing-store px (default 800)
  height?: number; // backing-store px (default 600)
  clientWidth?: number; // CSS px (default 400)
  clientHeight?: number; // CSS px (default 300)
};

/**
 * Build a stub HTMLCanvasElement: a real EventTarget with the four size
 * fields the input module reads. Use in tests that need real DOM dispatch
 * without a browser. DPR is derived as width/clientWidth — defaults give 2.
 */
export function makeStubCanvas(
  opts: StubCanvasOptions = {},
): HTMLCanvasElement {
  const target = new EventTarget();
  return Object.assign(target, {
    width: opts.width ?? 800,
    height: opts.height ?? 600,
    clientWidth: opts.clientWidth ?? 400,
    clientHeight: opts.clientHeight ?? 300,
  }) as unknown as HTMLCanvasElement;
}

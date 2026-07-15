/** Runs `init` on the first frame `canvas` has a nonzero layout box. Dockview panels
 *  can mount zero-sized (hidden behind another tab, mid-layout-shuffle), and core's
 *  `bindToCanvas` throws on width/height 0 — initing eagerly latched hosts broken until
 *  a manual tab-close + refresh (the F1-gate "width and height must be positive" class).
 *  One-shot: fires immediately when already sized, else observes and disconnects on the
 *  first nonzero measure. Distinct from resize-RENDERING, which hosts own via
 *  `gpu.onResize` — this only gates the initial init. Returns a cleanup. */
export function initWhenSized(
  canvas: HTMLCanvasElement,
  init: () => void,
): () => void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    init();
    return () => {
      // Nothing to clean up — init already fired, no observer was created.
    };
  }
  const obs = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      obs.disconnect();
      init();
    }
  });
  obs.observe(canvas);
  return () => obs.disconnect();
}

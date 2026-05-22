// In-process ResizeObserver stand-in. Tests install it via installMockResizeObserver(),
// register canvases via new ResizeObserver(...).observe(canvas), and synthesize layout
// changes by calling fireResize(canvas, w, h). The registry is module-level so fireResize
// can reach observers created elsewhere in the same test.

type Listener = (
  entries: { contentRect: DOMRectReadOnly; target: Element }[],
) => void;

const registry: { target: Element; listener: Listener }[] = [];

export class MockResizeObserver {
  private readonly cb: Listener;

  constructor(cb: Listener) {
    this.cb = cb;
  }

  observe(target: Element): void {
    registry.push({ target, listener: this.cb });
  }

  disconnect(): void {
    for (let i = registry.length - 1; i >= 0; i--) {
      const entry = registry[i];
      if (entry && entry.listener === this.cb) {
        registry.splice(i, 1);
      }
    }
  }

  unobserve(_target: Element): void {
    // not used in tests
    return;
  }
}

function makeContentRect(width: number, height: number): DOMRectReadOnly {
  return {
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON() {
      return {};
    },
  } as DOMRectReadOnly;
}

export function fireResize(
  target: Element,
  width: number,
  height: number,
): void {
  const matches = registry.filter((entry) => entry.target === target);
  for (const { listener } of matches) {
    listener([{ contentRect: makeContentRect(width, height), target }]);
  }
}

export function installMockResizeObserver(): () => void {
  const slot = globalThis as { ResizeObserver?: typeof ResizeObserver };
  const original = slot.ResizeObserver;
  slot.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  return () => {
    if (original) {
      slot.ResizeObserver = original;
    } else {
      slot.ResizeObserver = undefined;
    }
    registry.length = 0;
  };
}

import { FurnaceError } from "../errors.ts";
import type { OrthographicBounds } from "./orthographic.ts";

/**
 * Anchor for derived-bounds fit policies. Components are in `[0, 1]`.
 * `(0.5, 0.5)` = world origin centered in the visible rect (default).
 * `(0, 0)` = origin at the bottom-left corner of the rect.
 * `(1, 1)` = origin at the top-right corner.
 *
 * Y-up convention matches the rest of the camera module.
 */
export type Anchor = { x: number; y: number };

/**
 * Discriminated union of orthographic camera fit policies.
 *
 * `stretch` — bounds preserved literally on resize; aspect change distorts the
 * rendered scene (CSS `object-fit: fill` analog).
 *
 * `preserve-height` — vertical extent fixed at `height`; horizontal extent
 * recomputed from the canvas aspect on resize. Most common 2D-game case.
 *
 * `preserve-width` — mirror of preserve-height.
 *
 * Construct via the {@link policy} factory namespace (validates inputs +
 * supplies the default centered anchor) or by writing the literal directly.
 */
export type FitPolicy =
  | { kind: "stretch"; bounds: OrthographicBounds }
  | { kind: "preserve-height"; height: number; anchor: Anchor }
  | { kind: "preserve-width"; width: number; anchor: Anchor };

const DEFAULT_ANCHOR: Anchor = Object.freeze({ x: 0.5, y: 0.5 });

function validateBounds(bounds: OrthographicBounds): void {
  const { left, right, bottom, top } = bounds;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(top)
  ) {
    throw new FurnaceError("bounds must be finite numbers");
  }
  if (left >= right) {
    throw new FurnaceError("bounds.left must be less than bounds.right");
  }
  if (bottom >= top) {
    throw new FurnaceError("bounds.bottom must be less than bounds.top");
  }
}

function validateExtent(value: number, name: "height" | "width"): void {
  if (!Number.isFinite(value)) {
    throw new FurnaceError(`${name} must be a finite number`);
  }
  if (value <= 0) {
    throw new FurnaceError(`${name} must be positive`);
  }
}

function validateAnchor(anchor: Anchor): void {
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    throw new FurnaceError("anchor components must be finite numbers");
  }
  if (anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) {
    throw new FurnaceError("anchor components must be in [0, 1]");
  }
}

/**
 * Factory namespace for {@link FitPolicy} variants. Each factory validates
 * inputs synchronously (setup-loud) and returns a valid policy object.
 *
 * The recommended construction path — inline literals are also valid but lose
 * validation.
 */
export const policy = {
  /**
   * Stretch policy — bounds preserved literally on canvas resize. The
   * rendered scene distorts when the canvas aspect changes.
   *
   * @throws FurnaceError - if any bound is non-finite, `left >= right`, or
   * `bottom >= top`.
   */
  stretch(bounds: OrthographicBounds): FitPolicy {
    validateBounds(bounds);
    return { kind: "stretch", bounds };
  },
  /**
   * Preserve-height policy — vertical world extent fixed at `height`. On
   * canvas resize, horizontal extent is recomputed from the canvas aspect.
   *
   * Anchor defaults to `(0.5, 0.5)` (world origin centered in the visible
   * rect). Supply a custom anchor for asymmetric framing (e.g. `(0, 0)` for
   * a bottom-left origin).
   *
   * @throws FurnaceError - if `height` is non-finite or non-positive, or if
   * anchor components are non-finite or outside `[0, 1]`.
   */
  preserveHeight(height: number, anchor?: Anchor): FitPolicy {
    validateExtent(height, "height");
    const a = anchor ?? DEFAULT_ANCHOR;
    validateAnchor(a);
    return { kind: "preserve-height", height, anchor: a };
  },
  /**
   * Preserve-width policy — mirror of {@link preserveHeight}. Horizontal
   * world extent fixed at `width`; vertical extent recomputed from canvas
   * aspect on resize.
   *
   * @throws FurnaceError - if `width` is non-finite or non-positive, or if
   * anchor components are non-finite or outside `[0, 1]`.
   */
  preserveWidth(width: number, anchor?: Anchor): FitPolicy {
    validateExtent(width, "width");
    const a = anchor ?? DEFAULT_ANCHOR;
    validateAnchor(a);
    return { kind: "preserve-width", width, anchor: a };
  },
};

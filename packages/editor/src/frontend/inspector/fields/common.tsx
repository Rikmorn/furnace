import type { PointerEventHandler, ReactNode } from "react";

interface LabelPointerProps {
  onPointerDown: PointerEventHandler<HTMLSpanElement>;
  onPointerMove: PointerEventHandler<HTMLSpanElement>;
  onPointerUp: PointerEventHandler<HTMLSpanElement>;
  onPointerCancel: PointerEventHandler<HTMLSpanElement>;
}

export function FieldRow({
  path,
  children,
  labelPointerProps,
}: {
  path: string;
  children: ReactNode;
  labelPointerProps?: LabelPointerProps;
}) {
  const labelSpanCls = [
    "shrink-0 text-xs text-muted-foreground",
    // Scrub affordance: an ew-resize cursor + a subtle dotted hover underline signal the
    // (already-wired) horizontal drag-to-scrub on numeric labels — otherwise invisible.
    labelPointerProps
      ? "cursor-ew-resize select-none hover:underline hover:decoration-dotted hover:underline-offset-2"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className={labelSpanCls} {...labelPointerProps}>
        {path.split(".").at(-1)}
      </span>
      <span className="flex min-w-0 flex-1 justify-end gap-1">{children}</span>
    </label>
  );
}

export const MIXED = "—";

/**
 * A visible per-axis label chip shown before a vector/quaternion component input
 * (x/y/z/w, or the euler-degree labels). Discoverable at a glance rather than hidden
 * in a `title` tooltip. Mono + muted so it reads as a data annotation, not a control.
 */
export function AxisChip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="shrink-0 select-none font-mono text-[10px] leading-none text-muted-foreground"
    >
      {children}
    </span>
  );
}

// Dense-inspector overrides for the shadcn <Input>. The shadcn defaults (h-9,
// text-base/md:text-sm, px-3, bg-transparent, shadow-sm) are sized for standalone
// forms; a property inspector row needs the compact, filled, right-aligned look the
// old raw inputCls had. tailwind-merge resolves each conflicting utility last-wins,
// so we only list the deltas. The focus ring is intentionally NOT set here — <Input>
// already brings the unified focus-visible:ring-ring (--ring), replacing inputCls's
// old focus:ring so there is ONE focus-ring system.
export const denseInputCls =
  "h-auto min-w-0 bg-input px-1 py-0.5 text-right text-xs md:text-xs shadow-none";

// Numeric variant (NumberField / VecField / QuatField): Data-Is-Mono — numbers get the
// mono family + tabular-nums so digits align in a column and read as data, not prose.
// String/text inputs deliberately stay on denseInputCls (proportional).
export const denseNumericInputCls = `${denseInputCls} font-mono tabular-nums`;

// Same dense treatment for the shadcn <SelectTrigger> (defaults h-9/text-sm/px-3/
// bg-transparent/shadow-sm). Alignment stays trigger-default (value left, chevron
// right via the component's justify-between).
export const denseTriggerCls =
  "h-auto min-w-0 bg-input px-1 py-0.5 text-xs shadow-none";

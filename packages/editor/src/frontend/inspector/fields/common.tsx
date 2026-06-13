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
    "shrink-0 text-xs text-neutral-400",
    labelPointerProps ? "cursor-ew-resize select-none" : "",
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
export const inputCls =
  "w-full min-w-0 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-neutral-500";

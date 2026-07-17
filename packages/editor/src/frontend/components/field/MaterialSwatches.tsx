// The persistent material strip (the MagicaVoxel always-on-palette pattern
// from the F2 tool-UX research): one square per catalog class, its colour as
// the swatch face, the active ring on the tool's materialId — which mirrors
// through subscribeTool, so an Alt-click eyedrop moves the ring too. Kit
// classes disable while paint is active: paint emits a sphere-shaped op and
// core rejects kit-class writes without a lattice box (assertOpValid), so
// offering the pick would only manufacture per-stroke errors. Plain
// <button>s, not the shadcn Button — its `disabled:pointer-events-none`
// would kill the title tooltip that explains exactly that.
import type { MaterialTable } from "@furnace/core/field"; // type-only: erased
import { cn } from "../../lib/cn.ts";

/** A catalog colour ([0,1] rgba) as a CSS color for the swatch face. */
const cssColor = (c: [number, number, number, number]): string =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3]})`;

export function MaterialSwatches(props: {
  classes: MaterialTable["classes"];
  /** The tool's current materialId (the active ring). */
  activeId: number;
  /** True while the active brush cannot write kit classes (paint). */
  disableKit: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="brush material"
    >
      {props.classes.map((c) => {
        const disabled = props.disableKit && c.kind === "kit";
        return (
          <button
            key={c.id}
            type="button"
            title={
              disabled ? `${c.name} — kit classes can't be painted` : c.name
            }
            aria-label={`material ${c.name}`}
            aria-pressed={c.id === props.activeId}
            disabled={disabled}
            onClick={() => props.onSelect(c.id)}
            className={cn(
              "h-6 w-6 rounded-sm border border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              disabled && "cursor-not-allowed opacity-40",
              c.id === props.activeId &&
                "ring-2 ring-ring ring-offset-1 ring-offset-background",
            )}
            style={{ backgroundColor: cssColor(c.color) }}
          />
        );
      })}
    </div>
  );
}

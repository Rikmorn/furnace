// Viewport view-flag metadata, component-agnostic (like lib/panels.ts owns PANELS) so both
// the View▸View-flags menu and the viewport overlay import it without pulling each other's
// component graph.
import type { ViewFlags } from "../../viewport-host/index.ts"; // type-only: erased

/** View-flag menu/overlay rows, in display order. Single source for the label + flag key so
 *  the View▸View-flags menu and the viewport overlay popover render the identical set. */
export const VIEW_FLAG_ITEMS: { key: keyof ViewFlags; label: string }[] = [
  { key: "grid", label: "Grid" },
  { key: "axes", label: "Axes" },
  { key: "headlamp", label: "Headlamp" },
  { key: "fog", label: "Fog" },
];

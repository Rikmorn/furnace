import { isMixed } from "../lib/mixed.ts";
import type { FieldProps } from "../types.ts";
import { FieldRow } from "./common.tsx";

// RGBA channels are 0..1 in the engine color space. <input type=color> is sRGB
// hex 0..255; we map linearly here (no gamma) — engine-conventions §color says
// the working space is the authored space, so a direct 0..1↔0..255 map keeps the
// swatch consistent with how the value renders. Alpha is edited as a number.
const to255 = (c: number) => Math.max(0, Math.min(255, Math.round(c * 255)));
const hex = (rgba: number[]) =>
  `#${[0, 1, 2].map((i) => to255(rgba[i] ?? 0).toString(16).padStart(2, "0")).join("")}`;

export function ColorField({ values, onPreview, onCommit, path }: FieldProps) {
  const mixed = isMixed(values);
  const rgba = (values[0] as number[]) ?? [0, 0, 0, 1];
  const fanout = (next: number[]) => values.map(() => next);
  return (
    <FieldRow path={path}>
      <input
        type="color"
        value={mixed ? "#000000" : hex(rgba)}
        onChange={(e) => {
          const h = e.target.value;
          const next = [
            parseInt(h.slice(1, 3), 16) / 255,
            parseInt(h.slice(3, 5), 16) / 255,
            parseInt(h.slice(5, 7), 16) / 255,
            rgba[3] ?? 1,
          ];
          onPreview(fanout(next));
        }}
        onBlur={(e) => {
          const h = e.target.value;
          const next = [
            parseInt(h.slice(1, 3), 16) / 255,
            parseInt(h.slice(3, 5), 16) / 255,
            parseInt(h.slice(5, 7), 16) / 255,
            rgba[3] ?? 1,
          ];
          onCommit(fanout(next));
        }}
      />
    </FieldRow>
  );
}

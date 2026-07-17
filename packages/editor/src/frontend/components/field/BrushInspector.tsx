// The brush inspector: plain controls for the active brush — radius (every
// effect), mask (every effect), smooth params (effect=smooth), hollow shell
// fill (effect=fill). Everything funnels through the panel's one onChange →
// host.setTool path. SchemaForm is deliberately NOT used here: its
// commit/preview contract targets document mutation, while these are live
// session knobs (the stamp params in Task 15 get SchemaForm, where a real
// schema exists). The mask's class options come from the parsed CATALOG the
// panel already holds — the chrome cannot value-import core enums.
import type { MaterialTable } from "@furnace/core/field"; // type-only: erased
import type {
  FieldMaskChoice,
  FieldTool,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { Input } from "../ui/input.tsx";
import { SELECT_CLASS } from "../world-panel/fields.tsx";

// Mirror FieldHost's radius clamp range (RADIUS_MIN/MAX) — the chrome cannot
// import the host's value constants (type-only barrel).
const RADIUS_MIN = 0.25;
const RADIUS_MAX = 4;
const RADIUS_STEP = 0.05;

// Fill-only shell-band floor/step (metres) — mirrors the host's HOLLOW_MIN_M
// clamp and the 0.5 m kit lattice. The input does not re-clamp typed values
// (the host is the enforcement point — the input must not fight it); min/step
// keep the native steppers on valid values.
const HOLLOW_MIN_M = 0.5;
const HOLLOW_STEP_M = 0.5;
const HOLLOW_DEFAULT_M = 0.5;

const LABEL_CLASS = "flex items-center gap-1.5 text-muted-foreground";

/** Encode a mask choice as the `<select>` value (`class:<id>` for classes). */
const maskValue = (m: FieldMaskChoice): string =>
  m.kind === "class" ? `class:${m.classId}` : m.kind;

/** Decode a `<select>` value back to a mask choice. Values come from our own
 *  option set, so anything unrecognised (impossible) falls back to none. */
const parseMask = (v: string): FieldMaskChoice => {
  if (v.startsWith("class:"))
    return { kind: "class", classId: Number(v.slice("class:".length)) };
  if (v === "organic-only" || v === "kit-only" || v === "selection")
    return { kind: v };
  return { kind: "none" };
};

const parseSmoothMode = (v: string): FieldTool["smooth"]["mode"] =>
  v === "erode" || v === "fill" ? v : "both";

export function BrushInspector(props: {
  tool: FieldTool;
  radius: number;
  /** Core's smooth ceilings, surfaced via host.getSmoothLimits(). */
  smoothLimits: { maxStrength: number; maxIterations: number };
  /** Catalog classes feeding the "Only <class>" mask options. */
  classes: MaterialTable["classes"];
  onRadius: (r: number) => void;
  onChange: (next: FieldTool) => void;
}) {
  const { tool, smoothLimits, onChange } = props;
  const setSmooth = (patch: Partial<FieldTool["smooth"]>): void =>
    onChange({ ...tool, smooth: { ...tool.smooth, ...patch } });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className={LABEL_CLASS}>
        brush
        <input
          type="range"
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={RADIUS_STEP}
          value={props.radius}
          onChange={(e) => props.onRadius(Number(e.target.value))}
          aria-label="dig radius"
        />
        <span className="w-8 tabular-nums">{props.radius.toFixed(2)}</span>
      </label>
      <label className={LABEL_CLASS}>
        mask
        <select
          value={maskValue(tool.mask)}
          onChange={(e) => onChange({ ...tool, mask: parseMask(e.target.value) })}
          aria-label="brush mask"
          className={SELECT_CLASS}
        >
          <option value="none">None</option>
          <option value="organic-only">Organic only</option>
          <option value="kit-only">Kit only</option>
          <option value="selection">Inside selection</option>
          {props.classes.map((c) => (
            <option key={c.id} value={`class:${c.id}`}>
              Only {c.name}
            </option>
          ))}
        </select>
      </label>
      {tool.effect === "smooth" && (
        <>
          <label className={LABEL_CLASS}>
            strength
            <input
              type="range"
              min={1}
              max={smoothLimits.maxStrength}
              step={1}
              value={tool.smooth.strength}
              onChange={(e) => setSmooth({ strength: Number(e.target.value) })}
              aria-label="smooth strength"
            />
            <span className="w-6 tabular-nums">{tool.smooth.strength}</span>
          </label>
          <label className={LABEL_CLASS}>
            iterations
            <select
              value={tool.smooth.iterations}
              onChange={(e) => setSmooth({ iterations: Number(e.target.value) })}
              aria-label="smooth iterations"
              className={SELECT_CLASS}
            >
              {Array.from({ length: smoothLimits.maxIterations }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL_CLASS}>
            mode
            <select
              value={tool.smooth.mode}
              onChange={(e) => setSmooth({ mode: parseSmoothMode(e.target.value) })}
              aria-label="smooth mode"
              className={SELECT_CLASS}
            >
              <option value="both">Both</option>
              <option value="erode">Erode only</option>
              <option value="fill">Fill only</option>
            </select>
          </label>
        </>
      )}
      {tool.effect === "fill" && (
        <>
          <label className={LABEL_CLASS}>
            <input
              type="checkbox"
              checked={tool.hollow !== null}
              onChange={(e) =>
                onChange({
                  ...tool,
                  hollow: e.target.checked ? HOLLOW_DEFAULT_M : null,
                })
              }
              aria-label="hollow fill"
            />
            hollow
          </label>
          {tool.hollow !== null && (
            <label className={LABEL_CLASS}>
              thickness
              <Input
                type="number"
                min={HOLLOW_MIN_M}
                step={HOLLOW_STEP_M}
                value={tool.hollow}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) onChange({ ...tool, hollow: n });
                }}
                aria-label="hollow thickness"
                className="h-8 w-16"
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}

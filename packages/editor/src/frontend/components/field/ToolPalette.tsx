// The Field panel's tool strip: the four brush effects, the three selection
// gestures, and one stamp button per registry generator. Pure presentation —
// the panel owns the active choice and every host call. A brush button
// highlights only while NO selection mode is armed (LMB then brushes); a
// selection button highlights while its gesture is armed; generator buttons
// are ACTIONS, not toggles — each press opens (or replaces) a stamp session,
// whose UI is the stamp form (Task 15), not a palette state.
import type {
  FieldTool,
  SelectionMode,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { Button } from "../ui/button.tsx";

type ToolEffect = FieldTool["effect"];

const BRUSH_TOOLS: { effect: ToolEffect; label: string; title: string }[] = [
  { effect: "dig", label: "Dig", title: "carve air (momentary: hold Ctrl)" },
  { effect: "fill", label: "Fill", title: "solidify + write the material" },
  { effect: "paint", label: "Paint", title: "retint solid cells (organic classes only)" },
  { effect: "smooth", label: "Smooth", title: "relax the surface (momentary: hold Shift)" },
];

const SELECTION_TOOLS: { mode: SelectionMode; label: string; title: string }[] =
  [
    { mode: "box", label: "Box Select", title: "two clicks span a snapped region" },
    { mode: "material", label: "Wand", title: "flood-select the clicked material" },
    { mode: "void", label: "Room", title: "flood-select an air pocket" },
  ];

export function ToolPalette(props: {
  /** The active brush effect — highlighted only while `selectionMode` is null. */
  effect: ToolEffect;
  /** The armed selection gesture (null = LMB brushes). */
  selectionMode: SelectionMode | null;
  /** Registry generators for the stamp buttons (host `listGenerators`). */
  generators: { id: string; name: string }[];
  onBrush: (effect: ToolEffect) => void;
  onSelectionMode: (mode: SelectionMode) => void;
  onGenerator: (id: string) => void;
}) {
  const brushActive = props.selectionMode === null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label="brush tool"
      >
        {BRUSH_TOOLS.map((t) => (
          <Button
            key={t.effect}
            type="button"
            size="sm"
            variant={
              brushActive && props.effect === t.effect ? "default" : "secondary"
            }
            aria-pressed={brushActive && props.effect === t.effect}
            title={t.title}
            onClick={() => props.onBrush(t.effect)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label="selection tool"
      >
        {SELECTION_TOOLS.map((t) => (
          <Button
            key={t.mode}
            type="button"
            size="sm"
            variant={props.selectionMode === t.mode ? "default" : "secondary"}
            aria-pressed={props.selectionMode === t.mode}
            title={t.title}
            onClick={() => props.onSelectionMode(t.mode)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {props.generators.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label="stamp generator"
        >
          {props.generators.map((g) => (
            <Button
              key={g.id}
              type="button"
              size="sm"
              variant="outline"
              title={`stamp ${g.name} into the current selection`}
              onClick={() => props.onGenerator(g.id)}
            >
              {g.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

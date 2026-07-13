// One region's row in the World panel: id/algorithm header, Reroll + Remove, the seed,
// and the per-algorithm knob fields. Knobs are always REPLACED, never mutated in place —
// the preset tables in world-draft.ts are deep-frozen and a region seeded from one would
// otherwise alias it (an in-place edit would resize every hall in the world, and throw).
import type { DraftRegion } from "../../lib/world-draft.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Field, num, ReasonTip } from "./fields.tsx";

type HallRegion = Extract<DraftRegion, { algorithm: "hall" }>;
type MazeRegion = Extract<DraftRegion, { algorithm: "maze" }>;
type CaveRegion = Extract<DraftRegion, { algorithm: "cave" }>;

// The hall's three size axes, carried with LITERAL tuple indices so a knob edit indexes
// the [number, number, number] without widening to `number` (noUncheckedIndexedAccess).
const HALL_AXES = [
  { label: "w (cells)", axis: 0 },
  { label: "h (cells)", axis: 1 },
  { label: "d (cells)", axis: 2 },
] as const;

const NOT_A_LEAF = "has attached regions — remove its leaves first";

export function RegionRow(props: {
  region: DraftRegion;
  removable: boolean;
  busy: boolean;
  onEdit: (next: DraftRegion) => void;
  onReroll: () => void;
  onRemove: () => void;
}) {
  const { region: r, removable, busy, onEdit, onReroll, onRemove } = props;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {r.id} <span className="text-muted-foreground">({r.algorithm})</span>
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onReroll}
          >
            Reroll
          </Button>
          <ReasonTip reason={removable ? undefined : NOT_A_LEAF}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || !removable}
              onClick={onRemove}
            >
              Remove
            </Button>
          </ReasonTip>
        </div>
      </div>
      <Field label={`${r.id} seed`}>
        <Input
          type="text"
          value={r.seed}
          disabled={busy}
          onChange={(e) => onEdit({ ...r, seed: e.target.value })}
        />
      </Field>
      {r.algorithm === "hall" && (
        <HallKnobFields region={r} busy={busy} onEdit={onEdit} />
      )}
      {r.algorithm === "maze" && (
        <MazeKnobFields region={r} busy={busy} onEdit={onEdit} />
      )}
      {r.algorithm === "cave" && (
        <CaveKnobFields region={r} busy={busy} onEdit={onEdit} />
      )}
    </div>
  );
}

function HallKnobFields(props: {
  region: HallRegion;
  busy: boolean;
  onEdit: (next: HallRegion) => void;
}) {
  const { region: r, busy, onEdit } = props;
  const withAxis = (axis: 0 | 1 | 2, value: number): HallRegion["knobs"] => {
    const size: [number, number, number] = [...r.knobs.size];
    size[axis] = value;
    return { ...r.knobs, size };
  };
  return (
    <div className="flex gap-2">
      {HALL_AXES.map(({ label, axis }) => (
        <Field key={label} label={label}>
          <Input
            type="number"
            value={r.knobs.size[axis]}
            disabled={busy}
            onChange={(e) =>
              onEdit({
                ...r,
                knobs: withAxis(axis, num(e.target.value, r.knobs.size[axis])),
              })
            }
          />
        </Field>
      ))}
    </div>
  );
}

function MazeKnobFields(props: {
  region: MazeRegion;
  busy: boolean;
  onEdit: (next: MazeRegion) => void;
}) {
  const { region: r, busy, onEdit } = props;
  const [cellsX, cellsZ] = r.knobs.cells;
  return (
    <div className="flex gap-2">
      <Field label="cells x">
        <Input
          type="number"
          value={cellsX}
          disabled={busy}
          onChange={(e) =>
            onEdit({
              ...r,
              knobs: {
                ...r.knobs,
                cells: [num(e.target.value, cellsX), cellsZ],
              },
            })
          }
        />
      </Field>
      <Field label="cells z">
        <Input
          type="number"
          value={cellsZ}
          disabled={busy}
          onChange={(e) =>
            onEdit({
              ...r,
              knobs: {
                ...r.knobs,
                cells: [cellsX, num(e.target.value, cellsZ)],
              },
            })
          }
        />
      </Field>
      <Field label="braid">
        <Input
          type="number"
          step="0.05"
          value={r.knobs.braid}
          disabled={busy}
          onChange={(e) =>
            onEdit({
              ...r,
              knobs: { ...r.knobs, braid: num(e.target.value, r.knobs.braid) },
            })
          }
        />
      </Field>
    </div>
  );
}

function CaveKnobFields(props: {
  region: CaveRegion;
  busy: boolean;
  onEdit: (next: CaveRegion) => void;
}) {
  const { region: r, busy, onEdit } = props;
  return (
    <Field label="mouths">
      <Input
        type="number"
        value={r.knobs.mouths}
        disabled={busy}
        onChange={(e) =>
          onEdit({
            ...r,
            knobs: { mouths: num(e.target.value, r.knobs.mouths) },
          })
        }
      />
    </Field>
  );
}

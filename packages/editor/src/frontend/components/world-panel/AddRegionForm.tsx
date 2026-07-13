// The World panel's add-region form (D-W3-7, attach-on-add): a region never enters the
// draft alone — every region after the first carries the ATTACHMENT that ties it to an
// earlier one, so the world is a tree by construction and grid doors are assembled from
// attachments rather than hand-indexed.
import { useState } from "react";
import {
  type ConnectorKindDraft,
  DEFAULT_KNOBS,
  type DraftAlgorithm,
  type DraftAttachment,
  type DraftRegion,
  HALL_PRESET_KNOBS,
  legalKinds,
  nextRegionId,
  type PortalSpot,
  type WallName,
  type WorldDraft,
} from "../../lib/world-draft.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { errorMessage, Field, num, SELECT_CLASS } from "./fields.tsx";

type HallPreset = keyof typeof HALL_PRESET_KNOBS;

const WALLS: WallName[] = ["north", "south", "east", "west"];
// Derived from the table (not a hand-written literal) so a new preset in world-draft.ts
// shows up here without an edit. Object.keys() is typed `string[]` because a runtime
// object may carry extra keys; this one is a closed Record literal, so its keys ARE its
// keyof — the assertion states what the table's type already proves.
const HALL_PRESETS = Object.keys(HALL_PRESET_KNOBS) as HallPreset[];

/** Both ends of a candidate attachment are edited as ONE row of fields; which of them the
 *  region's class actually reads (wall+offset, or mouth) is decided at submit. */
type SpotState = { wall: WallName; offset: number; mouth: number };

const spotFor = (algorithm: DraftAlgorithm, s: SpotState): PortalSpot =>
  algorithm === "cave"
    ? { mouth: s.mouth }
    : { wall: s.wall, offset: s.offset };

function SpotFields(props: {
  label: string;
  algorithm: DraftAlgorithm | undefined;
  spot: SpotState;
  setSpot: (s: SpotState) => void;
  busy: boolean;
}) {
  const { label, algorithm, spot, setSpot, busy } = props;
  if (algorithm === "cave") {
    return (
      <Field label={`${label} mouth`}>
        <Input
          type="number"
          value={spot.mouth}
          disabled={busy}
          onChange={(e) =>
            setSpot({ ...spot, mouth: num(e.target.value, spot.mouth) })
          }
        />
      </Field>
    );
  }
  return (
    <>
      <Field label={`${label} wall`}>
        <select
          className={SELECT_CLASS}
          value={spot.wall}
          disabled={busy}
          onChange={(e) =>
            // Boundary cast: a <select>'s value is a plain string; its options are exactly
            // the WallName union, so the DOM's wider type narrows back to it here.
            setSpot({ ...spot, wall: e.target.value as WallName })
          }
        >
          {WALLS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`${label} offset`}>
        <Input
          type="number"
          value={spot.offset}
          disabled={busy}
          onChange={(e) =>
            setSpot({ ...spot, offset: num(e.target.value, spot.offset) })
          }
        />
      </Field>
    </>
  );
}

export function AddRegionForm(props: {
  draft: WorldDraft;
  busy: boolean;
  onAdd: (region: DraftRegion) => void;
}) {
  const { draft, busy, onAdd } = props;
  const [algorithm, setAlgorithm] = useState<DraftAlgorithm>("hall");
  const [preset, setPreset] = useState<HallPreset>("pillarHall");
  const [parentId, setParentId] = useState("");
  const [kind, setKind] = useState<ConnectorKindDraft | "">("");
  const [parentSpot, setParentSpot] = useState<SpotState>({
    wall: "north",
    offset: 2,
    mouth: 0,
  });
  const [childSpot, setChildSpot] = useState<SpotState>({
    wall: "south",
    offset: 2,
    mouth: 0,
  });
  const [corridor, setCorridor] = useState({ length: 6, deltaY: 0 });
  // addRegion is setup-loud (e.g. "corridor cannot join hall -> cave"). The form disables
  // the illegal choices it knows about, but anything that slips through must SAY so —
  // never a silently dropped click.
  const [error, setError] = useState("");

  const first = draft.regions.length === 0;
  // The selected parent, FALLING BACK to the first region: `parentId` is form-local state
  // that outlives the draft, so removing the selected parent would otherwise strand the
  // form (blank select, no legal kinds, Add disabled with no stated reason). Same
  // resolve-or-fall-back shape as `effectiveKind` below; `submit` reads `parent.id`, so
  // what is displayed and what is submitted can never disagree.
  const parent =
    draft.regions.find((r) => r.id === parentId) ?? draft.regions[0];
  const kinds = parent ? legalKinds(parent.algorithm, algorithm) : [];
  const effectiveKind = kind !== "" && kinds.includes(kind) ? kind : kinds[0];

  // Each region OWNS its knobs: a fresh deep copy of the preset, never the (deep-frozen)
  // table reference — an aliased knob edit would resize every hall in the world.
  const freshRegion = (
    id: string,
    attachment?: DraftAttachment,
  ): DraftRegion => {
    if (algorithm === "hall") {
      return {
        id,
        algorithm: "hall",
        knobs: structuredClone(HALL_PRESET_KNOBS[preset]),
        seed: id,
        attachment,
      };
    }
    if (algorithm === "maze") {
      return {
        id,
        algorithm: "maze",
        knobs: structuredClone(DEFAULT_KNOBS.maze),
        seed: id,
        attachment,
      };
    }
    return {
      id,
      algorithm: "cave",
      knobs: structuredClone(DEFAULT_KNOBS.cave),
      seed: id,
      attachment,
    };
  };

  const submit = (): void => {
    const id = nextRegionId(draft, algorithm);
    let attachment: DraftAttachment | undefined;
    if (!first) {
      if (!parent || !effectiveKind) return;
      attachment = {
        kind: effectiveKind,
        parentId: parent.id,
        parentPortal: spotFor(parent.algorithm, parentSpot),
        childPortal: spotFor(algorithm, childSpot),
        ...(effectiveKind === "corridor" ? { params: corridor } : {}),
      };
    }
    try {
      onAdd(freshRegion(id, attachment));
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-2">
      <span className="font-medium">Add region</span>
      <div className="flex flex-wrap gap-2">
        <Field label="algorithm">
          <select
            className={SELECT_CLASS}
            value={algorithm}
            disabled={busy}
            // Boundary cast: the options are exactly the DraftAlgorithm union.
            onChange={(e) => setAlgorithm(e.target.value as DraftAlgorithm)}
          >
            <option value="hall">hall</option>
            <option value="maze">maze</option>
            <option value="cave">cave</option>
          </select>
        </Field>
        {algorithm === "hall" && (
          <Field label="preset">
            <select
              className={SELECT_CLASS}
              value={preset}
              disabled={busy}
              // Boundary cast: the options are exactly HALL_PRESET_KNOBS' keys.
              onChange={(e) => setPreset(e.target.value as HallPreset)}
            >
              {HALL_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {!first && (
        <div className="flex flex-wrap gap-2">
          <Field label="attach to">
            <select
              className={SELECT_CLASS}
              value={parent?.id ?? ""}
              disabled={busy}
              onChange={(e) => setParentId(e.target.value)}
            >
              {draft.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="connector">
            <select
              className={SELECT_CLASS}
              value={effectiveKind ?? ""}
              disabled={busy || kinds.length === 0}
              // Boundary cast: the options are exactly the legal kinds for this pair.
              onChange={(e) => setKind(e.target.value as ConnectorKindDraft)}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <SpotFields
            label="parent"
            algorithm={parent?.algorithm}
            spot={parentSpot}
            setSpot={setParentSpot}
            busy={busy}
          />
          <SpotFields
            label="child"
            algorithm={algorithm}
            spot={childSpot}
            setSpot={setChildSpot}
            busy={busy}
          />
          {effectiveKind === "corridor" && (
            <>
              <Field label="length (m)">
                <Input
                  type="number"
                  value={corridor.length}
                  disabled={busy}
                  onChange={(e) =>
                    setCorridor({
                      ...corridor,
                      length: num(e.target.value, corridor.length),
                    })
                  }
                />
              </Field>
              <Field label="rise (m)">
                <Input
                  type="number"
                  step="0.25"
                  value={corridor.deltaY}
                  disabled={busy}
                  onChange={(e) =>
                    setCorridor({
                      ...corridor,
                      deltaY: num(e.target.value, corridor.deltaY),
                    })
                  }
                />
              </Field>
            </>
          )}
        </div>
      )}

      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || (!first && (!parent || kinds.length === 0))}
          onClick={submit}
        >
          Add region
        </Button>
      </div>
      {error !== "" && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

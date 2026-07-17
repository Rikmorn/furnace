// The stamp-session inspector (F2b Task 15): visible while the host holds a
// StampSession. SchemaForm renders the generator's JSON-Schema params; BOTH
// its callbacks funnel into ONE host.updateStamp — the viewport's stamp ghost
// IS the preview (there is no separate commit target until Enter), and the
// host's coalescer collapses drag bursts. Below the form: the hand-editable
// seed + the ⚄ re-roll, the merge-policy select, the phase/opCount/error
// status (+ the truncated-selection warning), and Commit/Cancel — whose
// keyboard twins (Enter/Esc) live on the CANVAS keydown, so the titles say so.
import type { MergePolicy } from "@furnace/core/field"; // type-only: erased
import type {
  FieldGeneratorInfo,
  StampSession,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { SchemaForm } from "../../inspector/index.tsx";
import type { JsonSchemaNode } from "../../inspector/types.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { ReasonTip, SELECT_CLASS } from "../world-panel/fields.tsx";

const LABEL_CLASS = "flex items-center gap-1.5 text-muted-foreground";

const POLICIES: { value: MergePolicy; label: string }[] = [
  { value: "replace", label: "Replace" },
  { value: "keep-existing-air", label: "Keep existing air" },
];

/** Decode the `<select>` value back to a policy. Values come from our own
 *  option set, so anything unrecognised (impossible) falls back to replace. */
const parsePolicy = (v: string): MergePolicy =>
  v === "keep-existing-air" ? v : "replace";

const PHASE_LABEL: Record<StampSession["phase"], string> = {
  configuring: "configuring",
  previewing: "previewing…",
  ready: "ready",
};

export function StampInspector(props: {
  session: StampSession;
  /** The session generator's registry info — its paramSchema feeds the form. */
  def: FieldGeneratorInfo;
  onUpdate: (
    params: Record<string, unknown>,
    seed: number,
    policy: MergePolicy,
  ) => void;
  onReroll: () => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const { session, def, onUpdate } = props;
  const apply = (next: unknown[]): void =>
    // Boundary cast: SchemaForm emits unknown[] drafts; draft 0 is this
    // session's params record (values={[session.params]}).
    onUpdate(next[0] as Record<string, unknown>, session.seed, session.policy);
  const ready = session.phase === "ready";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <p className="text-xs font-semibold">stamp: {def.name}</p>
      <SchemaForm
        // Boundary cast: the host surfaces paramSchema as an opaque plain-data
        // record (it cannot type it — the chrome can't value-import core); it
        // IS the generator's JSON-Schema object node, which is exactly
        // SchemaForm's structural input.
        schema={def.paramSchema as JsonSchemaNode}
        values={[session.params]}
        onPreview={apply}
        onCommit={apply}
        onCancel={() => {
          /* nothing to revert — the ghost already shows the last applied params */
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        {/* The ⚄ sits OUTSIDE the label: a button nested in a label would also
            forward its clicks to the seed input (label activation). */}
        <span className="flex items-center gap-1.5">
          <label className={LABEL_CLASS}>
            seed
            <Input
              type="number"
              min={0}
              step={1}
              value={session.seed}
              onChange={(e) => {
                // An empty field is MID-EDIT, not a commit: Number("") is 0,
                // so without this guard clearing the field would stamp seed 0
                // (the hollow blur-clamp philosophy — never fight typing;
                // the settled value is what matters).
                if (e.target.value === "") return;
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 0)
                  onUpdate(session.params, n, session.policy);
              }}
              onBlur={(e) => {
                // Settled-display re-sync (the hollow blur-clamp pattern): a
                // cleared/rejected value never commits, so the DOM can end up
                // diverged from session.seed — snap it back once typing settles.
                e.target.value = String(session.seed);
              }}
              aria-label="stamp seed"
              className="h-8 w-20"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            title="re-roll the seed"
            aria-label="re-roll seed"
            onClick={props.onReroll}
          >
            ⚄
          </Button>
        </span>
        <label className={LABEL_CLASS}>
          merge
          <select
            value={session.policy}
            onChange={(e) =>
              onUpdate(session.params, session.seed, parsePolicy(e.target.value))
            }
            aria-label="merge policy"
            className={SELECT_CLASS}
          >
            {POLICIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {PHASE_LABEL[session.phase]}
        {session.opCount !== null && (
          <span className="tabular-nums"> · {session.opCount} ops</span>
        )}
      </p>
      {session.error !== null && (
        // role="alert": a failed evaluate must reach screen readers — the
        // ghost silently vanishing is the only other signal.
        <p role="alert" className="text-xs text-destructive">
          {session.error}
        </p>
      )}
      {session.truncatedSelection && (
        <p className="text-xs text-warning">
          the selection flood hit its budget — the stamp region under-covers it
        </p>
      )}
      <div className="flex items-center gap-2">
        {/* ReasonTip, not a bare title: a disabled Button's pointer-events-none
            would swallow the tooltip explaining the ready gate. */}
        <ReasonTip
          reason={
            ready ? undefined : "the ghost preview must settle before commit"
          }
        >
          <Button
            type="button"
            size="sm"
            disabled={!ready}
            title="commit the stamp (Enter in the viewport)"
            onClick={props.onCommit}
          >
            Commit
          </Button>
        </ReasonTip>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          title="discard the session (Esc in the viewport)"
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

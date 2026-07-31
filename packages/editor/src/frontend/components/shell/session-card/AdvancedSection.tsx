import type { MergePolicy } from "@furnace/core/field"; // type-only: erased
import type { NudgeSteps } from "../../../../viewport-host/index.ts"; // type-only: erased
import { CollapsibleSection } from "../../CollapsibleSection.tsx";
import { SELECT_CLASS } from "../../field/form-bits.tsx";
import { Button } from "../../ui/button.tsx";

const LABEL_CLASS = "flex items-center gap-1.5 text-muted-foreground";

const POLICIES: { value: MergePolicy; label: string }[] = [
	{ value: "replace", label: "Replace" },
	{ value: "keep-existing-air", label: "Keep existing air" },
];

/** Decode the `<select>` value back to a policy. Values come from our own option set, so
 *  anything unrecognised (impossible) falls back to replace. */
const parsePolicy = (v: string): MergePolicy =>
	v === "keep-existing-air" ? v : "replace";

// The placement nudges as axis PAIRS, so the cluster reads as three axes rather than six
// loose buttons. The steps and their key twins mirror `arrowNudgeSteps` (input-map.ts),
// which is the canonical binding — these are its button labels, not a second source.
const NUDGE_AXES: {
	axis: string;
	minus: { steps: NudgeSteps; key: string };
	plus: { steps: NudgeSteps; key: string };
}[] = [
	{
		axis: "X",
		minus: { steps: [-1, 0, 0], key: "←" },
		plus: { steps: [1, 0, 0], key: "→" },
	},
	{
		axis: "Y",
		minus: { steps: [0, -1, 0], key: "⇧↓" },
		plus: { steps: [0, 1, 0], key: "⇧↑" },
	},
	{
		axis: "Z",
		minus: { steps: [0, 0, -1], key: "↑" },
		plus: { steps: [0, 0, 1], key: "↓" },
	},
];

// 24px, below the card's 32px (size="sm") norm: six of these sit in ONE row as a compact
// d-pad, and at 32px they read as six peers of the commit verb rather than one cluster.
const NUDGE_BUTTON_CLASS = "h-6 px-2 font-mono";

/**
 * Whether the disclosure was left open, ACROSS MOUNTS.
 *
 * Module scope rather than component state, because the card does not survive its own
 * palette closing (`PaletteLayer` renders `open ? <Palette> : null`) — so a `useState`
 * here re-collapses on every subject change, and the nudge d-pad behind this disclosure
 * is the only MOUSE route to moving a stamp region. That is a click per session to reach
 * a control the user has already asked for once.
 *
 * NOT persisted to the `UiStore`: this remembers within a page, not across a reload. The
 * store is per-project chrome ARRANGEMENT (where palettes sit, what the view shows), and
 * a disclosure inside one palette is a different weight of fact — adding a key for it
 * would put the smallest piece of UI state in the file the workspace restore reads.
 */
let advancedOpen = false;

/**
 * The session MECHANICS, behind the mock's `▸ advanced`: where the stamp sits and how it
 * merges are not recipe values, and a card that leads with them buries the params the
 * user came for. Collapsed by default — on the FIRST open of a page, not on every one.
 */
export function AdvancedSection({
	policy,
	onPolicy,
	onNudge,
}: {
	policy: MergePolicy;
	onPolicy: (policy: MergePolicy) => void;
	onNudge: (steps: NudgeSteps) => void;
}) {
	return (
		<div className="px-3 py-1">
			<CollapsibleSection
				title="advanced"
				defaultOpen={advancedOpen}
				onOpenChange={(open) => {
					advancedOpen = open;
				}}
			>
				<div className="flex flex-col gap-2 pb-1">
					<label className={LABEL_CLASS}>
						merge
						<select
							value={policy}
							onChange={(e) => onPolicy(parsePolicy(e.target.value))}
							aria-label="merge policy"
							className={`${SELECT_CLASS} h-7`}
						>
							{POLICIES.map((p) => (
								<option key={p.value} value={p.value}>
									{p.label}
								</option>
							))}
						</select>
					</label>
					{/* Placement: the region moves, the params don't — one 0.5 m lattice step
					    per press, both corners, so the size never changes. */}
					{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
					<div
						className="flex flex-wrap items-center gap-2"
						role="group"
						aria-label="nudge the stamp region"
					>
						<span className={LABEL_CLASS}>nudge</span>
						{NUDGE_AXES.map(({ axis, minus, plus }) => (
							<span key={axis} className="flex items-center gap-1">
								<Button
									type="button"
									size="sm"
									variant="secondary"
									className={NUDGE_BUTTON_CLASS}
									title={`move the region 0.5 m along −${axis} (${minus.key} in the viewport)`}
									aria-label={`nudge minus ${axis}`}
									onClick={() => onNudge(minus.steps)}
								>
									−{axis}
								</Button>
								<Button
									type="button"
									size="sm"
									variant="secondary"
									className={NUDGE_BUTTON_CLASS}
									title={`move the region 0.5 m along +${axis} (${plus.key} in the viewport)`}
									aria-label={`nudge plus ${axis}`}
									onClick={() => onNudge(plus.steps)}
								>
									+{axis}
								</Button>
							</span>
						))}
						<span className="text-[10px] text-muted-foreground">
							in the viewport: ←/→ move X, ↑/↓ move Z, ⇧↑/⇧↓ move Y
						</span>
					</div>
				</div>
			</CollapsibleSection>
		</div>
	);
}

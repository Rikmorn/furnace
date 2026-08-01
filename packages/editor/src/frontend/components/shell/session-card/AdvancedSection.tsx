import type { MergePolicy } from "@furnace/core/field"; // type-only: erased
import type { NudgeSteps } from "../../../../viewport-host/index.ts"; // type-only: erased
import { CollapsibleSection } from "../../CollapsibleSection.tsx";
import { ActionTip, SELECT_CLASS } from "../../field/form-bits.tsx";
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
// loose buttons. The steps mirror `arrowNudgeSteps` (input-map.ts), which is the canonical
// binding — these are its buttons, not a second source.
//
// Each pair used to carry its viewport KEY as well, spelled into the button's tooltip.
// F4.5c Task 8 dropped it: the keycap in an `ActionTip` comes off the action registry or
// does not appear (D-12), the arrow nudges are canvas-owned and not in that table, and the
// mapping is already on screen in the legend below the row.
const NUDGE_AXES: {
	axis: string;
	minus: NudgeSteps;
	plus: NudgeSteps;
}[] = [
	{ axis: "X", minus: [-1, 0, 0], plus: [1, 0, 0] },
	{ axis: "Y", minus: [0, -1, 0], plus: [0, 1, 0] },
	{ axis: "Z", minus: [0, 0, -1], plus: [0, 0, 1] },
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
						{/* The tooltip states the STEP and nothing else. The viewport key that
						    does the same nudge used to ride these sentences in prose — it is on
						    screen one row down instead (the legend below), which is where a key
						    the action registry does not carry belongs: `ActionTip` reads a keycap
						    off the registry or renders none, and a hand-spelled one is D-12's
						    duplication problem in a second spelling. */}
						{NUDGE_AXES.map(({ axis, minus, plus }) => (
							<span key={axis} className="flex items-center gap-1">
								<ActionTip hint={`move the region 0.5 m along −${axis}`}>
									<Button
										type="button"
										size="sm"
										variant="secondary"
										className={NUDGE_BUTTON_CLASS}
										aria-label={`nudge minus ${axis}`}
										onClick={() => onNudge(minus)}
									>
										−{axis}
									</Button>
								</ActionTip>
								<ActionTip hint={`move the region 0.5 m along +${axis}`}>
									<Button
										type="button"
										size="sm"
										variant="secondary"
										className={NUDGE_BUTTON_CLASS}
										aria-label={`nudge plus ${axis}`}
										onClick={() => onNudge(plus)}
									>
										+{axis}
									</Button>
								</ActionTip>
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

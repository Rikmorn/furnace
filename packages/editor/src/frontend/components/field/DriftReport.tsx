// The reconfigure drift report (F3a Task 9): the dismissible list of downstream
// ops the last applyReconfigure replayed whose outcome MOVED (`drifted`) or
// VANISHED (`orphaned`). Non-modal and minimal — F4 owns the designed home
// (spec §2.4). Renders ONLY when findings exist (empty → null), so the panel
// mounts it unconditionally and this file owns the "show only on drift" rule.
//
// Each row is a button that frames the finding's chunk bounds (host.frameChunks
// re-centres the fly camera); Dismiss clears the report through the host
// (host.dismissDrift — the report is host state, not the UI's). a11y: the
// Dismiss button and every row carry an accessible name that includes the op id
// and kind, because the visible row text ("op 12 drifted") is the only thing
// distinguishing two findings and a bare "Dismiss" repeats nowhere else but
// still deserves a stable name.
import type { DriftFinding } from "@furnace/core/field"; // type-only: erased
import { Button } from "../ui/button.tsx";
import { ActionTip } from "../ui/tips.tsx";

export function DriftReport(props: {
	findings: DriftFinding[];
	/** Frame a finding's chunk bounds (host.frameChunks). */
	onFrame: (finding: DriftFinding) => void;
	/** Clear the report (host.dismissDrift). */
	onDismiss: () => void;
}) {
	const { findings, onFrame, onDismiss } = props;
	if (findings.length === 0) return null;
	return (
		<div className="flex flex-col gap-1 border-b border-border px-2 py-1.5 text-sm">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-semibold text-foreground">
					Drift ({findings.length})
				</span>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-5 px-1.5 text-xs"
					aria-label="dismiss drift report"
					onClick={onDismiss}
				>
					Dismiss
				</Button>
			</div>
			<ul className="flex flex-col gap-0.5">
				{findings.map((f) => (
					<li key={f.opId}>
						{/* What a click DOES — the row's text is an op id and a kind, which says
						    nothing about it. A tooltip rather than a `title` (D-25) so the
						    keyboard, which can reach every one of these rows, gets it too. */}
						<ActionTip hint="frame this op's chunks in the viewport">
							<button
								type="button"
								aria-label={`frame op ${f.opId} (${f.kind})`}
								onClick={() => onFrame(f)}
								className="w-full rounded px-1 py-0.5 text-left text-xs text-muted-foreground tabular-nums hover:bg-muted/50"
							>
								op {f.opId} {f.kind}
							</button>
						</ActionTip>
					</li>
				))}
			</ul>
		</div>
	);
}

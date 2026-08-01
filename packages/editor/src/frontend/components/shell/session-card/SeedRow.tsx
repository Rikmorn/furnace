import { useId } from "react";
import { Button } from "../../ui/button.tsx";
import { Input } from "../../ui/input.tsx";

/** The card's row-label width, so the seed caption lines up with the ones below it. */
const LABEL_CLASS = "flex items-center gap-1.5 text-muted-foreground";

/**
 * The seed and its re-roll.
 *
 * The CALLER gates this on the generator's `usesSeed` (core's own declaration) — a hall
 * never reads its seed, so a field and a ⚄ for it are two controls that do nothing when
 * pressed. Gating here instead would put that rule one level below the thing that knows
 * which generator is on screen.
 */
export function SeedRow({
	seed,
	onSeed,
	onReroll,
}: {
	seed: number;
	onSeed: (seed: number) => void;
	onReroll: () => void;
}) {
	// `useId` rather than a constant: the card is one mount today, but a constant id is
	// the kind of thing that only breaks once two of something exist.
	const inputId = useId();
	return (
		<div className="flex items-center gap-2 px-3 py-1.5">
			{/* `htmlFor`, not a wrapping <label> and not a suppression. The ⚄ has to stay
			    OUTSIDE the label (a button nested in one forwards its clicks to the input
			    through label activation), which rules out wrapping; and the suppression this
			    replaced carried a justification copied from `StampInspector`, where the label
			    genuinely DID wrap its input — here they were siblings, so the 52 px "seed"
			    target focused nothing and the accessible name came from an `aria-label` no
			    association backed. */}
			<label htmlFor={inputId} className={`${LABEL_CLASS} w-[52px]`}>
				seed
			</label>
			<Input
				type="number"
				min={0}
				step={1}
				value={seed}
				onChange={(e) => {
					// An empty field is MID-EDIT, not a commit: Number("") is 0, so without
					// this guard clearing the field would stamp seed 0.
					if (e.target.value === "") return;
					const n = Number(e.target.value);
					if (Number.isInteger(n) && n >= 0) onSeed(n);
				}}
				onBlur={(e) => {
					// Settled-display re-sync (the hollow blur-clamp pattern): a cleared or
					// rejected value never commits, so the DOM can end up diverged — snap it
					// back once typing settles.
					e.target.value = String(seed);
				}}
				id={inputId}
				className="h-7 w-20 font-mono"
			/>
			{/* A `title` that STAYS, against D-25's sweep, because it is a NAME rather than
			    documentation: ⚄ has no visible label, so this is the only thing that tells a
			    mouse user what the button is — and everyone else already has the aria-label,
			    which says the same words. A tooltip here would document nothing. */}
			<Button
				type="button"
				size="sm"
				variant="secondary"
				className="ml-auto h-7"
				title="re-roll the seed"
				aria-label="re-roll seed"
				onClick={onReroll}
			>
				⚄
			</Button>
		</div>
	);
}

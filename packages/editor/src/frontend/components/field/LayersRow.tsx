// Layer visibility + the slice view (F2b Task 15): six checkboxes drive
// host.setLayers (display-only gates — hiding a layer never affects targeting,
// ops, or bakes) and an enable checkbox + Y slider drive host.setSlice
// (display + targeting, never the field). Pure presentation — the panel owns
// the state and every host call.
import type { FieldLayers } from "../../../viewport-host/index.ts"; // type-only: erased

const LAYERS: { key: keyof FieldLayers; label: string; title: string }[] = [
	{ key: "field", label: "field", title: "the per-class surface meshes" },
	{ key: "kit", label: "kit", title: "the instanced kit pieces" },
	{
		key: "props",
		label: "props",
		title: "placed prop proxies (scatter placements)",
	},
	{ key: "ghost", label: "ghost", title: "brush ghost + stamp hologram" },
	{
		key: "selection",
		label: "selection",
		title: "selection overlay + entity highlight",
	},
	{ key: "grid", label: "grid", title: "the reference grid" },
];

// Slice slider range (world metres): −8 reaches below any v0 dig, +24 clears
// the tallest kit hall; 0.25 m steps match the field's cell size.
const SLICE_MIN_Y = -8;
const SLICE_MAX_Y = 24;
const SLICE_STEP = 0.25;

const LABEL_CLASS = "flex items-center gap-1 text-muted-foreground";

const GHOST_SUPPRESSED_TITLE =
	"brush ghost is hidden while a selection tool is active";

export function LayersRow(props: {
	layers: FieldLayers;
	slice: { enabled: boolean; y: number };
	ghostSuppressed: boolean;
	onLayers: (next: FieldLayers) => void;
	onSlice: (next: { enabled: boolean; y: number }) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-3">
			{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
			<span
				className="flex flex-wrap items-center gap-2 text-muted-foreground"
				role="group"
				aria-label="layer visibility"
			>
				layers
				{LAYERS.map((l) => {
					// The ghost layer gates two host paths: the brush/kit-fill ghost
					// (hidden while a selection tool is armed) AND the stamp hologram
					// (stays live during a stamp session, no selection-mode gate). So the
					// checkbox is only truly inert when a selection tool is armed and no
					// stamp session is active — which is exactly `ghostSuppressed`. Show
					// it disabled then, instead of letting it read as dead. Presentational
					// only; the host still owns the actual suppression.
					const suppressed = l.key === "ghost" && props.ghostSuppressed;
					return (
						<label
							key={l.key}
							title={suppressed ? GHOST_SUPPRESSED_TITLE : l.title}
							className={LABEL_CLASS}
						>
							<input
								type="checkbox"
								checked={props.layers[l.key]}
								disabled={suppressed}
								onChange={(e) =>
									props.onLayers({ ...props.layers, [l.key]: e.target.checked })
								}
							/>
							{l.label}
						</label>
					);
				})}
			</span>
			<label className={LABEL_CLASS}>
				<input
					type="checkbox"
					checked={props.slice.enabled}
					onChange={(e) =>
						props.onSlice({ ...props.slice, enabled: e.target.checked })
					}
					aria-label="slice view"
				/>
				slice
			</label>
			<label className={LABEL_CLASS}>
				y
				<input
					type="range"
					min={SLICE_MIN_Y}
					max={SLICE_MAX_Y}
					step={SLICE_STEP}
					value={props.slice.y}
					disabled={!props.slice.enabled}
					onChange={(e) =>
						props.onSlice({ enabled: true, y: Number(e.target.value) })
					}
					aria-label="slice y"
				/>
				<span className="w-14 tabular-nums">{props.slice.y.toFixed(2)} m</span>
			</label>
		</div>
	);
}

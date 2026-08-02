// The persistent material strip (the MagicaVoxel always-on-palette pattern
// from the F2 tool-UX research): one square per catalog class, its colour as
// the swatch face, the active ring on the tool's materialId — which mirrors
// through subscribeTool, so an Alt-click eyedrop moves the ring too.
//
// It lives in the TOP STRIP since F4.5b Task 8, under paint and fill only —
// `FieldTool.materialId` is "ignored by dig and smooth" (field-host.ts), so the
// permanent strip it used to be was a control that did nothing under half the
// tools.
//
// KIT CLASSES AND PAINT. Paint emits a sphere-shaped op and core rejects
// kit-class writes without a lattice box (assertOpValid), so a kit swatch under
// paint would only manufacture per-stroke errors. That refusal is the
// highest-value explanation on this surface, and it is the one that has to
// survive BEING refused — so the swatch is `aria-disabled` rather than
// `disabled` and carries a real tooltip (D-25) rather than a `title`. A
// `disabled` button takes no pointer events, so a tooltip on one never opens;
// the `title` this replaces reached a mouse and nothing else, and this file's
// own header used to argue for it. That argument predates D-25.
import type { MaterialTable } from "@furnace/core/field"; // type-only: erased
import { cn } from "../../lib/cn.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";

/** A catalog colour ([0,1] rgba) as a CSS color for the swatch face. */
const cssColor = (c: [number, number, number, number]): string =>
	`rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3]})`;

export function MaterialSwatches(props: {
	classes: MaterialTable["classes"];
	/** The tool's current materialId (the active ring). */
	activeId: number;
	/** True while the active brush cannot write kit classes (paint). */
	disableKit: boolean;
	onSelect: (id: number) => void;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row; a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids
		<div
			className="flex flex-wrap items-center gap-1"
			role="group"
			aria-label="brush material"
		>
			{props.classes.map((c) => {
				const refused = props.disableKit && c.kind === "kit";
				const reason = `${c.name} — kit classes can't be painted`;
				return (
					<Tooltip key={c.id}>
						<TooltipTrigger asChild>
							<button
								type="button"
								// The reason rides the accessible NAME as well as the tooltip: a
								// swatch is a 24 px colour square with no text of its own, so the
								// name is the only channel that ever carried it.
								aria-label={
									refused ? `material ${reason}` : `material ${c.name}`
								}
								aria-pressed={c.id === props.activeId}
								aria-disabled={refused || undefined}
								onClick={() => {
									if (!refused) props.onSelect(c.id);
								}}
								className={cn(
									"h-6 w-6 rounded-sm border border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
									// The chrome's ONE dimmed tier (D-23), shared with `ui/`'s disabled
									// controls and the tool rail's refused families.
									refused && "cursor-not-allowed opacity-50",
									// NOT the focus ring, despite the spelling: this fires on
									// `activeId`, so it is the SELECTED marker. The offset is
									// load-bearing here in a way it never is on focus — a swatch's
									// fill is an arbitrary material colour, and a ring drawn flush
									// against a blue-grey one would be swallowed by it. The 1 px of
									// `--background` is what keeps the marker readable on any swatch.
									// Leave it: a sweep that normalises `ring-offset-*` away as a
									// shadcn focus-ring leftover would be removing the wrong thing.
									//
									// `focus-visible:ring-4` is here because the two rings share a CSS
									// property and `:focus-visible` outranks a plain class, so the
									// house `focus-visible:ring-1` above was SHRINKING this 2 px
									// marker to 1 px whenever the selected swatch took focus — focus
									// making its own indicator smaller. Widening rather than
									// narrowing keeps focus additive; tailwind-merge resolves the two
									// `focus-visible:ring-*` at call time (`cn()` runs on every
									// render), last one winning, so the outcome is decided by the
									// argument order here rather than by cascade order.
									c.id === props.activeId &&
										"ring-2 ring-ring ring-offset-1 ring-offset-background focus-visible:ring-4",
								)}
								style={{ backgroundColor: cssColor(c.color) }}
							/>
						</TooltipTrigger>
						<TooltipContent side="bottom">
							{refused ? reason : c.name}
						</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}

import { projectAxisTriad } from "../lib/axis-triad.ts";

// Semantic axis colours — X red, Y green, Z blue — matching the viewport translate gizmo.
// These hexes are the SOURCE of the host's `AXIS_COLOR`, which is the same three in
// LINEAR sRGB because shaders write linear and the GPU encodes on output. Change one
// and convert for the other (`docs/reference/engine-conventions.md`, colour).
const AXIS_COLOR: Record<"x" | "y" | "z", string> = {
	x: "#e5484d",
	y: "#46a758",
	z: "#5b8def",
};

const SIZE = 64;
const CENTER = SIZE / 2;
const RADIUS = 22; // axis line length from centre
const CAP = 7; // labelled +axis end-cap radius
const NEG_CAP = 5; // the −axis cap: smaller and unlabelled, the way a ViewCube reads
// Hit targets, wider than the caps they cover. Still under the 24 px WCAG 2.2 SC 2.5.8
// minimum, and unavoidably so at this size — six tips share a 64 px box. Filed with the
// options (grow it, or make the six views reachable another way and let these be a
// redundant affordance): `docs/backlog/editor-and-tooling/field-f4-gate-ux-findings.md` §3.
const HIT = 18;
const NEG_HIT = 14;

/** One clickable end of one axis. The −axis tips are the +axis projection negated —
 *  `projectAxisTriad` returns three, and six views come out of them for free. */
type Tip = {
	axis: "x" | "y" | "z";
	sign: 1 | -1;
	x: number;
	y: number;
	depth: number;
};

/**
 * Corner orientation gizmo: projects the three world axes from the viewport orbit
 * camera's `yaw`/`pitch`, draws them as a small labelled triad, and puts a button on
 * each of the six axis ends that SNAPS the view to it. The projection math lives in
 * `lib/axis-triad.ts`; `onSnap` is the only thing this does.
 *
 * `sign: 1` means "put the eye on the POSITIVE side of this axis" — the labelled,
 * filled tip; the hollow tip opposite it is the negative side. The DRAWING is sorted
 * far-to-near so the tips pointing toward the viewer paint on top; the BUTTONS are
 * emitted in a FIXED order (that is the tab order) and resolve the same overlap with
 * `zIndex` instead.
 *
 * The drawing is an `<svg role="img">` and the controls are real `<button>`s over it,
 * rather than `role="button"` inside the SVG: buttons get focus, keyboard activation
 * and a focus ring for free, and an SVG cannot contain one. Both come from the SAME
 * `tips` array, so the cap and the thing you click cannot drift apart.
 *
 * The buttons position themselves against the NEAREST positioned ancestor, which is
 * this component's own wrapper — the mount's absolute box holds that wrapper and
 * nothing else, so the triad still takes exactly its 64 px out of the corner.
 */
export function AxisTriad({
	yaw,
	pitch,
	onSnap,
}: {
	yaw: number;
	pitch: number;
	onSnap: (axis: "x" | "y" | "z", sign: 1 | -1) => void;
}) {
	// FIXED order (x+, x−, y+, y−, z+, z−). It is what the buttons are emitted in,
	// and therefore the tab order: sorting them by depth would reshuffle focus
	// order on every camera move, handing a keyboard user a list that reorders
	// under them. Overlap near the centre is resolved by `zIndex` instead.
	const tips: Tip[] = projectAxisTriad(yaw, pitch).flatMap((a): Tip[] => [
		{ axis: a.axis, sign: 1, x: a.x, y: a.y, depth: a.depth },
		{ axis: a.axis, sign: -1, x: -a.x, y: -a.y, depth: -a.depth },
	]);
	// The DRAWING is depth-sorted, far first, so near caps paint over far ones.
	const painted = [...tips].sort((a, b) => b.depth - a.depth);
	const at = (tip: Tip): { x: number; y: number } => ({
		x: CENTER + tip.x * RADIUS,
		y: CENTER + tip.y * RADIUS,
	});
	return (
		<div className="relative" style={{ width: SIZE, height: SIZE }}>
			<svg
				width={SIZE}
				height={SIZE}
				viewBox={`0 0 ${SIZE} ${SIZE}`}
				role="img"
				aria-label="camera orientation axes"
			>
				{painted.map((tip) => {
					const { x: ex, y: ey } = at(tip);
					const color = AXIS_COLOR[tip.axis];
					const positive = tip.sign === 1;
					return (
						<g key={`${tip.axis}${tip.sign}`}>
							{/* The line belongs to the +axis tip so it depth-sorts with it. */}
							{positive && (
								<line
									x1={CENTER}
									y1={CENTER}
									x2={ex}
									y2={ey}
									stroke={color}
									strokeWidth={2}
									strokeLinecap="round"
								/>
							)}
							<circle
								cx={ex}
								cy={ey}
								r={positive ? CAP : NEG_CAP}
								fill={color}
								fillOpacity={positive ? 1 : 0.3}
								stroke={color}
								strokeWidth={positive ? 0 : 1.5}
							/>
							{positive && (
								<text
									x={ex}
									y={ey}
									textAnchor="middle"
									dominantBaseline="central"
									fontSize={9}
									fontFamily="monospace"
									fontWeight="bold"
									fill="#fff"
								>
									{tip.axis.toUpperCase()}
								</text>
							)}
						</g>
					);
				})}
			</svg>
			{tips.map((tip) => {
				const { x: ex, y: ey } = at(tip);
				const size = tip.sign === 1 ? HIT : NEG_HIT;
				const label = `View from ${tip.sign === 1 ? "+" : "-"}${tip.axis.toUpperCase()}`;
				return (
					<button
						key={`${tip.axis}${tip.sign}`}
						type="button"
						// The MOUNT is pointer-events-none so the overlay never eats an orbit
						// drag; these six re-enable it for their own caps and nothing else.
						//
						// `cursor-pointer` is not decoration here: Tailwind v4 dropped v3's
						// Preflight `cursor: pointer` on buttons, and unlike every other
						// control in the editor this one has no visible box of its own — the
						// cursor and the hover ring ARE the discovery channel. The `title`
						// doubles as an orientation cue, naming the destination before a
						// snap that arrives as a cut.
						className="pointer-events-auto absolute cursor-pointer rounded-full outline-none ring-ring hover:ring-1 focus-visible:ring-1"
						style={{
							left: ex - size / 2,
							top: ey - size / 2,
							width: size,
							height: size,
							// Near tips win an overlap near the centre — the same order the
							// SVG paints in, without disturbing the fixed tab order above.
							// Offset to stay non-negative: a negative z-index would drop the
							// button behind the drawing it sits on.
							zIndex: Math.round((1 - tip.depth) * 100),
						}}
						aria-label={label}
						title={label}
						// A tip is a MOMENTARY command, not a surface anyone navigates into,
						// and the canvas owns every viewport key (W/A/S/D, F, [ / ], ⌘Z) plus
						// a `blur` that CANCELS a live move. Letting a click move focus here
						// would silently disarm the viewport — and lose a `G` grab for a user
						// who clicked a tip to see what they were doing. Suppressing the
						// default on the press keeps Tab-focus and Enter/Space activation
						// intact (the standard toolbar pattern). Left button only, so a
						// right-press is left alone.
						onPointerDown={(e) => {
							if (e.button === 0) e.preventDefault();
						}}
						// The canvas suppresses the context menu, but these buttons are NOT
						// canvas descendants — without this a right-press on a tip opens the
						// browser menu over the viewport, in exactly the corner the camera is
						// flicked in.
						onContextMenu={(e) => e.preventDefault()}
						onClick={() => onSnap(tip.axis, tip.sign)}
					/>
				);
			})}
		</div>
	);
}

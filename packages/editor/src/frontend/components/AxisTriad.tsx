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
// Hit targets, wider than the caps they cover. Still small — six of them share a 64px
// box, so there is no arrangement in which they reach the 24px WCAG target size.
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
 * filled tip; the hollow tip opposite it is the negative side. Tips are drawn
 * far-to-near so the ones pointing toward the viewer sit on top, and the BUTTONS are
 * emitted in the same order so an overlap near the centre resolves to the near tip too.
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
	const tips: Tip[] = projectAxisTriad(yaw, pitch)
		.flatMap((a): Tip[] => [
			{ axis: a.axis, sign: 1, x: a.x, y: a.y, depth: a.depth },
			{ axis: a.axis, sign: -1, x: -a.x, y: -a.y, depth: -a.depth },
		])
		.sort((a, b) => b.depth - a.depth);
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
				{tips.map((tip) => {
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
				return (
					<button
						key={`${tip.axis}${tip.sign}`}
						type="button"
						// The MOUNT is pointer-events-none so the overlay never eats an orbit
						// drag; these six re-enable it for their own caps and nothing else.
						className="pointer-events-auto absolute rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
						style={{
							left: ex - size / 2,
							top: ey - size / 2,
							width: size,
							height: size,
						}}
						aria-label={`View from ${tip.sign === 1 ? "+" : "-"}${tip.axis.toUpperCase()}`}
						onClick={() => onSnap(tip.axis, tip.sign)}
					/>
				);
			})}
		</div>
	);
}

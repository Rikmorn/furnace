import { projectAxisTriad } from "../lib/axis-triad.ts";

// Semantic axis colours — X red, Y green, Z blue — matching the viewport translate gizmo.
const AXIS_COLOR: Record<"x" | "y" | "z", string> = {
	x: "#e5484d",
	y: "#46a758",
	z: "#5b8def",
};

const SIZE = 64;
const CENTER = SIZE / 2;
const RADIUS = 22; // axis line length from centre
const CAP = 7; // labelled end-cap radius

/**
 * Corner orientation gizmo: projects the three world axes from the viewport orbit
 * camera's `yaw`/`pitch` and draws them as a small labelled triad. Pure presentational —
 * the projection math lives in `lib/axis-triad.ts`. Axes are drawn far-to-near so the ones
 * pointing toward the viewer sit on top.
 */
export function AxisTriad({ yaw, pitch }: { yaw: number; pitch: number }) {
	const axes = [...projectAxisTriad(yaw, pitch)].sort(
		(a, b) => b.depth - a.depth,
	);
	return (
		<svg
			width={SIZE}
			height={SIZE}
			viewBox={`0 0 ${SIZE} ${SIZE}`}
			role="img"
			aria-label="camera orientation axes"
		>
			{axes.map((a) => {
				const ex = CENTER + a.x * RADIUS;
				const ey = CENTER + a.y * RADIUS;
				const color = AXIS_COLOR[a.axis];
				return (
					<g key={a.axis}>
						<line
							x1={CENTER}
							y1={CENTER}
							x2={ex}
							y2={ey}
							stroke={color}
							strokeWidth={2}
							strokeLinecap="round"
						/>
						<circle cx={ex} cy={ey} r={CAP} fill={color} />
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
							{a.axis.toUpperCase()}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

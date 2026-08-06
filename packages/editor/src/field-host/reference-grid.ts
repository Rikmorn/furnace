// The y=0 reference grid the editor viewport draws so an opened scene reads as a
// grounded space rather than pure black. Pure geometry — no GPU, no engine handles —
// so the line counts / bucketing are unit-testable without a device.

/** A world-space point `[x, y, z]`. */
type Point = [number, number, number];

/** A line segment: exactly two world-space endpoints. */
type Segment = [Point, Point];

/** The grid split into two batches so the host can draw majors slightly brighter than
 *  minors (a cheap two-tone depth cue; a true distance fade is deferred polish). */
export type GridLines = {
  minorSegments: Segment[];
  majorSegments: Segment[];
};

/**
 * Line-segment vertices for a `y=0` reference grid: minor lines every `minor` metres,
 * major lines every `major` metres, extent `±extent`. Each grid coordinate `k` emits two
 * lines (one along Z at `x=k`, one along X at `z=k`); a line whose coordinate is a multiple
 * of `major` goes in `majorSegments`, the rest in `minorSegments`. Pure — testable without
 * a GPU.
 *
 * @param extent - Half-extent of the grid in metres (lines span `-extent..extent`).
 * @param minor - Spacing between minor lines in metres.
 * @param major - Every `major`-th line is a major line.
 */
export function buildGridLines(extent = 50, minor = 1, major = 10): GridLines {
  const minorSegments: Segment[] = [];
  const majorSegments: Segment[] = [];
  for (let k = -extent; k <= extent; k += minor) {
    const bucket = k % major === 0 ? majorSegments : minorSegments;
    bucket.push([
      [k, 0, -extent],
      [k, 0, extent],
    ]); // line along Z at x=k
    bucket.push([
      [-extent, 0, k],
      [extent, 0, k],
    ]); // line along X at z=k
  }
  return { minorSegments, majorSegments };
}

/**
 * Flatten line segments into a `frame.drawLines` batch: a flat position `Float32Array`
 * (two points × three floats per segment) plus a matching solid-RGBA colour array (one
 * `rgba` per vertex). Mirrors {@link boxEdges} so the host draws the grid the same way it
 * draws the AABB highlight.
 *
 * @param segments - Line segments (each a pair of world-space points).
 * @param rgba - Solid colour applied to every vertex, `[r, g, b, a]` in `[0, 1]`.
 */
export function segmentsToBatch(
  segments: readonly Segment[],
  rgba: [number, number, number, number],
): { vertices: Float32Array; colors: Float32Array } {
  const vertices = new Float32Array(segments.length * 2 * 3);
  const colors = new Float32Array(segments.length * 2 * 4);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as Segment;
    const [a, b] = seg;
    vertices.set(a, i * 6);
    vertices.set(b, i * 6 + 3);
    colors.set(rgba, i * 8);
    colors.set(rgba, i * 8 + 4);
  }
  return { vertices, colors };
}

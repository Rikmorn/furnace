/** Project `v` onto the plane with unit normal `n` (Quake PM_ClipVelocity):
 *  `v - n·(v·n)`. Removes the component of `v` heading into the surface,
 *  preserving the tangential slide. Pure; unit-tested. */
export function clipVelocity(
  v: [number, number, number],
  n: [number, number, number],
): [number, number, number] {
  const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
}

/** A surface is walkable if its (unit) normal's Y is at least `limitCos`
 *  (= cos of the max climbable slope angle). Pure; unit-tested. */
export function isWalkable(
  normal: [number, number, number],
  limitCos: number,
): boolean {
  return normal[1] >= limitCos;
}

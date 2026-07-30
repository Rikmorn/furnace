/** An unknown thrown value as a display string. Lives here rather than beside the form
 *  leaves it started with: `lib/world-actions.ts` needs it too, and a lib module must
 *  not import a component file to get one. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long ago `at` was, coarsely: `"just now"`, `"5m ago"`, `"2h ago"`, `"3d ago"`.
 * Both instants are arguments — no `Date.now()` inside — so a list renders every row
 * against ONE instant and a test can pin every boundary without a clock. A future
 * timestamp (a clock that moved backwards) reads as `"just now"` rather than negative.
 */
export function relTime(at: number, now: number): string {
  const ago = Math.max(0, now - at);
  if (ago < MINUTE_MS) return "just now";
  if (ago < HOUR_MS) return `${Math.floor(ago / MINUTE_MS)}m ago`;
  if (ago < DAY_MS) return `${Math.floor(ago / HOUR_MS)}h ago`;
  return `${Math.floor(ago / DAY_MS)}d ago`;
}

/**
 * Turn a schema/component key into a human-readable label: split camelCase,
 * snake_case, and kebab-case into words and Title-Case each one.
 * `"castShadow"` → `"Cast Shadow"`, `"target_rooms"` → `"Target Rooms"`,
 * `"world name"` → `"World Name"`. Already-spaced input is title-cased word by word.
 * Category-standard for a 3D-editor inspector (Unity/Unreal/Blender all Title-Case
 * their property labels).
 */
export function humanizeLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

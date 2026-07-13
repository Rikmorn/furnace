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

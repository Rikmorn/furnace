// packages/dungeon/scripts/bake-default-world.ts
// Bake the committed default WORLD fixture (Epic 3 W1): the two-cave-plus-tunnel
// DEFAULT_WORLD → the tracked `worlds/default/` file set the game boots at runtime.
// `bakeWorld` is PURE + DETERMINISTIC (no timestamp), so re-running this writes
// byte-identical files — a `git status` diff after a re-bake is a determinism bug.
// Run (from packages/dungeon): bun scripts/bake-default-world.ts
import { join } from "node:path";
import { bakeWorld } from "../src/bake.ts";
import { DEFAULT_WORLD } from "../src/world-spec.ts";

// BakeFile.path is package-root-relative (e.g. "worlds/default/world.scene.json").
// Resolve against the package root derived from this file's location so the script
// writes correctly regardless of the caller's cwd.
const PACKAGE_ROOT = join(import.meta.dir, "..");

const files = bakeWorld(DEFAULT_WORLD);
for (const file of files) {
  await Bun.write(join(PACKAGE_ROOT, file.path), file.contents);
}

console.log(`baked default world → ${files.length} file(s):`);
for (const file of files) console.log(`  ${file.path}`);

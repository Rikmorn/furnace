// packages/editor/src/daemon/worlds.ts — worlds-directory enumeration + classification.
// Node-portable (node:fs only — no-bun-leakage test enforces this).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** ONE source of truth for a world directory name. Kept textually identical to
 *  the other 4 copies — frontend `lib/generation.ts`'s `isValidWorldName`,
 *  frontend `field/FieldToolbar.tsx`'s `NAME_RE`, `handlers.ts`'s `field.load`
 *  input schema, and `packages/dungeon/src/bake.ts`'s `WORLD_NAME_RE` — grep
 *  all copies before changing this pattern. */
export const WORLD_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export type WorldRow = {
  name: string;
  kind: "field" | "legacy";
  isDefault: boolean;
  /** true = not gitignored per `git check-ignore` (would be committed as-is);
   *  false = gitignored (disposable scratch); null when no tracked-checker
   *  capability is available (no git repo) OR the checker gave an
   *  indeterminate answer for this path. */
  tracked: boolean | null;
  manifestMtimeMs: number;
};

/** Parse worlds/index.json. Corrupt JSON degrades to null (no default; rows
 *  still enumerate) rather than failing loud — unlike furnace.config.json,
 *  this file is derived output the daemon itself rewrites on every
 *  make-default, so a torn write mid-crash is an expected failure mode, not
 *  a setup error, and must not block listing the worlds that DO parse. */
export function readWorldsIndex(
  root: string,
): { version: number; default: string } | null {
  const p = join(root, "worlds", "index.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as {
      version: number;
      default: string;
    };
  } catch {
    return null;
  }
}

/** Byte-identical to the client's historical writer (generation.ts:78) — pinned by test. */
export function worldsIndexBytes(defaultName: string): string {
  return `${JSON.stringify({ version: 1, default: defaultName }, null, 2)}\n`;
}

export function listWorlds(
  root: string,
  isTracked: ((rel: string) => boolean | null) | undefined,
): { defaultName: string | null; worlds: WorldRow[] } {
  const dir = join(root, "worlds");
  if (!existsSync(dir)) return { defaultName: null, worlds: [] };
  const index = readWorldsIndex(root);
  const worlds: WorldRow[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !WORLD_NAME_RE.test(entry.name)) continue;
    const manifest = join(dir, entry.name, "manifest.json");
    if (!existsSync(manifest)) continue; // not a world (crash-safety: manifest-last)
    const kind = existsSync(join(dir, entry.name, "oplog.json"))
      ? "field"
      : "legacy";
    worlds.push({
      name: entry.name,
      kind,
      isDefault: index?.default === entry.name,
      tracked: isTracked ? isTracked(join("worlds", entry.name)) : null,
      manifestMtimeMs: statSync(manifest).mtimeMs,
    });
  }
  worlds.sort((a, b) => a.name.localeCompare(b.name));
  return { defaultName: index?.default ?? null, worlds };
}

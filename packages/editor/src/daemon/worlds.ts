// packages/editor/src/daemon/worlds.ts — worlds-directory enumeration + classification.
// Node-portable (node:fs only — no-bun-leakage test enforces this).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** ONE source of truth — the four scattered copies retire against this. */
export const WORLD_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export type WorldRow = {
  name: string;
  kind: "field" | "legacy";
  isDefault: boolean;
  /** null when no tracked-checker capability is available (git absent). */
  tracked: boolean | null;
  manifestMtimeMs: number;
};

export function readWorldsIndex(
  root: string,
): { version: number; default: string } | null {
  const p = join(root, "worlds", "index.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as {
    version: number;
    default: string;
  };
}

/** Byte-identical to the client's historical writer (generation.ts:78) — pinned by test. */
export function worldsIndexBytes(defaultName: string): string {
  return `${JSON.stringify({ version: 1, default: defaultName }, null, 2)}\n`;
}

export function listWorlds(
  root: string,
  isTracked: ((rel: string) => boolean) | undefined,
): { defaultName: string | null; worlds: WorldRow[] } {
  const dir = join(root, "worlds");
  const index = readWorldsIndex(root);
  if (!existsSync(dir)) return { defaultName: null, worlds: [] };
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

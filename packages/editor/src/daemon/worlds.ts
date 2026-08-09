// packages/editor/src/daemon/worlds.ts — worlds-directory enumeration + classification.
// Node-portable (node:fs only — no-bun-leakage test enforces this).
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** ONE source of truth for a world directory name. Kept textually identical to
 *  the ONE other copy — frontend `lib/generation.ts`'s `isValidWorldName` (the
 *  frontend's only copy, now that the field toolbar's is gone) — grep it before
 *  changing this pattern; the third copy, `packages/dungeon/src/bake.ts`'s, died
 *  with that file at foundations T2. (TWO daemon modules import this constant directly
 *  and build a zod schema on it: `handlers.ts`'s `worldName`, used by `field.load` and
 *  every `world.*` verb, and `session-handlers.ts`'s `claimedWorld`, which is the same
 *  schema made nullable for the untitled session. Two schemas, one regex — neither is a
 *  copy of the pattern, which is what this comment tracks.) */
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

/** Byte-identical to the client's historical writer (generation.ts) — pinned by test. */
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

/** A single world's directory, given a name already known to satisfy
 *  `WORLD_NAME_RE` — shared by every mutation below and by the handlers.ts
 *  callers that pre-check existence/collisions before invoking one. */
export function worldDir(root: string, name: string): string {
  return join(root, "worlds", name);
}

// The four mutation primitives below are dumb fs wrappers only — no
// EditorError, no validation, no existence/collision checks. handlers.ts owns
// all of that (refusal codes, messages, event emission) so this module stays
// framework-free, mirroring how listWorlds above never raises EditorError —
// it (and these primitives) only ever throw raw fs errors (e.g. EACCES).

/** Delete a world directory (and everything under it). Idempotent: deleting
 *  an already-absent dir is a no-op (`force: true`), same as `rm -rf`. */
export function deleteWorld(root: string, name: string): void {
  rmSync(worldDir(root, name), { recursive: true, force: true });
}

/** Move a world directory to a new name. Caller must have already confirmed
 *  the source exists and the target does not. */
export function renameWorldDir(root: string, from: string, to: string): void {
  renameSync(worldDir(root, from), worldDir(root, to));
}

/** Recursively copy a world directory to a new name. Caller must have
 *  already confirmed the source exists and the target does not. */
export function duplicateWorldDir(
  root: string,
  from: string,
  to: string,
): void {
  cpSync(worldDir(root, from), worldDir(root, to), { recursive: true });
}

/** Rewrite worlds/index.json to name `name` as the default world, via
 *  `worldsIndexBytes`. The frontend's `generation.ts` hand-rolls the same
 *  bytes for its own index write (it can't import node:fs code) — the
 *  byte-pin test on `worldsIndexBytes` is what keeps the two writers
 *  identical, not a shared implementation. */
export function writeDefaultWorld(root: string, name: string): void {
  writeFileSync(join(root, "worlds", "index.json"), worldsIndexBytes(name));
}

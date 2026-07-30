// The bake-upload marshalling world-actions.ts (and useWorld) drives: pure helpers that turn
// a browser-produced file set into the daemon's `generation.bake` wire shape and decide the
// call sequence. NO document-session contact — the ONLY daemon crossing is the api call the
// caller makes with what these return. Everything here is pure and unit-tested without a DOM.

/** UI-boundary mirror of bake.ts's WORLD_NAME_RE — refuse before burning a bake. The
 *  frontend's ONLY copy: every name field validates through this one call. */
export function isValidWorldName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(name);
}

/** The same rule in human words, for the helper text beside every field that takes a
 *  world name (D-21). Lives next to the regex so the two are edited together — a rule
 *  stated where it cannot be seen from the code that enforces it is a rule that drifts. */
export const WORLD_NAME_RULE =
  "letters, digits, - and _ — starting with a letter or digit";

/** The daemon upload sequence for a world bake (D-W3-9): the world's own file set,
 *  cleanDir'd to its directory (a re-bake never leaves orphans) — then, when the user
 *  asked to make it the game's world, ONE more root-contained write of
 *  worlds/index.json with NO cleanDir (it lives outside the world dir, and the daemon
 *  validates every file against cleanDir when one is set). Pure — the caller executes the
 *  calls in order. */
export function bakeUploadCalls(
  files: WireFile[],
  worldDirPath: string,
  worldName: string,
  makeDefault: boolean,
): { files: WireFile[]; cleanDir?: string }[] {
  const calls: { files: WireFile[]; cleanDir?: string }[] = [
    { files, cleanDir: worldDirPath },
  ];
  if (makeDefault) {
    calls.push({
      files: [
        {
          path: "worlds/index.json",
          encoding: "utf8",
          // Byte-identical to the committed packages/dungeon/worlds/index.json (2-space
          // JSON + trailing newline), so re-defaulting "default" is a no-op diff.
          contents: `${JSON.stringify({ version: 1, default: worldName }, null, 2)}\n`,
        },
      ],
    });
  }
  return calls;
}

/** FALLBACK bake transport: one file for the JSON POST — text verbatim, binary base64'd. */
export type WireFile = {
  path: string;
  encoding: "utf8" | "base64";
  contents: string;
};

/**
 * Marshal the browser-produced bake file set (BakeFile[] — contents string|Uint8Array)
 * into the daemon's `generation.bake` wire shape: text files pass through as `utf8`;
 * binary sidecars (`.fmesh`) are base64-encoded for the JSON POST (the daemon decodes).
 */
export function toWireFiles(
  files: { path: string; contents: string | Uint8Array }[],
): WireFile[] {
  return files.map((f) =>
    typeof f.contents === "string"
      ? { path: f.path, encoding: "utf8", contents: f.contents }
      : {
          path: f.path,
          encoding: "base64",
          contents: bytesToBase64(f.contents),
        },
  );
}

// Chunked so a large sidecar can't blow the argument stack on String.fromCharCode(...).
const BASE64_CHUNK = 0x8000;
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

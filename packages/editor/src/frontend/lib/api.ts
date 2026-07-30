// packages/editor/src/frontend/lib/api.ts

/** A daemon command failure: the contract `code` plus the human message. */
export class ApiClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
  }
}

type ErrorBody = { error?: { code?: string; message?: string } };

async function call<T>(command: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  // Boundary cast: the daemon's JSON response is `any` from fetch; we trust the
  // command's documented response shape T (server-validated) and probe `error`.
  const body = (await res.json()) as T & ErrorBody;
  if (!res.ok) {
    throw new ApiClientError(
      body.error?.code ?? "internal",
      body.error?.message ?? `api ${command} failed (${res.status})`,
    );
  }
  return body;
}

/** One row of `world.list`, re-declared STRUCTURALLY: the chrome cannot import daemon
 *  types (the daemon is Node-portable and lives outside the frontend's graph), so this
 *  mirrors `daemon/worlds.ts`'s `WorldRow` by hand. Grep both when either changes.
 *
 *  `tracked` is a TRI-state and the third case is load-bearing: `true` = the world would
 *  be committed as-is (`git check-ignore` says no), `false` = gitignored scratch, `null`
 *  = the daemon had no tracked-checker (no git repo) or got an indeterminate answer. */
export type WorldRow = {
  name: string;
  /** `field` = a v2 world with an oplog (the only kind `field.load` can read);
   *  `legacy` = a v1 world directory with a manifest but no oplog. */
  kind: "field" | "legacy";
  isDefault: boolean;
  tracked: boolean | null;
  manifestMtimeMs: number;
};

// The daemon still serves the whole scene.* command family (daemon/scenes.ts +
// daemon/session.ts) — this client just no longer speaks it: the editor is field-only,
// and the scene chrome that drove those commands is gone. The daemon layer stays for a
// future consumer surface.
export const api = {
  // The project root the daemon serves — used to key per-project UI persistence.
  projectGet: () => call<{ root: string }>("project.get", {}),
  // FALLBACK bake transport (Pr-2 determinism probe failed → the browser bakes and
  // uploads the file set; the daemon validates root-containment, writes, and emits
  // `generation-baked`). `contents` is text verbatim (utf8) or base64 (binary sidecars).
  generationBake: (
    files: { path: string; encoding: "utf8" | "base64"; contents: string }[],
    cleanDir?: string,
  ) =>
    call<{ files: number }>("generation.bake", {
      files,
      ...(cleanDir ? { cleanDir } : {}),
    }),
  // Read a saved field world (F1/F2): the daemon returns the v2 manifest, every
  // chunk's density bytes base64-encoded, the per-chunk material siblings (also
  // base64; empty for a rock-only world), and the oplog JSON (null when absent).
  // The Field panel decodes both and hands them to FieldHost.loadWorld.
  fieldLoad: (name: string) =>
    call<{
      manifest: unknown;
      chunks: { key: string; data: string }[];
      materials: { key: string; data: string }[];
      oplog: string | null;
    }>("field.load", { name }),

  // The world verbs (D-22). Every mutator is name-gated by the daemon's shared
  // WORLD_NAME_RE schema, emits `worlds-changed` on success, and returns an empty
  // object — the drawer refetches `worldList` off the event rather than patching a
  // row from a response, so one refresh path serves the editor's own mutations AND
  // anything that changes worlds/ behind its back.
  worldList: () =>
    call<{ defaultName: string | null; worlds: WorldRow[] }>("world.list", {}),
  worldDelete: (name: string) =>
    call<Record<string, never>>("world.delete", { name }),
  worldRename: (from: string, to: string) =>
    call<Record<string, never>>("world.rename", { from, to }),
  worldDuplicate: (from: string, to: string) =>
    call<Record<string, never>>("world.duplicate", { from, to }),
  worldMakeDefault: (name: string) =>
    call<Record<string, never>>("world.makeDefault", { name }),
};

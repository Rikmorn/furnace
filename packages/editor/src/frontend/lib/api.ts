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
};

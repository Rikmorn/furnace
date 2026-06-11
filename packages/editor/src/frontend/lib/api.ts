// packages/editor/src/frontend/lib/api.ts
import type { SceneDocument } from "@furnace/core/scene";

/** A daemon command failure: the contract `code` plus the human message. */
export class ApiClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
  }
}

export type SessionView = {
  document: SceneDocument;
  path: string;
  revision: number;
  dirty: boolean;
  conflict: boolean;
};

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

export const api = {
  sceneList: () => call<{ scenes: string[] }>("scene.list", {}),
  sceneOpen: (path: string, force = false) =>
    call<SessionView>("scene.open", { path, force }),
  sceneGet: () => call<SessionView>("scene.get", {}),
};

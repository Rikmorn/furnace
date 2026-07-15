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
  canUndo: boolean;
  canRedo: boolean;
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

export type MutationResult = { revision: number; dirty: boolean };
export type ComponentEdit = {
  entity: string;
  component: string;
  params: Record<string, unknown>;
};

export const api = {
  // The project root the daemon serves — used to key per-project UI persistence.
  projectGet: () => call<{ root: string }>("project.get", {}),
  sceneList: () => call<{ scenes: string[] }>("scene.list", {}),
  sceneOpen: (path: string, force = false) =>
    call<SessionView>("scene.open", { path, force }),
  sceneGet: () => call<SessionView>("scene.get", {}),
  setComponent: (
    entity: string,
    component: string,
    params: Record<string, unknown>,
  ) =>
    call<MutationResult>("scene.setComponent", { entity, component, params }),
  setComponentMany: (edits: ComponentEdit[]) =>
    call<MutationResult>("scene.batch", { edits }),
  removeEntity: (id: string) =>
    call<MutationResult>("scene.removeEntity", { id }),
  setResource: (table: string, id: string, entry: Record<string, unknown>) =>
    call<MutationResult>("scene.setResource", { table, id, entry }),
  setSettings: (settings: unknown) =>
    call<MutationResult>("scene.setSettings", { settings }),
  undo: () => call<MutationResult>("scene.undo", {}),
  redo: () => call<MutationResult>("scene.redo", {}),
  save: () => call<MutationResult>("scene.save", {}),
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
  // Read a saved field world (F1): the daemon returns the v2 manifest, every
  // chunk's density bytes base64-encoded, and the oplog JSON (null when absent).
  // The Field panel decodes the chunks and hands them to FieldHost.loadWorld.
  fieldLoad: (name: string) =>
    call<{
      manifest: unknown;
      chunks: { key: string; data: string }[];
      oplog: string | null;
    }>("field.load", { name }),
};

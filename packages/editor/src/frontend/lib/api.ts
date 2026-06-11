import type { SceneDocument } from "@furnace/core/scene";

async function call<T>(command: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  // Boundary cast: the daemon's JSON response is `any` from fetch; we trust the
  // command's documented response shape T (server-validated) and probe `error`.
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok)
    throw new Error(body.error ?? `api ${command} failed (${res.status})`);
  return body;
}

export const api = {
  sceneList: () => call<{ scenes: string[] }>("scene.list", {}),
  sceneRead: (path: string) =>
    call<{ document: SceneDocument }>("scene.read", { path }),
};

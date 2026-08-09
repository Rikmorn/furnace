// packages/editor/src/frontend/lib/api.ts
import type { SessionAnswer } from "../../shared/wire.ts";

/** A daemon command failure: the contract `code` plus the human message.
 *
 *  EXPORTED SINCE FOUNDATIONS T4b, which is the condition the F4.5 seal set for it: it was
 *  private while every catch site in the chrome read `.message` off an `instanceof Error`
 *  narrowing — a sentence to show, not a class to switch on — and the note ended "re-exporting
 *  is one keyword; do it when a call site actually needs the name." `useSessionClaim` is that
 *  call site, and it is not a preference: a refused `session.claim` must raise a STEAL prompt,
 *  and every other failure must raise a toast, so the decision is a branch on `code` and there
 *  is no honest way to take it off a message written for humans to read (T4a's own rule — prose
 *  is free to be reworded, the machine-readable half is not). Still ONE caller: everything else
 *  keeps reading `.message`. */
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

  // The session claim (T4b). `token` is the name the daemon minted for THIS tab's SSE
  // connection and wrote into it as its first frame — `daemon/events.ts` argues at
  // length what that name is and is not for. `name` is the world being authored, or
  // null for the untitled scratch (`WorldState.name`'s own nullable, on the wire).
  sessionClaim: (name: string | null, token: string) =>
    call<Record<string, never>>("session.claim", { name, token }),
  sessionSteal: (name: string | null, token: string) =>
    call<Record<string, never>>("session.steal", { name, token }),
  // `session.release` had no method here until T4c, on the argument that a tab which stops
  // authoring is a tab that closed and the daemon's SSE close hook has already released it.
  // That was true while a claim was taken once per connection. It stopped being true when
  // the claim learnt to RE-KEY on a world switch: a re-claim that is refused leaves this
  // connection still holding the world it just left, and the only way to put that right is
  // to say so. NO `name` — the daemon releases everything the token's connection holds,
  // which is at most one world (`daemon/claims.ts`).
  sessionRelease: (token: string) =>
    call<Record<string, never>>("session.release", { token }),

  // The backchannel's return path (T4b). ONE argument, and it is the wire type itself
  // (`shared/wire.ts`) rather than a pair this function reassembles — the first method here
  // whose body is a shared contract instead of an object literal built to match a schema by
  // eye. Which is the point of the shared type: there is no second spelling to drift.
  //
  // NO TOKEN, unlike its two siblings above, because the `requestId` already names one
  // connection — the daemon minted it into this tab's stream. `session-handlers.ts` argues
  // it where the schema is.
  //
  // `delivered` is the daemon's honest answer to a stale id (an answer that lost the race
  // with its own ask's timeout), not an error. Nothing in the chrome reads it: the answerer
  // is fire-and-forget by design, and the only party that could act on a late answer is the
  // agent that asked, which has already been told.
  sessionAnswer: (answer: SessionAnswer) =>
    call<{ delivered: boolean }>("session.answer", answer),
};

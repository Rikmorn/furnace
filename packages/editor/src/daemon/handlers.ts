import { z } from "zod";
import { listScenes, readScene } from "./scenes.ts";

/** An API error with an HTTP status code attached. */
export class ApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

type Handler = {
  input: z.ZodType;
  run(input: unknown): Promise<unknown>;
};

/** The command registry: name → zod-validated handler. M4 mounts MCP over this same map. */
export type Handlers = Map<string, Handler>;

export type HandlerContext = {
  root: string;
  scenesPattern: string;
};

/** Build the M3 (read-only) command set: scene.list, scene.read. */
export function createHandlers(ctx: HandlerContext): Handlers {
  const handlers: Handlers = new Map();

  handlers.set("scene.list", {
    input: z.strictObject({}),
    run: async () => ({
      scenes: await listScenes(ctx.root, ctx.scenesPattern),
    }),
  });

  handlers.set("scene.read", {
    input: z.strictObject({ path: z.string() }),
    run: async (input) => {
      // Boundary cast: the homogeneous Handler.run(input: unknown) signature erases the
      // per-command schema; dispatch() zod-validated input against this command's
      // z.strictObject({ path: z.string() }) immediately before invoking run.
      const { path } = input as { path: string };
      try {
        return { document: await readScene(ctx.root, path) };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new ApiError(404, detail);
      }
    },
  });

  return handlers;
}

/** Validate input against the command's schema and run it. Throws ApiError on all failures. */
// biome-ignore lint/suspicious/useAwait: async is load-bearing — synchronous throws become rejected promises, matching caller await + .rejects semantics
export async function dispatch(
  handlers: Handlers,
  command: string,
  input: unknown,
): Promise<unknown> {
  const handler = handlers.get(command);
  if (!handler) throw new ApiError(404, `unknown command "${command}"`);
  const parsed = handler.input.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(
      400,
      `invalid input at "${issue?.path.join(".") ?? ""}": ${issue?.message ?? ""}`,
    );
  }
  return handler.run(parsed.data);
}

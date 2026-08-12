// Frontmatter parsing + per-genre schemas for the tracked docs registers.
// Canon for the contracts these encode: docs/reference/docs-system.md §4 and §5.
import { z } from "zod";

/** Flat `key: value` YAML between `---` fences. Our schemas are flat strings — no lists,
 *  no nesting — so a small parser beats a YAML dependency and cannot surprise us. */
export function parseFrontmatter(md: string): Record<string, string> | null {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const i = line.indexOf(": ");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 2).trim();
  }
  return out;
}

const backlogSchema = z
  .object({
    summary: z.string().min(1),
    status: z.enum(["open", "deferred", "superseded"]).optional(),
    "superseded-by": z.string().optional(),
    supersedes: z.string().optional(),
    consumer: z.string().optional(),
  })
  .strict()
  .refine((e) => e.status !== "superseded" || !!e["superseded-by"], {
    message: "status superseded requires superseded-by",
    path: ["superseded-by"],
  });

const sliceSchema = z
  .object({
    status: z.enum(["queued", "next", "in-flight", "blocked-on-owner"]),
    summary: z.string().min(1),
    injected: z.enum(["true"]).optional(),
    after: z.string().optional(),
  })
  .strict();

const epicSchema = z
  .object({
    status: z.enum(["queued", "in-flight"]),
    summary: z.string().min(1),
  })
  .strict();

const issues = (r: z.ZodSafeParseResult<unknown>): string[] =>
  r.success
    ? []
    : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

export const validateBacklogEntry = (fm: Record<string, string>) =>
  issues(backlogSchema.safeParse(fm));

export const validateWorkFile = (
  fm: Record<string, string>,
  kind: "slice" | "epic",
) => issues((kind === "epic" ? epicSchema : sliceSchema).safeParse(fm));

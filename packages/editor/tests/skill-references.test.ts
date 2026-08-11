import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_GENERATORS } from "@furnace/core/field";
import { ACTION_DESCRIPTORS } from "../src/action-registry/index.ts";

// The skill names a small number of identifiers on purpose — the vocabulary itself is READ at
// runtime (`session_query {about:"generators"}`, the catalog files) rather than listed, so a
// fifth generator needs no edit here. What this guards is the residue: the ids the skill DOES
// spell. A renamed action or a retired generator rots them silently, because nothing else in
// the repo reads a markdown file for identifiers.
const SKILL = join(
  import.meta.dir,
  "../.claude/skills/sculpting-worlds/SKILL.md",
);
const MCP = join(import.meta.dir, "../src/daemon/mcp.ts");

const skillText = (): string => readFileSync(SKILL, "utf8");

/** Every `backticked` token in the skill — the only place an identifier may appear. */
const backticked = (text: string): string[] =>
  [...text.matchAll(/`([^`\n]+)`/g)].map((m) => {
    // Boundary cast: the pattern's one capturing group has no alternation or `?`, so a
    // successful match always populates it — `RegExpMatchArray`'s indexed type is
    // `string | undefined` only because TS can't see that.
    return m[1] as string;
  });

/** `TOOLS` in `mcp.ts` is deliberately module-private, so this scans the file's own source for
 *  the table's `tool: "..."` rows rather than importing it. Same source-scan TECHNIQUE
 *  `harness-conventions.test.ts` uses in its rule (b) — that file's own reason for scanning is
 *  a process-wide MCP-SDK construction cost, unrelated to this one; only the technique, not
 *  the rationale, carries over. */
const toolNames = (): Set<string> =>
  new Set(
    [...readFileSync(MCP, "utf8").matchAll(/^\s*tool:\s*"([a-z_]+)",$/gm)].map(
      (m) => {
        // Boundary cast: same as `backticked` above — the group is mandatory given a match.
        return m[1] as string;
      },
    ),
  );

test("the door's tool table is still scannable", () => {
  // Guards the guard: a shape change in `mcp.ts` would otherwise turn every assertion below
  // into a vacuous pass over an empty set.
  expect(toolNames().size).toBe(9);
});

/** Action ids share a `namespace.verb` shape with plenty of unrelated backticked tokens the
 *  skill's prose will also use — `mcp.ts`, `index.ts`, `handlers.ts`. A token only counts as
 *  an action-id CANDIDATE if its prefix is one some real action actually uses (derived from
 *  the registry, never hardcoded) and its suffix isn't a source-file extension a filename
 *  would carry instead. */
const actionPrefixes = (): Set<string> =>
  new Set(ACTION_DESCRIPTORS.map((d) => d.id.split(".")[0] ?? ""));

const SOURCE_EXTENSIONS = new Set(["ts", "tsx", "js", "md", "json"]);

/** Tool names are snake_case, a shape the skill's prose will also reach for on unrelated things
 *  — `field_host`, `action_registry`. A token only counts as a tool-name CANDIDATE if its
 *  prefix up to and including the first underscore matches a real tool's prefix (derived from
 *  the scanned table, never hardcoded), or it is exactly `generate` — the one tool name with
 *  no underscore to key a prefix on. RESIDUAL GAP, stated honestly: a typo inside `generate`
 *  itself (e.g. `genereate`) has no prefix to match against, so this filter cannot catch it. */
const toolPrefixes = (names: Set<string>): Set<string> =>
  new Set(
    [...names].filter((n) => n.includes("_")).map((n) => `${n.split("_")[0]}_`),
  );

// MIGRATION (until Task 2): SKILL.md has no body prose yet, so `backticked()` returns []
// and the three assertions below pass vacuously. When Task 2 lands prose, add a floor
// assertion here (the `harness-conventions.test.ts` shape) so the extraction must prove
// it is pulling real content.

test("every action id the skill names is a real action", () => {
  const ids = new Set(ACTION_DESCRIPTORS.map((d) => d.id));
  const prefixes = actionPrefixes();
  const named = backticked(skillText()).filter((t) => {
    const m = /^([a-z]+)\.([a-zA-Z]+)$/.exec(t);
    if (!m) return false;
    // Boundary cast: both groups are mandatory given a match (no alternation/`?`).
    const prefix = m[1] as string;
    const suffix = m[2] as string;
    return prefixes.has(prefix) && !SOURCE_EXTENSIONS.has(suffix);
  });
  expect(named.filter((t) => !ids.has(t))).toEqual([]);
});

test("every tool name the skill names is a real tool", () => {
  const tools = toolNames();
  const prefixes = toolPrefixes(tools);
  const named = backticked(skillText()).filter((t) => {
    if (t === "generate") return true;
    if (!/^[a-z]+_[a-z_]+$/.test(t)) return false;
    return prefixes.has(`${t.split("_")[0]}_`);
  });
  expect(named.filter((t) => !tools.has(t))).toEqual([]);
});

test("every generator id the skill names is registered", () => {
  const ids = new Set(FIELD_GENERATORS.map((g) => g.id));
  const named = backticked(skillText()).filter((t) =>
    ["hall", "maze", "cave", "scatter"].includes(t),
  );
  expect(named.filter((t) => !ids.has(t))).toEqual([]);
});

test("the frontmatter declares a name and a description", () => {
  const text = skillText();
  expect(text.startsWith("---\n")).toBe(true);
  const front = text.slice(4, text.indexOf("\n---", 4));
  expect(front).toContain("name: sculpting-worlds");
  expect(/^description: Use when /m.test(front)).toBe(true);
});

// Generates docs/backlog/README.md from every entry's `summary:` frontmatter.
// `--write` emits, `--check` exits 1 on drift. Canon: docs/reference/docs-system.md §2.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./docs-frontmatter.ts";

// Declared here rather than imported from check-docs.ts: that module imports this one,
// and a cycle between them is not worth one `join`.
const ROOT = join(import.meta.dir, "..");

export type IndexEntry = {
  topic: string;
  slug: string;
  summary: string;
  status?: string | undefined;
  consumer?: string | undefined;
};

const BACKLOG = "docs/backlog";

const HEADER = `# Backlog index

**GENERATED — \`bun run docs:index\`. Do not edit by hand.** One line per entry, from its
\`summary:\` frontmatter. Conventions, the entry shape, and the pruning rules live in
\`docs/reference/docs-system.md\`; \`ls docs/backlog/<topic>/\` is the other index and cannot
go stale.

A backticked status suffix marks an entry that is not \`open\`. A \`→ slug\` suffix names the
work item that reads it — those entries are protected from consolidation.
`;

export function buildIndex(entries: readonly IndexEntry[]): string {
  const byTopic = new Map<string, IndexEntry[]>();
  for (const e of entries)
    byTopic.set(e.topic, [...(byTopic.get(e.topic) ?? []), e]);

  const sections = [...byTopic.keys()].sort().map((topic) => {
    const rows = [...(byTopic.get(topic) ?? [])]
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((e) => {
        const status =
          e.status && e.status !== "open" ? ` \`${e.status}\`` : "";
        const consumer = e.consumer ? ` → ${e.consumer}` : "";
        return `- [${e.slug}](${topic}/${e.slug}.md) — ${e.summary}${status}${consumer}`;
      });
    return `## ${topic} (${rows.length})\n\n${rows.join("\n")}\n`;
  });

  return `${HEADER}\n${sections.join("\n")}`;
}

export function collectEntries(): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const topic of readdirSync(join(ROOT, BACKLOG), {
    withFileTypes: true,
  })) {
    if (!topic.isDirectory()) continue;
    for (const file of readdirSync(join(ROOT, BACKLOG, topic.name))) {
      if (!file.endsWith(".md")) continue;
      const fm = parseFrontmatter(
        readFileSync(join(ROOT, BACKLOG, topic.name, file), "utf8"),
      );
      if (!fm)
        throw new Error(`${BACKLOG}/${topic.name}/${file}: no frontmatter`);
      if (!fm["summary"])
        throw new Error(`${BACKLOG}/${topic.name}/${file}: no summary`);
      out.push({
        topic: topic.name,
        slug: file.replace(/\.md$/, ""),
        summary: fm["summary"],
        status: fm["status"],
        consumer: fm["consumer"],
      });
    }
  }
  return out;
}

/** Regenerate and compare. Returns the drift message, or null when the committed index
 *  matches what the entries would produce right now. */
export function checkIndex(): string | null {
  const want = buildIndex(collectEntries());
  const path = join(ROOT, BACKLOG, "README.md");
  const have = readFileSync(path, "utf8");
  return want === have
    ? null
    : `${BACKLOG}/README.md is stale — run \`bun run docs:index\``;
}

if (import.meta.main) {
  if (process.argv.includes("--write")) {
    writeFileSync(
      join(ROOT, BACKLOG, "README.md"),
      buildIndex(collectEntries()),
    );
    console.log("docs-index: written.");
  } else {
    const drift = checkIndex();
    if (drift) {
      console.error(drift);
      process.exit(1);
    }
    console.log("docs-index: current.");
  }
}

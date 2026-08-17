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

const SEALS = "docs/learnings/seals";
// A marker is a line of its own. The seals README documents its own marker syntax in
// prose, so a substring search finds the sentence about the marker before the marker and
// overwrites the section explaining it — the same self-reference trap `checkDeriveMarkers`
// dodges by ignoring angle-bracketed placeholders.
const SEALS_OPEN = /^<!-- seals-index -->$/m;
const SEALS_CLOSE = /^<!-- \/seals-index -->$/m;

/** One seal's index row, from its frontmatter. `sealed` is a string rather than a date:
 *  the record carries ranges (a multi-part seal) as well as single days. */
export type SealEntry = {
  file: string;
  sealed: string;
  summary: string;
  seq: number;
};

/** The index table. Sorted by `seq` — the seal's position in the true slice sequence —
 *  because filename order is NOT slice order: seals extracted from an older record carry
 *  the extraction date. Packages are not a column; they live in each seal's head fields,
 *  and a second copy here is a second thing to rot. */
export function buildSealsIndex(entries: readonly SealEntry[]): string {
  const rows = [...entries]
    .sort((a, b) => a.seq - b.seq || a.file.localeCompare(b.file))
    .map((e) => `| ${e.sealed} | [${e.summary}](${e.file}) |`);
  return ["| Sealed | Seal |", "|---|---|", ...rows].join("\n");
}

/** Swap the generated region in, leaving every hand-written line outside the markers
 *  alone — the seals README is part prose (conventions, procedure) and part index. */
export function replaceSealsIndex(readme: string, table: string): string {
  const open = readme.match(SEALS_OPEN);
  const close = readme.match(SEALS_CLOSE);
  if (open?.index === undefined || close?.index === undefined)
    throw new Error(
      `${SEALS}/README.md: no <!-- seals-index --> … <!-- /seals-index --> region to write into (each marker on a line of its own)`,
    );
  if (close.index < open.index)
    throw new Error(`${SEALS}/README.md: seals-index markers are inverted`);
  const head = readme.slice(0, open.index + open[0].length);
  return `${head}\n\n${table}\n\n${readme.slice(close.index)}`;
}

/** Regenerate and compare. Returns the drift message, or null when the committed region
 *  matches what the seals' frontmatter would produce right now. */
export function diffSealsIndex(
  readme: string,
  entries: readonly SealEntry[],
): string | null {
  return replaceSealsIndex(readme, buildSealsIndex(entries)) === readme
    ? null
    : `${SEALS}/README.md is stale — run \`bun run docs:index\``;
}

const sealField = (
  fm: Record<string, string>,
  file: string,
  key: string,
): string => {
  const v = fm[key];
  if (!v) throw new Error(`${SEALS}/${file}: no ${key}`);
  return v;
};

export function collectSeals(): SealEntry[] {
  const out: SealEntry[] = [];
  const bySeq = new Map<number, string>();
  for (const file of readdirSync(join(ROOT, SEALS))) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const fm = parseFrontmatter(readFileSync(join(ROOT, SEALS, file), "utf8"));
    if (!fm) throw new Error(`${SEALS}/${file}: no frontmatter`);
    const seq = Number(sealField(fm, file, "seq"));
    if (!Number.isInteger(seq))
      throw new Error(`${SEALS}/${file}: seq is not an integer`);
    const clash = bySeq.get(seq);
    if (clash !== undefined)
      throw new Error(
        `${SEALS}/${file}: seq ${seq} is already ${clash}'s — seq is a position in the slice sequence, so two seals cannot share one`,
      );
    bySeq.set(seq, file);
    out.push({
      file,
      sealed: sealField(fm, file, "sealed"),
      summary: sealField(fm, file, "summary"),
      seq,
    });
  }
  return out;
}

export function checkSealsIndex(): string | null {
  return diffSealsIndex(
    readFileSync(join(ROOT, SEALS, "README.md"), "utf8"),
    collectSeals(),
  );
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
    const seals = join(ROOT, SEALS, "README.md");
    writeFileSync(
      seals,
      replaceSealsIndex(
        readFileSync(seals, "utf8"),
        buildSealsIndex(collectSeals()),
      ),
    );
    console.log("docs-index: written.");
  } else {
    const drift = [checkIndex(), checkSealsIndex()].filter((d) => d !== null);
    if (drift.length > 0) {
      for (const d of drift) console.error(d);
      process.exit(1);
    }
    console.log("docs-index: current.");
  }
}

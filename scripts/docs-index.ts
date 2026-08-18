// Generates docs/backlog/README.md from every entry's `summary:` frontmatter.
// `--write` emits, `--check` exits 1 on drift. Canon: docs/reference/docs-system.md §2.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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

/** Swap a generated region into a hand-written file, leaving every line outside the
 *  markers alone. One implementation for both indexes: the line-anchored matching is scar
 *  tissue (a substring search once ate the prose explaining the marker), and two copies of
 *  it would be two places for that lesson to be un-learned. */
function replaceMarkedRegion(
  text: string,
  markers: { open: RegExp; close: RegExp; name: string },
  region: string,
  label: string,
): string {
  const open = text.match(markers.open);
  const close = text.match(markers.close);
  if (open?.index === undefined || close?.index === undefined)
    throw new Error(
      `${label}: no <!-- ${markers.name} --> … <!-- /${markers.name} --> region to write into (each marker on a line of its own)`,
    );
  if (close.index < open.index)
    throw new Error(`${label}: ${markers.name} markers are inverted`);
  const head = text.slice(0, open.index + open[0].length);
  return `${head}\n\n${region}\n\n${text.slice(close.index)}`;
}

/** Swap the generated region in, leaving every hand-written line outside the markers
 *  alone — the seals README is part prose (conventions, procedure) and part index. */
export function replaceSealsIndex(readme: string, table: string): string {
  return replaceMarkedRegion(
    readme,
    { open: SEALS_OPEN, close: SEALS_CLOSE, name: "seals-index" },
    table,
    `${SEALS}/README.md`,
  );
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

const REFERENCE = "docs/reference";
// Same line-of-its-own discipline as the seals markers, and for the same reason: a shard
// README explains its own generated region in prose.
const REF_MARKERS = {
  open: /^<!-- reference-index -->$/m,
  close: /^<!-- \/reference-index -->$/m,
  name: "reference-index",
};
const H1 = /^# (.+)$/m;

/** One subsystem file inside a reference shard — a `docs/reference/<shard>/` directory,
 *  which is what a reference doc that accumulated several subsystems splits into (canon
 *  §2). `title` is the file's H1, `summary` its frontmatter line. */
export type ReferenceShardEntry = {
  file: string;
  title: string;
  summary: string;
};

/** The index rows: one per subsystem, `- [title](file) — summary`, sorted by filename.
 *  Two facts and no third — the `verified:` stamp is NOT a column, because `bun run
 *  sitrep`'s freshness block already reports it for every reference doc including shard
 *  members, and the index's job is "which file do I open", not "how stale is it".
 *  Filename order rather than a curated reading order: any curation would need a declared
 *  field to hold it, and a hand-kept order is the first thing to rot. */
export function buildReferenceIndex(
  entries: readonly ReferenceShardEntry[],
): string {
  return [...entries]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((e) => `- [${e.title}](${e.file}) — ${e.summary}`)
    .join("\n");
}

/** Swap the generated rows into a shard README, leaving its hand-written prose alone. */
export function replaceReferenceIndex(readme: string, rows: string): string {
  return replaceMarkedRegion(
    readme,
    REF_MARKERS,
    rows,
    `${REFERENCE}/<shard>/README.md`,
  );
}

/** Regenerate and compare. Returns the drift message, or null when the committed region
 *  matches what the shard's files would produce right now. */
export function diffReferenceIndex(
  shard: string,
  readme: string,
  entries: readonly ReferenceShardEntry[],
): string | null {
  return replaceReferenceIndex(readme, buildReferenceIndex(entries)) === readme
    ? null
    : `${REFERENCE}/${shard}/README.md is stale — run \`bun run docs:index\``;
}

/** Read one shard directory. `summary:` is required of a shard member — the row it feeds
 *  is the file's handle in the index, and an author-declared line beats a first-paragraph
 *  heuristic that no check can hold to one line. The H1 is required for the same reason
 *  the row links by title: a subsystem file with no title has nothing to be listed as. */
export function collectShard(dir: string): ReferenceShardEntry[] {
  const shard = basename(dir);
  const out: ReferenceShardEntry[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md") || e.name === "README.md")
      continue;
    const path = `${REFERENCE}/${shard}/${e.name}`;
    const text = readFileSync(join(dir, e.name), "utf8");
    const summary = parseFrontmatter(text)?.["summary"];
    if (!summary)
      throw new Error(
        `${path}: no summary — a shard member's summary: is its index row`,
      );
    const title = text.match(H1)?.[1]?.trim();
    if (!title)
      throw new Error(
        `${path}: no H1 — the index links a subsystem by its title`,
      );
    out.push({ file: e.name, title, summary });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Every shard in the reference register: a subdirectory that carries a `README.md`.
 *  Discovered rather than listed, so the next file that splits needs no edit here — and
 *  the README is what DECLARES the shard, the same "declared, never inferred" line
 *  `summary:` draws for a row. `docs/reference/adr/` is a subdirectory today and is not a
 *  split subsystem; a check that conscripted it would be ruling on a genre canon §2 has
 *  not described. */
export function collectShards(dir: string = join(ROOT, REFERENCE)): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) => e.isDirectory() && existsSync(join(dir, e.name, "README.md")),
    )
    .map((e) => e.name)
    .sort();
}

/** One drift message per stale shard index; empty when every shard is current. A shard
 *  whose README carries no marker region THROWS rather than reporting — the seals
 *  generator's stance: a half-built index is a mistake to fix, not drift to report. */
export function checkReferenceIndexes(
  dir: string = join(ROOT, REFERENCE),
): string[] {
  const out: string[] = [];
  for (const shard of collectShards(dir)) {
    const drift = diffReferenceIndex(
      shard,
      readFileSync(join(dir, shard, "README.md"), "utf8"),
      collectShard(join(dir, shard)),
    );
    if (drift !== null) out.push(drift);
  }
  return out;
}

function writeReferenceIndexes(dir: string = join(ROOT, REFERENCE)): void {
  for (const shard of collectShards(dir)) {
    const readme = join(dir, shard, "README.md");
    writeFileSync(
      readme,
      replaceReferenceIndex(
        readFileSync(readme, "utf8"),
        buildReferenceIndex(collectShard(join(dir, shard))),
      ),
    );
  }
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
    writeReferenceIndexes();
    console.log("docs-index: written.");
  } else {
    const drift = [
      checkIndex(),
      checkSealsIndex(),
      ...checkReferenceIndexes(),
    ].filter((d) => d !== null);
    if (drift.length > 0) {
      for (const d of drift) console.error(d);
      process.exit(1);
    }
    console.log("docs-index: current.");
  }
}

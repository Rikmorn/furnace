// `bun run sitrep` — the owner's board, computed from docs/work/, the backlog frontmatter,
// and the reference docs' `verified:` stamps. Nothing is committed; the board cannot
// disagree with the store because it IS the store. Canon: docs/reference/docs-system.md
// §1 (projection), §2 (the `verified:` stamp) and §5 (work register).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectWorkItems, ROOT, type WorkItem } from "./check-docs.ts";
import { parseFrontmatter } from "./docs-frontmatter.ts";
import { collectEntries, type IndexEntry } from "./docs-index.ts";

const label = (i: WorkItem) => {
  const injected = i.fm["injected"] === "true" ? " *injected*" : "";
  return `  ${i.slug}${injected} — ${i.fm["summary"] ?? "(no summary)"}`;
};

/** Queued slices in ruled order: an item follows the item its `after:` names. Items with
 *  no `after:` are an unordered pool and come first, in slug order. */
function topoOrder(queued: readonly WorkItem[]): WorkItem[] {
  const bySlug = new Map(queued.map((i) => [i.slug, i]));
  const depth = (i: WorkItem, seen = new Set<string>()): number => {
    const after = i.fm["after"];
    if (after === undefined || seen.has(i.slug)) return 0;
    const parent = bySlug.get(after);
    if (!parent) return 0; // dangling — check-docs fails on it separately
    seen.add(i.slug);
    return 1 + depth(parent, seen);
  };
  return [...queued].sort(
    (a, b) => depth(a) - depth(b) || a.slug.localeCompare(b.slug),
  );
}

/** One reference doc's freshness. `file` is the path under `docs/reference/`; `verified`
 *  is its `verified:` frontmatter — the date the doc was last checked against source —
 *  and `undefined` means it has never been stamped. */
export type ReferenceDoc = { file: string; verified?: string | undefined };

const REFERENCE = "docs/reference";

/** Every reference doc, top level plus ONE subdirectory level and no deeper: canon §2
 *  keeps the register flat until a file splits into a directory of per-subsystem files,
 *  which is one level, so a deeper path is a misfiling rather than a doc to report on. A
 *  shard's `README.md` is its generated index, not a subsystem, so it carries no stamp. */
export function collectReferenceDocs(
  dir: string = join(ROOT, REFERENCE),
): ReferenceDoc[] {
  const out: ReferenceDoc[] = [];
  const read = (path: string, file: string) => {
    if (!file.endsWith(".md") || path.endsWith("README.md")) return;
    const fm = parseFrontmatter(readFileSync(path, "utf8"));
    out.push({ file, verified: fm?.["verified"] });
  };
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      for (const child of readdirSync(join(dir, e.name)))
        read(join(dir, e.name, child), `${e.name}/${child}`);
    } else {
      read(join(dir, e.name), e.name);
    }
  }
  return out;
}

/** Stamped docs first, oldest stamp at the top — the owner reads down until the dates stop
 *  looking stale. No threshold lives here: "how old is too old" is a judgement about the
 *  doc's subject, and a number in the tool would make it the tool's. Unstamped docs follow,
 *  because "never verified" is a different question from "verified a while ago". */
function freshnessOrder(reference: readonly ReferenceDoc[]): ReferenceDoc[] {
  return [...reference].sort((a, b) => {
    if (!a.verified !== !b.verified) return a.verified ? -1 : 1;
    return (
      (a.verified ?? "").localeCompare(b.verified ?? "") ||
      a.file.localeCompare(b.file)
    );
  });
}

export function renderSitrep(
  items: readonly WorkItem[],
  backlog: readonly IndexEntry[],
  reference: readonly ReferenceDoc[],
): string {
  const slices = items.filter((i) => i.kind === "slice");
  const out: string[] = [];

  out.push("NOW");
  const inFlight = slices.filter((i) => i.fm["status"] === "in-flight");
  const next = slices.filter((i) => i.fm["status"] === "next");
  if (inFlight.length + next.length === 0) out.push("  (nothing in flight)");
  for (const i of [...inFlight, ...next]) out.push(label(i));

  const blocked = slices.filter((i) => i.fm["status"] === "blocked-on-owner");
  out.push("", "  blocked on you:");
  if (blocked.length === 0) out.push("    nothing");
  for (const i of blocked) out.push(`    ${i.slug} — ${i.fm["summary"] ?? ""}`);

  out.push("", "QUEUE");
  const queued = topoOrder(slices.filter((i) => i.fm["status"] === "queued"));
  if (queued.length === 0) out.push("  (empty)");
  for (const i of queued) {
    const after = i.fm["after"];
    out.push(`${label(i)}${after ? `  [after ${after}]` : ""}`);
  }

  const injected = slices.filter((i) => i.fm["injected"] === "true");
  if (injected.length > 0) {
    out.push(
      "",
      `INJECTED (${injected.length}) — scheduled ahead of an in-flight epic`,
    );
    for (const i of injected) out.push(`  ${i.slug}`);
  }

  out.push("", "EPICS");
  const epics = items.filter((i) => i.kind === "epic");
  if (epics.length === 0) out.push("  (none)");
  for (const e of epics) {
    out.push(
      `  ${e.slug} [${e.fm["status"] ?? "?"}] — ${e.fm["summary"] ?? ""}`,
    );
    for (const c of slices.filter((s) => s.epic === e.slug)) {
      out.push(`    ${c.slug} [${c.fm["status"] ?? "?"}]`);
    }
  }

  out.push("", "BACKLOG PRESSURE");
  const byTopic = new Map<string, number>();
  for (const e of backlog)
    byTopic.set(e.topic, (byTopic.get(e.topic) ?? 0) + 1);
  for (const topic of [...byTopic.keys()].sort()) {
    out.push(`  ${topic.padEnd(22)} ${byTopic.get(topic)}`);
  }
  out.push(`  ${"TOTAL".padEnd(22)} ${backlog.length}`);

  const claimed = backlog.filter((e) => e.consumer);
  if (claimed.length > 0) {
    out.push("", "  read by a work item (protected from consolidation):");
    for (const e of claimed) out.push(`    ${e.slug} → ${e.consumer}`);
  }

  out.push("", "REFERENCE FRESHNESS");
  if (reference.length === 0) out.push("  (none)");
  for (const d of freshnessOrder(reference)) {
    const stamp = d.verified ? `verified ${d.verified}` : "(unstamped)";
    out.push(`  ${d.file}  ${stamp}`);
  }

  return out.join("\n");
}

if (import.meta.main) {
  console.log(
    renderSitrep(collectWorkItems(), collectEntries(), collectReferenceDocs()),
  );
}

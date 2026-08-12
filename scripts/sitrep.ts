// `bun run sitrep` — the owner's board, computed from docs/work/ and the backlog
// frontmatter. Nothing is committed; the board cannot disagree with the store because it
// IS the store. Canon: docs/reference/docs-system.md §1 (projection) and §5 (work register).
import { collectWorkItems, type WorkItem } from "./check-docs.ts";
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

export function renderSitrep(
  items: readonly WorkItem[],
  backlog: readonly IndexEntry[],
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

  return out.join("\n");
}

if (import.meta.main) {
  console.log(renderSitrep(collectWorkItems(), collectEntries()));
}

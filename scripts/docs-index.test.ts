import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndex,
  buildReferenceIndex,
  buildSealsIndex,
  checkReferenceIndexes,
  collectShard,
  collectShards,
  diffReferenceIndex,
  diffSealsIndex,
  type ReferenceShardEntry,
  replaceReferenceIndex,
  replaceSealsIndex,
  type SealEntry,
} from "./docs-index";

describe("buildIndex", () => {
  test("groups entries by topic with one summary line each", () => {
    const md = buildIndex([
      {
        topic: "dungeon",
        slug: "a-thing",
        summary: "does a thing",
        status: "open",
        consumer: undefined,
      },
      {
        topic: "dungeon",
        slug: "b-thing",
        summary: "b",
        status: "deferred",
        consumer: "door-set",
      },
    ]);
    expect(md).toContain("## dungeon (2)");
    expect(md).toContain("- [a-thing](dungeon/a-thing.md) — does a thing");
    expect(md).toContain(
      "- [b-thing](dungeon/b-thing.md) — b `deferred` → door-set",
    );
  });
  test("is deterministic (sorted by topic then slug)", () => {
    const a = buildIndex([
      { topic: "z", slug: "z", summary: "z" },
      { topic: "a", slug: "a", summary: "a" },
    ]);
    expect(a.indexOf("## a")).toBeLessThan(a.indexOf("## z"));
  });
  test("sorts slugs within a topic", () => {
    const md = buildIndex([
      { topic: "t", slug: "b", summary: "b" },
      { topic: "t", slug: "a", summary: "a" },
    ]);
    expect(md.indexOf("[a]")).toBeLessThan(md.indexOf("[b]"));
  });
  test("states that it is generated", () => {
    expect(buildIndex([])).toContain("GENERATED");
  });
});

const seal = (seq: number, over: Partial<SealEntry> = {}): SealEntry => ({
  file: `2026-08-0${seq}-slice-${seq}.md`,
  sealed: `2026-08-0${seq}`,
  summary: `slice ${seq}`,
  seq,
  ...over,
});

// A README with prose on both sides of the generated region — the shape the real file has.
const readmeWith = (region: string) =>
  `# Seals\n\nprose above\n\n<!-- seals-index -->\n\n${region}\n\n<!-- /seals-index -->\n\nprose below\n`;

describe("buildSealsIndex", () => {
  test("orders rows by seq, never by filename or input order", () => {
    // The real record's extraction-dated seals sort wrong by filename: seq is the authority.
    const md = buildSealsIndex([
      seal(3, { file: "2026-01-01-extracted.md", summary: "third" }),
      seal(1, { file: "2026-09-09-late-filename.md", summary: "first" }),
      seal(2, { summary: "second" }),
    ]);
    expect(md.indexOf("first")).toBeLessThan(md.indexOf("second"));
    expect(md.indexOf("second")).toBeLessThan(md.indexOf("third"));
  });

  test("renders one row per seal", () => {
    const rows = buildSealsIndex([seal(1), seal(2), seal(3)])
      .split("\n")
      .filter((l) => l.includes("]("));
    expect(rows).toHaveLength(3);
  });

  test("renders `| sealed | [summary](file) |` and no packages column", () => {
    const md = buildSealsIndex([
      seal(1, {
        file: "2026-08-14-undo-attribution.md",
        sealed: "2026-08-14",
        summary: "Undo + attribution — the fence lifts",
      }),
    ]);
    expect(md).toContain(
      "| 2026-08-14 | [Undo + attribution — the fence lifts](2026-08-14-undo-attribution.md) |",
    );
    const row = md.split("\n").find((l) => l.includes("]("));
    expect(row?.split("|")).toHaveLength(4); // "", sealed, seal, "" — two cells, no third
  });

  test("carries a date that is not the filename's — sealed is its own field", () => {
    const md = buildSealsIndex([
      seal(1, { file: "2026-07-06-extracted.md", sealed: "2026-06-18" }),
    ]);
    expect(md).toContain("| 2026-06-18 | [");
  });

  test("carries the table header", () => {
    expect(buildSealsIndex([seal(1)])).toContain("| Sealed | Seal |");
  });
});

describe("replaceSealsIndex", () => {
  test("replaces only the region between the markers — prose survives", () => {
    const out = replaceSealsIndex(readmeWith("stale table"), "fresh table");
    expect(out).toContain("prose above");
    expect(out).toContain("prose below");
    expect(out).toContain("fresh table");
    expect(out).not.toContain("stale table");
  });

  test("is idempotent", () => {
    const once = replaceSealsIndex(readmeWith("stale"), "fresh");
    expect(replaceSealsIndex(once, "fresh")).toBe(once);
  });

  test("a prose mention of the marker is not a marker", () => {
    // Found the hard way: the seals README documents its own marker syntax, and a
    // substring search matched that sentence first and overwrote the section explaining
    // the mechanism. A marker is a line of its own.
    const readme = `# Seals\n\nGenerated between the \`<!-- seals-index -->\` markers.\n\n<!-- seals-index -->\n\nstale\n\n<!-- /seals-index -->\n\nprose below\n`;
    const out = replaceSealsIndex(readme, "fresh");
    expect(out).toContain(
      "Generated between the `<!-- seals-index -->` markers.",
    );
    expect(out).toContain("fresh");
    expect(out).not.toContain("stale");
  });

  test("throws when the markers are missing — a silent no-op would hide the drift", () => {
    expect(() => replaceSealsIndex("# Seals\n\nno markers\n", "table")).toThrow(
      /region to write into/,
    );
  });
});

describe("diffSealsIndex", () => {
  const entries = [seal(1), seal(2)];
  // The fixture's region is whatever the generator produces — that is what makes the
  // "current" case a real round-trip rather than a hand-copied table.
  const current = readmeWith(buildSealsIndex(entries));

  test("returns null when the committed region is current", () => {
    expect(diffSealsIndex(current, entries)).toBeNull();
  });

  test("detects a hand-edited row", () => {
    const edited = current.replace("slice 1", "slice ONE");
    expect(edited).not.toBe(current);
    expect(diffSealsIndex(edited, entries)).toContain(
      "docs/learnings/seals/README.md",
    );
    expect(diffSealsIndex(edited, entries)).toContain("bun run docs:index");
  });

  test("detects a seal the committed region is missing", () => {
    expect(diffSealsIndex(current, [...entries, seal(3)])).not.toBeNull();
  });
});

// --- reference-shard index (Task 10 step 3) ---

const member = (
  file: string,
  over: Partial<ReferenceShardEntry> = {},
): ReferenceShardEntry => ({
  file,
  title: `Editor ${file.replace(/\.md$/, "")}`,
  summary: `what ${file} is`,
  ...over,
});

const shardReadme = (region: string) =>
  `# Editor as-built\n\nprose above\n\n<!-- reference-index -->\n\n${region}\n\n<!-- /reference-index -->\n\nprose below\n`;

describe("buildReferenceIndex", () => {
  test("renders `- [H1](file) — summary` and nothing else on the row", () => {
    // Exact equality is the pin that keeps the row to two facts: the title a reader
    // navigates by and the one line saying what the file is. A `verified:` stamp would
    // show up here as a third — the freshness block (`bun run sitrep`) owns that fact.
    const rows = buildReferenceIndex([
      member("daemon.md", {
        title: "Editor daemon",
        summary: "the Node-portable daemon: routes, tables, trust boundary",
      }),
    ])
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(rows).toEqual([
      "- [Editor daemon](daemon.md) — the Node-portable daemon: routes, tables, trust boundary",
    ]);
  });

  test("orders rows by filename, never by input order", () => {
    const md = buildReferenceIndex([
      member("tools.md"),
      member("agent-door.md"),
      member("history.md"),
    ]);
    expect(md.indexOf("(agent-door.md)")).toBeLessThan(
      md.indexOf("(history.md)"),
    );
    expect(md.indexOf("(history.md)")).toBeLessThan(md.indexOf("(tools.md)"));
  });

  test("renders one row per shard member", () => {
    const rows = buildReferenceIndex([
      member("a.md"),
      member("b.md"),
      member("c.md"),
    ])
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(rows).toHaveLength(3);
  });
});

describe("replaceReferenceIndex", () => {
  test("replaces only the region between the markers — prose survives", () => {
    const out = replaceReferenceIndex(shardReadme("stale rows"), "fresh rows");
    expect(out).toContain("prose above");
    expect(out).toContain("prose below");
    expect(out).toContain("fresh rows");
    expect(out).not.toContain("stale rows");
  });

  test("is idempotent", () => {
    const once = replaceReferenceIndex(shardReadme("stale"), "fresh");
    expect(replaceReferenceIndex(once, "fresh")).toBe(once);
  });

  test("a prose mention of the marker is not a marker", () => {
    // The seals README taught this at the cost of ~35 overwritten lines: a substring
    // search matches the sentence ABOUT the marker before the marker itself. A shard
    // README explains its own generated region for the same reason, so the same trap is
    // live here. A marker is a line of its own.
    const readme = `# Editor as-built\n\nRows are generated between the \`<!-- reference-index -->\` markers.\n\n<!-- reference-index -->\n\nstale\n\n<!-- /reference-index -->\n\nprose below\n`;
    const out = replaceReferenceIndex(readme, "fresh");
    expect(out).toContain(
      "Rows are generated between the `<!-- reference-index -->` markers.",
    );
    expect(out).toContain("fresh");
    expect(out).not.toContain("stale");
  });

  test("throws when the markers are missing — a silent no-op would hide the drift", () => {
    // The message is part of the pin: a bare `.toThrow()` is satisfied by the TypeError a
    // null match would raise two lines later, so it would stay green with the guard
    // deleted. Caught by sabotage S4 of this very rule.
    expect(() =>
      replaceReferenceIndex("# Editor as-built\n\nno markers\n", "rows"),
    ).toThrow(/region to write into/);
  });

  test("throws when the markers are inverted", () => {
    const inverted = `# Editor\n\n<!-- /reference-index -->\n\nx\n\n<!-- reference-index -->\n`;
    expect(() => replaceReferenceIndex(inverted, "rows")).toThrow(/inverted/);
  });
});

describe("diffReferenceIndex", () => {
  const members = [member("daemon.md"), member("tools.md")];
  const current = shardReadme(buildReferenceIndex(members));

  test("returns null when the committed region is current", () => {
    expect(diffReferenceIndex("editor", current, members)).toBeNull();
  });

  test("names the shard's README and the command when a row was hand-edited", () => {
    const edited = current.replace("what daemon.md is", "what I typed instead");
    expect(edited).not.toBe(current);
    const drift = diffReferenceIndex("editor", edited, members);
    expect(drift).toContain("docs/reference/editor/README.md");
    expect(drift).toContain("bun run docs:index");
  });

  test("detects a shard member the committed region is missing", () => {
    expect(
      diffReferenceIndex("editor", current, [...members, member("history.md")]),
    ).not.toBeNull();
  });
});

const shardFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "furnace-shard-"));
  const write = (rel: string, body: string) => {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write(
    "editor/daemon.md",
    "---\nverified: 2026-08-17\nsummary: the Node-portable daemon\n---\n\n# Editor daemon\n\nBody prose.\n",
  );
  write(
    "editor/tools.md",
    "---\nsummary: the tool chassis\n---\n\n# Editor tools\n\nBody prose.\n",
  );
  write("editor/README.md", "# index\n");
  write("editor/notes.txt", "not markdown");
  write("engine-conventions.md", "# a top-level reference doc, not a shard\n");
  return root;
};

describe("collectShard", () => {
  test("reads the title from the H1 and the description from `summary:`", () => {
    expect(collectShard(join(shardFixture(), "editor"))).toContainEqual({
      file: "daemon.md",
      title: "Editor daemon",
      summary: "the Node-portable daemon",
    });
  });

  test("skips the generated README and anything that is not markdown", () => {
    const files = collectShard(join(shardFixture(), "editor")).map(
      (e) => e.file,
    );
    expect(files).toEqual(["daemon.md", "tools.md"]);
  });

  test("throws naming the file when a member carries no `summary:`", () => {
    const root = shardFixture();
    writeFileSync(
      join(root, "editor/tools.md"),
      "---\nverified: 2026-08-17\n---\n\n# Editor tools\n",
    );
    expect(() => collectShard(join(root, "editor"))).toThrow(/tools\.md/);
  });

  test("throws naming the file when a member carries no H1", () => {
    const root = shardFixture();
    writeFileSync(
      join(root, "editor/tools.md"),
      "---\nsummary: the tool chassis\n---\n\nbody with no heading\n",
    );
    expect(() => collectShard(join(root, "editor"))).toThrow(/tools\.md/);
  });
});

describe("collectShards", () => {
  test("finds a subdirectory carrying a README — that is what declares a shard", () => {
    expect(collectShards(shardFixture())).toEqual(["editor"]);
  });

  test("a subdirectory with no README is not a shard", () => {
    // `docs/reference/adr/` is exactly this today: a subdirectory that is not a split
    // subsystem. Conscripting it would be ruling on a genre canon §2 does not describe,
    // so the README — the index itself — is the opt-in.
    const root = shardFixture();
    mkdirSync(join(root, "adr"), { recursive: true });
    writeFileSync(join(root, "adr/0001-a-decision.md"), "# ADR 0001\n");
    expect(collectShards(root)).toEqual(["editor"]);
  });
});

describe("checkReferenceIndexes", () => {
  const withIndex = (root: string) => {
    writeFileSync(
      join(root, "editor/README.md"),
      shardReadme(buildReferenceIndex(collectShard(join(root, "editor")))),
    );
    return root;
  };

  test("returns nothing when every shard's index is current", () => {
    expect(checkReferenceIndexes(withIndex(shardFixture()))).toEqual([]);
  });

  test("reports a shard whose index is stale", () => {
    const root = withIndex(shardFixture());
    writeFileSync(
      join(root, "editor/history.md"),
      "---\nsummary: undo/redo\n---\n\n# Editor history\n",
    );
    expect(checkReferenceIndexes(root).join("\n")).toContain(
      "docs/reference/editor/README.md",
    );
  });

  test("throws rather than reporting when a shard README has no marker region", () => {
    // Loud, not a drift line: a README without the region is a half-built index, and the
    // seals generator takes the same stance on a seal missing its frontmatter.
    const root = withIndex(shardFixture());
    writeFileSync(join(root, "editor/README.md"), "# Editor\n\nno markers\n");
    expect(() => checkReferenceIndexes(root)).toThrow(/reference-index/);
  });
});

import { describe, expect, test } from "bun:test";
import {
  buildIndex,
  buildSealsIndex,
  diffSealsIndex,
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
    expect(() =>
      replaceSealsIndex("# Seals\n\nno markers\n", "table"),
    ).toThrow();
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

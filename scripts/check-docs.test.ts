import { describe, expect, test } from "bun:test";
import type { WorkItem } from "./check-docs";
import {
  checkBacklogFrontmatter,
  checkConsumers,
  checkDeriveMarkers,
  checkFedLine,
  checkShelfFilenames,
  checkWorkRegister,
  collectLiveRegisterFiles,
  collectShelfFiles,
  scanDeadPaths,
  scanFileLineCitations,
} from "./check-docs";

const exists = (p: string) =>
  ["packages/core/src/field/ops.ts", "docs/reference/docs-system.md"].includes(
    p,
  );

describe("scanDeadPaths", () => {
  test("flags a cited path that does not exist", () => {
    const v = scanDeadPaths(
      "f.md",
      "see `packages/core/src/gone.ts` for detail",
      exists,
    );
    expect(v).toEqual([
      {
        file: "f.md",
        line: 1,
        kind: "dead-path",
        detail: "packages/core/src/gone.ts",
      },
    ]);
  });
  test("passes a cited path that exists", () => {
    expect(
      scanDeadPaths("f.md", "see `packages/core/src/field/ops.ts`", exists),
    ).toEqual([]);
  });
  test("exempts the `(gone)` marker", () => {
    expect(
      scanDeadPaths(
        "f.md",
        "the old `packages/core/src/gone.ts` (gone) module",
        exists,
      ),
    ).toEqual([]);
  });
  test("exempts commit-pinned git show citations", () => {
    expect(
      scanDeadPaths(
        "f.md",
        "recover with `git show abc123:docs/backlog/old-entry.md`",
        exists,
      ),
    ).toEqual([]);
  });
  test("exempts the PINNED path only, not the rest of its line", () => {
    const v = scanDeadPaths(
      "f.md",
      "`git show abc123:docs/backlog/old.md` replaced `packages/core/src/dead.ts`",
      exists,
    );
    expect(v).toEqual([
      {
        file: "f.md",
        line: 1,
        kind: "dead-path",
        detail: "packages/core/src/dead.ts",
      },
    ]);
  });
  test("exempts a non-lowercase-hex revision (HEAD, a tag, a branch)", () => {
    expect(
      scanDeadPaths("f.md", "`git show HEAD:docs/backlog/old.md`", exists),
    ).toEqual([]);
  });
  test("ignores template placeholders (angle brackets break the path regex)", () => {
    expect(
      scanDeadPaths(
        "f.md",
        "entries live at docs/backlog/<topic>/<slug>.md",
        exists,
      ),
    ).toEqual([]);
  });
  test("reports the correct line number", () => {
    const v = scanDeadPaths(
      "f.md",
      "line one\nsee packages/core/src/gone.ts here",
      exists,
    );
    expect(v[0]?.line).toBe(2);
  });
});

describe("scanFileLineCitations", () => {
  test("flags file:line citations", () => {
    const v = scanFileLineCitations(
      "f.md",
      "the bug is at `field-analyzer.ts:433` today",
    );
    expect(v).toEqual([
      {
        file: "f.md",
        line: 1,
        kind: "file-line-citation",
        detail: "field-analyzer.ts:433",
      },
    ]);
  });
  test("passes symbol citations and bare paths", () => {
    expect(
      scanFileLineCitations(
        "f.md",
        "see `markUnreachable` in `field-analyzer.ts`",
      ),
    ).toEqual([]);
  });
  test("does not flag time-of-day or ratios", () => {
    expect(scanFileLineCitations("f.md", "at 14:11 the ratio was 3:1")).toEqual(
      [],
    );
  });
});

describe("checkDeriveMarkers", () => {
  test("passes when the command output matches the recorded value", () => {
    const md = "count: <!-- derive: echo 7 -->7<!-- /derive -->";
    expect(checkDeriveMarkers("f.md", md)).toEqual([]);
  });
  test("fails when the recorded value drifted", () => {
    const md = "count: <!-- derive: echo 7 -->9<!-- /derive -->";
    const v = checkDeriveMarkers("f.md", md);
    expect(v).toHaveLength(1);
    expect(v[0]?.kind).toBe("derive-drift");
    expect(v[0]?.detail).toContain("expected 7");
  });
  test("fails when the deriving command itself fails", () => {
    const md = "<!-- derive: exit 3 -->x<!-- /derive -->";
    expect(checkDeriveMarkers("f.md", md)[0]?.kind).toBe("derive-error");
  });
  test("skips an angle-bracket placeholder — the canon documents its own syntax", () => {
    const md = "<!-- derive: <deterministic command> -->value<!-- /derive -->";
    expect(checkDeriveMarkers("f.md", md)).toEqual([]);
  });
});

describe("collectLiveRegisterFiles", () => {
  test("includes backlog + reference, excludes learnings/research/superpowers", () => {
    const files = collectLiveRegisterFiles();
    expect(files.some((f) => f.startsWith("docs/backlog/"))).toBe(true);
    expect(files.some((f) => f.startsWith("docs/reference/"))).toBe(true);
    expect(files.some((f) => f.startsWith("docs/learnings/"))).toBe(false);
    expect(files.some((f) => f.startsWith("docs/superpowers/"))).toBe(false);
  });
});

describe("checkBacklogFrontmatter", () => {
  const entry = "docs/backlog/topic/a.md";
  test("passes a valid entry", () => {
    expect(
      checkBacklogFrontmatter(entry, "---\nsummary: s\n---\n\n# A"),
    ).toEqual([]);
  });
  test("flags an entry with no frontmatter", () => {
    expect(checkBacklogFrontmatter(entry, "# A")[0]?.kind).toBe(
      "no-frontmatter",
    );
  });
  test("flags a schema violation", () => {
    const v = checkBacklogFrontmatter(
      entry,
      "---\nsummary: s\nstatus: parked\n---\n",
    );
    expect(v[0]?.kind).toBe("frontmatter-schema");
  });
  test("exempts the generated index", () => {
    expect(
      checkBacklogFrontmatter("docs/backlog/README.md", "# Backlog index"),
    ).toEqual([]);
  });
  test("ignores files outside the backlog", () => {
    expect(checkBacklogFrontmatter("docs/reference/x.md", "# X")).toEqual([]);
  });
});

describe("checkWorkRegister", () => {
  const slice = (slug: string, fm: Record<string, string>): WorkItem => ({
    slug,
    kind: "slice",
    file: `docs/work/${slug}.md`,
    fm,
  });
  const epic = (slug: string, fm: Record<string, string>): WorkItem => ({
    slug,
    kind: "epic",
    file: `docs/work/${slug}/README.md`,
    fm,
  });

  test("accepts a register with one next", () => {
    expect(
      checkWorkRegister([
        slice("a", { status: "next", summary: "a" }),
        slice("b", { status: "queued", summary: "b" }),
      ]),
    ).toEqual([]);
  });

  test("flags two items holding next", () => {
    const v = checkWorkRegister([
      slice("a", { status: "next", summary: "a" }),
      slice("b", { status: "next", summary: "b" }),
    ]);
    expect(v.map((x) => x.kind)).toContain("work-multiple-next");
  });

  test("accepts an after: pointing at a sibling that exists", () => {
    expect(
      checkWorkRegister([
        slice("a", { status: "queued", summary: "a" }),
        slice("b", { status: "queued", summary: "b", after: "a" }),
      ]),
    ).toEqual([]);
  });

  test("flags a dangling after:", () => {
    const v = checkWorkRegister([
      slice("b", { status: "queued", summary: "b", after: "ghost" }),
    ]);
    expect(v[0]?.kind).toBe("work-dangling-after");
    expect(v[0]?.detail).toContain("ghost");
  });

  test("an after: may name an epic", () => {
    expect(
      checkWorkRegister([
        epic("e", { status: "queued", summary: "e" }),
        slice("s", { status: "queued", summary: "s", after: "e" }),
      ]),
    ).toEqual([]);
  });

  test("validates a slice against the slice schema", () => {
    const v = checkWorkRegister([slice("a", { status: "queued" })]);
    expect(v[0]?.kind).toBe("frontmatter-schema");
    expect(v[0]?.detail).toContain("summary");
  });

  test("validates an epic against the epic schema — next is not an epic status", () => {
    const v = checkWorkRegister([epic("e", { status: "next", summary: "e" })]);
    expect(v[0]?.kind).toBe("frontmatter-schema");
    expect(v[0]?.detail).toContain("status");
  });

  test("an in-flight epic needs at least one unsealed child", () => {
    const v = checkWorkRegister([
      epic("e", { status: "in-flight", summary: "e" }),
    ]);
    expect(v[0]?.kind).toBe("work-epic-no-children");
  });

  test("an in-flight epic whose only child is queued is fine — the gated case", () => {
    expect(
      checkWorkRegister([
        epic("e", { status: "in-flight", summary: "e" }),
        {
          slug: "c",
          kind: "slice",
          file: "docs/work/e/c.md",
          epic: "e",
          fm: { status: "queued", summary: "c" },
        },
      ]),
    ).toEqual([]);
  });
});

describe("checkConsumers", () => {
  // Deliberately synthetic slugs. A fixture that borrows a LIVE board slug rots the day
  // that item seals — which is the very failure this check exists to catch.
  const live = new Set(["oak-doors", "copper-pipes"]);

  test("passes a consumer naming a live work item", () => {
    expect(
      checkConsumers(new Map([["docs/backlog/x/a.md", "oak-doors"]]), live),
    ).toEqual([]);
  });

  test("flags a consumer naming nothing — the seal-deletes-its-work-item case", () => {
    const v = checkConsumers(
      new Map([["docs/backlog/x/a.md", "docs-system"]]),
      live,
    );
    expect(v).toEqual([
      {
        file: "docs/backlog/x/a.md",
        line: 1,
        kind: "consumer-dangling",
        detail:
          "consumer: docs-system names no work item — re-point it, or drop it for a prose trigger",
      },
    ]);
  });

  test("flags every dangling entry, not just the first", () => {
    const v = checkConsumers(
      new Map([
        ["a.md", "gone-one"],
        ["b.md", "oak-doors"],
        ["c.md", "gone-two"],
      ]),
      live,
    );
    expect(v.map((x) => x.file)).toEqual(["a.md", "c.md"]);
  });
});

describe("checkShelfFilenames", () => {
  test("flags an undated learnings file", () => {
    expect(
      checkShelfFilenames(["docs/learnings/render-to-texture.md"]),
    ).toEqual([
      {
        file: "docs/learnings/render-to-texture.md",
        line: 1,
        kind: "shelf-filename",
        detail:
          "render-to-texture.md — a shelf record is named YYYY-MM-DD-<slug>.md",
      },
    ]);
  });

  test("passes a dated learnings file", () => {
    expect(
      checkShelfFilenames(["docs/learnings/2026-05-17-render-to-texture.md"]),
    ).toEqual([]);
  });

  test("flags an undated seal", () => {
    const v = checkShelfFilenames(["docs/learnings/seals/undo-attribution.md"]);
    expect(v).toHaveLength(1);
    expect(v[0]?.kind).toBe("shelf-filename");
    expect(v[0]?.file).toBe("docs/learnings/seals/undo-attribution.md");
  });

  test("passes a dated seal", () => {
    expect(
      checkShelfFilenames([
        "docs/learnings/seals/2026-08-14-undo-attribution.md",
      ]),
    ).toEqual([]);
  });

  test("exempts README.md on every shelf — an index is not a dated record", () => {
    expect(
      checkShelfFilenames([
        "docs/learnings/README.md",
        "docs/learnings/seals/README.md",
      ]),
    ).toEqual([]);
  });

  test("flags an undated research file", () => {
    const v = checkShelfFilenames(["docs/research/shallot.md"]);
    expect(v).toHaveLength(1);
    expect(v[0]?.kind).toBe("shelf-filename");
  });

  test("passes a dated research file", () => {
    expect(
      checkShelfFilenames(["docs/research/2026-05-21-shallot.md"]),
    ).toEqual([]);
  });

  test("passes a dated research directory — the date is on the DIRECTORY", () => {
    expect(
      checkShelfFilenames([
        "docs/research/2026-05-19-build-distribution/README.md",
        "docs/research/2026-05-19-build-distribution/cli-libraries.md",
      ]),
    ).toEqual([]);
  });

  test("flags an undated research directory ONCE, against the directory", () => {
    const v = checkShelfFilenames([
      "docs/research/build-distribution/README.md",
      "docs/research/build-distribution/cli-libraries.md",
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe("docs/research/build-distribution");
    expect(v[0]?.detail).toContain("YYYY-MM-DD-<slug>/");
  });

  test("exempts docs/research/assets/ entirely — binary payloads, dated per shard", () => {
    expect(
      checkShelfFilenames([
        "docs/research/assets/2026-07-11-substrate-spike/mesh-aisle.md",
        "docs/research/assets/loose-note.md",
      ]),
    ).toEqual([]);
  });

  test("admits a legacy dotted slug — dated slugs are immutable history", () => {
    expect(
      checkShelfFilenames([
        "docs/research/2026-07-29-f4.5-editor-chrome-precedent-research.md",
      ]),
    ).toEqual([]);
  });

  test("flags a dated file whose slug is not lower-kebab", () => {
    const v = checkShelfFilenames([
      "docs/learnings/2026-08-14-Process_Retro.md",
    ]);
    expect(v[0]?.kind).toBe("shelf-filename");
  });

  test("ignores files outside the shelves", () => {
    expect(
      checkShelfFilenames([
        "docs/backlog/topic/a.md",
        "docs/reference/docs-system.md",
        "docs/work/genre-contracts.md",
      ]),
    ).toEqual([]);
  });
});

describe("checkFedLine", () => {
  const fed = "# Doc\n\nbody\n\n**Fed:** the api-posture contract.\n";

  test("passes a research doc carrying a Fed line", () => {
    expect(checkFedLine("docs/research/2026-05-21-shallot.md", fed)).toEqual(
      [],
    );
  });

  test("flags a research doc with no Fed line", () => {
    expect(
      checkFedLine("docs/research/2026-05-21-shallot.md", "# Doc\n\nbody\n"),
    ).toEqual([
      {
        file: "docs/research/2026-05-21-shallot.md",
        line: 1,
        kind: "fed-line-missing",
        detail:
          "no `**Fed:**` line — name what this doc fed, or say it fed nothing",
      },
    ]);
  });

  test("flags a bare `**Fed:**` naming nothing", () => {
    const v = checkFedLine(
      "docs/research/2026-05-21-shallot.md",
      "# Doc\n\n**Fed:**\n",
    );
    expect(v[0]?.kind).toBe("fed-line-missing");
  });

  test("requires a Fed line on a dated directory's README — the dir is one doc", () => {
    const v = checkFedLine(
      "docs/research/2026-05-19-build-distribution/README.md",
      "# Build distribution\n",
    );
    expect(v[0]?.kind).toBe("fed-line-missing");
  });

  test("exempts a file INSIDE a dated directory — the README carries the doc's Fed line", () => {
    expect(
      checkFedLine(
        "docs/research/2026-05-19-build-distribution/cli-libraries.md",
        "# CLI libraries\n",
      ),
    ).toEqual([]);
  });

  test("exempts docs/research/assets/ entirely", () => {
    expect(
      checkFedLine("docs/research/assets/2026-07-11-spike/notes.md", "# x\n"),
    ).toEqual([]);
  });

  test("ignores learnings and seals — the Fed line is a research contract", () => {
    expect(
      checkFedLine("docs/learnings/2026-08-14-process-retro.md", "# x\n"),
    ).toEqual([]);
    expect(
      checkFedLine(
        "docs/learnings/seals/2026-08-14-undo-attribution.md",
        "# x\n",
      ),
    ).toEqual([]);
  });
});

describe("collectShelfFiles", () => {
  test("includes learnings, seals and research; excludes the live registers", () => {
    const files = collectShelfFiles();
    expect(files.some((f) => f.startsWith("docs/learnings/seals/"))).toBe(true);
    expect(
      files.some(
        (f) => f.startsWith("docs/learnings/") && !f.includes("/seals/"),
      ),
    ).toBe(true);
    expect(files.some((f) => f.startsWith("docs/research/"))).toBe(true);
    expect(files.some((f) => f.startsWith("docs/backlog/"))).toBe(false);
    expect(files.some((f) => f.startsWith("docs/reference/"))).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import type { WorkItem } from "./check-docs";
import {
  checkBacklogFrontmatter,
  checkDeriveMarkers,
  checkWorkRegister,
  collectLiveRegisterFiles,
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

import { describe, expect, test } from "bun:test";
import {
  checkDeriveMarkers,
  collectLiveRegisterFiles,
  scanDeadPaths,
  scanFileLineCitations,
} from "./check-docs";

const exists = (p: string) =>
  ["packages/core/src/index.ts", "docs/reference/docs-system.md"].includes(p);

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
      scanDeadPaths("f.md", "see `packages/core/src/index.ts`", exists),
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

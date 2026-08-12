import { describe, expect, test } from "bun:test";
import { scanDeadPaths, scanFileLineCitations } from "./check-docs";

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

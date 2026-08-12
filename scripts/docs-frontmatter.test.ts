import { describe, expect, test } from "bun:test";
import {
  parseFrontmatter,
  validateBacklogEntry,
  validateWorkFile,
} from "./docs-frontmatter";

describe("parseFrontmatter", () => {
  test("parses flat key: value pairs between --- fences", () => {
    const md = "---\nsummary: a one-liner\nstatus: open\n---\n\n# Body";
    expect(parseFrontmatter(md)).toEqual({
      summary: "a one-liner",
      status: "open",
    });
  });
  test("returns null when there is no frontmatter", () => {
    expect(parseFrontmatter("# Just a body")).toBeNull();
  });
  test("keeps colons inside values", () => {
    expect(
      parseFrontmatter("---\nsummary: derive: with a colon\n---\n"),
    ).toEqual({
      summary: "derive: with a colon",
    });
  });
});

describe("validateBacklogEntry", () => {
  test("accepts a minimal valid entry", () => {
    expect(validateBacklogEntry({ summary: "s" })).toEqual([]);
  });
  test("rejects a missing summary", () => {
    expect(validateBacklogEntry({ status: "open" })[0]).toContain("summary");
  });
  test("rejects an unknown status", () => {
    expect(
      validateBacklogEntry({ summary: "s", status: "parked" })[0],
    ).toContain("status");
  });
  test("rejects superseded without superseded-by", () => {
    expect(
      validateBacklogEntry({ summary: "s", status: "superseded" })[0],
    ).toContain("superseded-by");
  });
});

describe("validateWorkFile", () => {
  test("accepts a slice", () => {
    expect(
      validateWorkFile({ status: "queued", summary: "s" }, "slice"),
    ).toEqual([]);
  });
  test("rejects next on an epic", () => {
    expect(
      validateWorkFile({ status: "next", summary: "s" }, "epic")[0],
    ).toContain("status");
  });
});

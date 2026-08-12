import { describe, expect, test } from "bun:test";
import { buildIndex } from "./docs-index";

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

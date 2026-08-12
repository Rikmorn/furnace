import { describe, expect, test } from "bun:test";
import type { WorkItem } from "./check-docs";
import { renderSitrep } from "./sitrep";

const slice = (
  slug: string,
  fm: Record<string, string>,
  epic?: string,
): WorkItem => ({
  slug,
  kind: "slice",
  file: epic ? `docs/work/${epic}/${slug}.md` : `docs/work/${slug}.md`,
  epic,
  fm,
});
const epic = (slug: string, fm: Record<string, string>): WorkItem => ({
  slug,
  kind: "epic",
  file: `docs/work/${slug}/README.md`,
  fm,
});

const TREE: WorkItem[] = [
  epic("cockpit", { status: "in-flight", summary: "the cockpit epic" }),
  slice(
    "f5-scale",
    { status: "queued", summary: "scale", after: "vocab" },
    "cockpit",
  ),
  slice("docs-system", {
    status: "in-flight",
    injected: "true",
    summary: "docs plumbing",
  }),
  slice("build-speed", {
    status: "queued",
    injected: "true",
    summary: "faster gate",
    after: "docs-system",
  }),
  slice("vocab", {
    status: "queued",
    injected: "true",
    summary: "more materials",
    after: "build-speed",
  }),
  slice("waiting", { status: "blocked-on-owner", summary: "needs a ruling" }),
];

const BACKLOG = [
  { topic: "dungeon", slug: "a", summary: "a" },
  { topic: "dungeon", slug: "b", summary: "b" },
  { topic: "infra", slug: "c", summary: "c", consumer: "docs-system" },
];

describe("renderSitrep", () => {
  const out = renderSitrep(TREE, BACKLOG);

  test("puts in-flight work under NOW", () => {
    expect(out).toContain("NOW");
    expect(out.slice(out.indexOf("NOW"), out.indexOf("QUEUE"))).toContain(
      "docs-system",
    );
  });

  test("surfaces blocked-on-owner items", () => {
    expect(out).toContain("blocked on you");
    expect(out).toContain("waiting");
  });

  test("says so explicitly when nothing is blocked on the owner", () => {
    const clear = renderSitrep(
      TREE.filter((i) => i.fm["status"] !== "blocked-on-owner"),
      BACKLOG,
    );
    expect(clear).toContain("nothing");
  });

  test("marks injected slices", () => {
    expect(out).toContain("INJECTED");
    expect(out).toContain("build-speed");
  });

  test("renders the after: chain in topological order", () => {
    const queue = out.slice(out.indexOf("QUEUE"), out.indexOf("EPICS"));
    expect(queue.indexOf("build-speed")).toBeLessThan(queue.indexOf("vocab"));
    expect(queue.indexOf("vocab")).toBeLessThan(queue.indexOf("f5-scale"));
  });

  test("shows the epic with its status", () => {
    expect(out.slice(out.indexOf("EPICS"))).toContain("cockpit");
    expect(out.slice(out.indexOf("EPICS"))).toContain("in-flight");
  });

  test("shows backlog pressure per topic and names consumer entries", () => {
    const pressure = out.slice(out.indexOf("BACKLOG PRESSURE"));
    expect(pressure).toContain("dungeon");
    expect(pressure).toContain("2");
    expect(pressure).toContain("docs-system");
  });

  test("omits sealed work — a slug absent from the tree never appears", () => {
    expect(out).not.toContain("f4.5-overlay-cockpit");
  });
});

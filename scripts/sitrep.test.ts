import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkItem } from "./check-docs";
import {
  collectReferenceDocs,
  type ReferenceDoc,
  renderSitrep,
} from "./sitrep";

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

// Deliberately synthetic slugs, same house family as check-docs.test.ts. A fixture that
// borrows a LIVE board slug rots the day that item seals — and these are pure-function
// fixtures, so coupling them to the board buys nothing to pay for that.
const TREE: WorkItem[] = [
  epic("stone-mill", { status: "in-flight", summary: "the stone-mill epic" }),
  slice(
    "iron-hinges",
    { status: "queued", summary: "hinges", after: "brass-lanterns" },
    "stone-mill",
  ),
  slice("oak-doors", {
    status: "in-flight",
    injected: "true",
    summary: "doors",
  }),
  slice("copper-pipes", {
    status: "queued",
    injected: "true",
    summary: "pipes",
    after: "oak-doors",
  }),
  slice("brass-lanterns", {
    status: "queued",
    injected: "true",
    summary: "lanterns",
    after: "copper-pipes",
  }),
  slice("slate-roof", {
    status: "blocked-on-owner",
    summary: "needs a ruling",
  }),
];

const BACKLOG = [
  { topic: "masonry", slug: "a", summary: "a" },
  { topic: "masonry", slug: "b", summary: "b" },
  { topic: "joinery", slug: "c", summary: "c", consumer: "oak-doors" },
];

const ref = (file: string, verified?: string): ReferenceDoc => ({
  file,
  verified,
});

const REFERENCE: ReferenceDoc[] = [
  ref("copper-pipes.md", "2026-03-04"),
  ref("oak-doors.md"),
  ref("slate-roof.md", "2026-01-09"),
  ref("shard/iron-hinges.md", "2026-07-22"),
];

describe("renderSitrep", () => {
  const out = renderSitrep(TREE, BACKLOG, REFERENCE);

  test("puts in-flight work under NOW", () => {
    expect(out).toContain("NOW");
    expect(out.slice(out.indexOf("NOW"), out.indexOf("QUEUE"))).toContain(
      "oak-doors",
    );
  });

  test("surfaces blocked-on-owner items", () => {
    expect(out).toContain("blocked on you");
    expect(out).toContain("slate-roof");
  });

  test("says so explicitly when nothing is blocked on the owner", () => {
    const clear = renderSitrep(
      TREE.filter((i) => i.fm["status"] !== "blocked-on-owner"),
      BACKLOG,
      REFERENCE,
    );
    expect(clear).toContain("nothing");
  });

  test("marks injected slices", () => {
    expect(out).toContain("INJECTED");
    expect(out).toContain("copper-pipes");
  });

  test("renders the after: chain in topological order", () => {
    const queue = out.slice(out.indexOf("QUEUE"), out.indexOf("EPICS"));
    expect(queue.indexOf("copper-pipes")).toBeLessThan(
      queue.indexOf("brass-lanterns"),
    );
    expect(queue.indexOf("brass-lanterns")).toBeLessThan(
      queue.indexOf("iron-hinges"),
    );
  });

  test("shows the epic with its status", () => {
    expect(out.slice(out.indexOf("EPICS"))).toContain("stone-mill");
    expect(out.slice(out.indexOf("EPICS"))).toContain("in-flight");
  });

  test("shows backlog pressure per topic and names consumer entries", () => {
    const pressure = out.slice(out.indexOf("BACKLOG PRESSURE"));
    expect(pressure).toContain("masonry");
    expect(pressure).toContain("2");
    expect(pressure).toContain("oak-doors");
  });

  test("omits sealed work — a slug absent from the tree never appears", () => {
    expect(out).not.toContain("f4.5-overlay-cockpit");
  });
});

describe("renderSitrep — reference freshness", () => {
  const out = renderSitrep(TREE, BACKLOG, REFERENCE);
  const block = out.slice(out.indexOf("REFERENCE FRESHNESS"));

  test("dates every stamped reference doc", () => {
    expect(block).toContain("slate-roof.md  verified 2026-01-09");
    expect(block).toContain("copper-pipes.md  verified 2026-03-04");
    expect(block).toContain("shard/iron-hinges.md  verified 2026-07-22");
  });

  test("sorts stamped docs oldest stamp first — the staleset reads top-down", () => {
    expect(block.indexOf("slate-roof.md")).toBeLessThan(
      block.indexOf("copper-pipes.md"),
    );
    expect(block.indexOf("copper-pipes.md")).toBeLessThan(
      block.indexOf("shard/iron-hinges.md"),
    );
  });

  test("marks an unstamped doc rather than omitting it", () => {
    expect(block).toContain("oak-doors.md  (unstamped)");
  });

  test("puts every unstamped doc after every stamped one", () => {
    expect(block.indexOf("oak-doors.md")).toBeGreaterThan(
      block.indexOf("shard/iron-hinges.md"),
    );
  });

  test("says so when the reference register is empty", () => {
    const bare = renderSitrep(TREE, BACKLOG, []);
    expect(bare.slice(bare.indexOf("REFERENCE FRESHNESS"))).toContain("(none)");
  });
});

describe("collectReferenceDocs", () => {
  const write = (root: string, rel: string, body: string) => {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  };

  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), "furnace-freshness-"));
    write(root, "engine-conventions.md", "---\nverified: 2026-02-11\n---\n# c");
    write(root, "core-modules.md", "# no frontmatter here\n");
    write(root, "editor/daemon.md", "---\nverified: 2026-05-06\n---\n# d");
    write(root, "editor/README.md", "# generated index\n");
    write(root, "editor/deep/buried.md", "---\nverified: 2026-06-01\n---\n# b");
    write(root, "notes.txt", "not markdown");
    return root;
  };

  test("reads the verified: stamp, and leaves an unstamped doc unstamped", () => {
    const docs = collectReferenceDocs(fixture());
    expect(docs).toContainEqual({
      file: "engine-conventions.md",
      verified: "2026-02-11",
    });
    expect(docs).toContainEqual({
      file: "core-modules.md",
      verified: undefined,
    });
  });

  test("reaches one subdirectory level, and no deeper", () => {
    const files = collectReferenceDocs(fixture()).map((d) => d.file);
    expect(files).toContain("editor/daemon.md");
    expect(files).not.toContain("editor/deep/buried.md");
  });

  test("skips a shard's README — a generated index is not a subsystem doc", () => {
    const files = collectReferenceDocs(fixture()).map((d) => d.file);
    expect(files).not.toContain("editor/README.md");
  });

  test("reads markdown only", () => {
    const files = collectReferenceDocs(fixture()).map((d) => d.file);
    expect(files).not.toContain("notes.txt");
  });
});

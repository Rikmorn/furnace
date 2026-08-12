// Docs-register integrity checks. Wired into `bun run check`.
// Canon for what these enforce: docs/reference/docs-system.md.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseFrontmatter,
  validateBacklogEntry,
  validateWorkFile,
} from "./docs-frontmatter.ts";
import { checkIndex } from "./docs-index.ts";

export const ROOT = join(import.meta.dir, "..");
export type Violation = {
  file: string;
  line: number;
  kind: string;
  detail: string;
};

// Matches repo-relative source/doc paths. `<` `>` deliberately excluded so
// template placeholders like docs/backlog/<topic>/<slug>.md never match.
const PATH_RE =
  /(?:docs|packages)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|rs|md|wgsl|json|html|toml|css)\b/g;
// A path immediately followed by ` (gone)` (optionally closing a backtick) is a
// deliberate dead citation — the register records that something was deleted.
const GONE = /^`? \(gone\)/;
// `git show <rev>:<path>` is commit-pinned — checked against history, not the working
// tree. Exempts the pinned path ALONE, not its whole line: an unrelated dead path sitting
// beside a git-show citation must still fail.
const GIT_SHOW = /git show [0-9A-Za-z_~^-]+[:^](?:[A-Za-z0-9_./-]+)?/g;

const gitShowSpans = (line: string): [number, number][] =>
  [...line.matchAll(GIT_SHOW)].map((m) => [
    m.index ?? 0,
    (m.index ?? 0) + m[0].length,
  ]);

export function scanDeadPaths(
  file: string,
  text: string,
  exists: (p: string) => boolean = (p) => existsSync(join(ROOT, p)),
): Violation[] {
  const out: Violation[] = [];
  text.split("\n").forEach((line, i) => {
    const pinned = gitShowSpans(line);
    for (const m of line.matchAll(PATH_RE)) {
      const p = m[0];
      const at = m.index ?? 0;
      if (pinned.some(([s, e]) => at >= s && at < e)) continue;
      if (GONE.test(line.slice(at + p.length))) continue;
      if (!exists(p))
        out.push({ file, line: i + 1, kind: "dead-path", detail: p });
    }
  });
  return out;
}

// file.ts plus a line number → banned in live registers (line numbers are
// guaranteed rot; cite symbols instead).
const FILE_LINE_RE = /[A-Za-z0-9_./-]+\.(?:ts|tsx|rs|wgsl):\d+\b/g;

export function scanFileLineCitations(file: string, text: string): Violation[] {
  const out: Violation[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(FILE_LINE_RE)) {
      out.push({ file, line: i + 1, kind: "file-line-citation", detail: m[0] });
    }
  });
  return out;
}

// <!-- derive: CMD -->VALUE<!-- /derive --> — VALUE is re-derived by running CMD
// (sh at repo root) and trimming. Deterministic commands only (sort, stable output).
// CMD comes from a TRACKED doc — same trust domain as the repo's own scripts.
const DERIVE_RE = /<!-- derive: (.+?) -->([\s\S]*?)<!-- \/derive -->/g;

export function checkDeriveMarkers(file: string, text: string): Violation[] {
  const out: Violation[] = [];
  for (const m of text.matchAll(DERIVE_RE)) {
    const cmd = m[1] ?? "";
    // A command in angle brackets is a placeholder, not a command — the same convention
    // PATH_RE uses to skip `docs/backlog/<topic>/<slug>.md`. Without it the canon cannot
    // document its own marker syntax: the doc that defines the mechanism is inside the
    // scanned set, so an illustrative example would be executed.
    if (/^<.*>$/.test(cmd.trim())) continue;
    const recorded = (m[2] ?? "").trim();
    const line = text.slice(0, m.index).split("\n").length;
    const proc = Bun.spawnSync(["sh", "-c", cmd], { cwd: ROOT });
    if (proc.exitCode !== 0) {
      out.push({
        file,
        line,
        kind: "derive-error",
        detail: `\`${cmd}\` exited ${proc.exitCode}`,
      });
      continue;
    }
    const actual = proc.stdout.toString().trim();
    if (actual !== recorded) {
      out.push({
        file,
        line,
        kind: "derive-drift",
        detail: `\`${cmd}\`: expected ${actual}, doc says ${recorded}`,
      });
    }
  }
  return out;
}

const LIVE_REGISTERS = ["docs/backlog", "docs/reference", "docs/work"];

export function collectLiveRegisterFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".md")) out.push(rel);
    }
  };
  for (const r of LIVE_REGISTERS) {
    if (existsSync(join(ROOT, r))) walk(r);
  }
  return out.sort();
}

/** Backlog entries must parse and satisfy the entry schema. `docs/backlog/README.md` is
 *  the generated index, not an entry, so it is exempt. */
export function checkBacklogFrontmatter(
  file: string,
  text: string,
): Violation[] {
  if (!file.startsWith("docs/backlog/") || file === "docs/backlog/README.md")
    return [];
  const fm = parseFrontmatter(text);
  if (!fm)
    return [
      {
        file,
        line: 1,
        kind: "no-frontmatter",
        detail: "entry has no frontmatter",
      },
    ];
  return validateBacklogEntry(fm).map((detail) => ({
    file,
    line: 1,
    kind: "frontmatter-schema",
    detail,
  }));
}

/** A parsed `docs/work/` record. A directory is an epic (its record is `README.md`); a
 *  `.md` file is a slice. Containment IS the parent edge — `epic` is derived from the
 *  path, never declared, so it cannot dangle. */
export type WorkItem = {
  slug: string;
  kind: "epic" | "slice";
  file: string;
  epic?: string | undefined;
  fm: Record<string, string>;
};

const WORK = "docs/work";

export function collectWorkItems(): WorkItem[] {
  const out: WorkItem[] = [];
  if (!existsSync(join(ROOT, WORK))) return out;
  const read = (rel: string) =>
    parseFrontmatter(readFileSync(join(ROOT, rel), "utf8")) ?? {};
  for (const e of readdirSync(join(ROOT, WORK), { withFileTypes: true })) {
    if (e.isDirectory()) {
      const file = `${WORK}/${e.name}/README.md`;
      out.push({
        slug: e.name,
        kind: "epic",
        file,
        fm: existsSync(join(ROOT, file)) ? read(file) : {},
      });
      for (const child of readdirSync(join(ROOT, WORK, e.name))) {
        if (!child.endsWith(".md") || child === "README.md") continue;
        out.push({
          slug: child.replace(/\.md$/, ""),
          kind: "slice",
          file: `${WORK}/${e.name}/${child}`,
          epic: e.name,
          fm: read(`${WORK}/${e.name}/${child}`),
        });
      }
    } else if (e.name.endsWith(".md")) {
      out.push({
        slug: e.name.replace(/\.md$/, ""),
        kind: "slice",
        file: `${WORK}/${e.name}`,
        fm: read(`${WORK}/${e.name}`),
      });
    }
  }
  // readdir order is the OS's, and the sitrep is rendered from this — sort so the board
  // is the same on every machine.
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export function checkWorkRegister(items: readonly WorkItem[]): Violation[] {
  const out: Violation[] = [];
  const slugs = new Set(items.map((i) => i.slug));

  for (const i of items) {
    for (const detail of validateWorkFile(i.fm, i.kind)) {
      out.push({ file: i.file, line: 1, kind: "frontmatter-schema", detail });
    }
    const after = i.fm["after"];
    if (after !== undefined && !slugs.has(after)) {
      out.push({
        file: i.file,
        line: 1,
        kind: "work-dangling-after",
        detail: `after: ${after} names no work item`,
      });
    }
  }

  const next = items.filter((i) => i.fm["status"] === "next");
  if (next.length > 1) {
    out.push({
      file: WORK,
      line: 1,
      kind: "work-multiple-next",
      detail: `${next.length} items hold next (${next.map((i) => i.slug).join(", ")}); at most one may`,
    });
  }

  // An in-flight epic must still own work. Deliberately the WEAK form: a child that is
  // merely `queued` counts, because an epic whose last slice is gated behind another
  // work item is legitimately in-flight with nothing running.
  for (const e of items.filter(
    (i) => i.kind === "epic" && i.fm["status"] === "in-flight",
  )) {
    if (!items.some((i) => i.kind === "slice" && i.epic === e.slug)) {
      out.push({
        file: e.file,
        line: 1,
        kind: "work-epic-no-children",
        detail: "epic is in-flight but owns no slice",
      });
    }
  }
  return out;
}

/** `consumer: <slug>` asserts that a named work item reads this entry — which is what
 *  protects it from consolidation. The assertion only means anything while that item is on
 *  the board, so it is checked against the live register: an entry whose consuming slice is
 *  not scheduled uses a prose trigger instead. Without this the field rots silently and in
 *  the one direction nobody is looking — a seal DELETES its work item, so the ritual that
 *  closes a slice is itself what dangles the pointers into it. */
export function checkConsumers(
  entries: ReadonlyMap<string, string>,
  workSlugs: ReadonlySet<string>,
): Violation[] {
  return [...entries]
    .filter(([, consumer]) => !workSlugs.has(consumer))
    .map(([file, consumer]) => ({
      file,
      line: 1,
      kind: "consumer-dangling",
      detail: `consumer: ${consumer} names no work item — re-point it, or drop it for a prose trigger`,
    }));
}

if (import.meta.main) {
  const violations: Violation[] = [];
  const consumers = new Map<string, string>();
  for (const f of collectLiveRegisterFiles()) {
    const text = readFileSync(join(ROOT, f), "utf8");
    const consumer = parseFrontmatter(text)?.["consumer"];
    if (consumer !== undefined) consumers.set(f, consumer);
    violations.push(
      ...scanDeadPaths(f, text),
      ...scanFileLineCitations(f, text),
      ...checkDeriveMarkers(f, text),
      ...checkBacklogFrontmatter(f, text),
    );
  }
  const work = collectWorkItems();
  violations.push(...checkWorkRegister(work));
  violations.push(
    ...checkConsumers(consumers, new Set(work.map((i) => i.slug))),
  );
  const indexDrift = checkIndex();
  if (indexDrift) {
    violations.push({
      file: "docs/backlog/README.md",
      line: 1,
      kind: "index-stale",
      detail: indexDrift,
    });
  }
  if (violations.length > 0) {
    for (const v of violations)
      console.error(`${v.file}:${v.line} [${v.kind}] ${v.detail}`);
    console.error(`\ncheck-docs: ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log("check-docs: clean.");
}

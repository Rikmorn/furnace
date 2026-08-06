import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// D-F4.5-25's tooltip clause, machine-enforced: a native `title` may carry a NAME, never
// documentation. Three things are wrong with a documented `title` and only the first is
// obvious — it is mouse-only (a Tab-focus gets nothing, on every browser), it cannot
// render a keycap (so a documented shortcut is hardcoded in prose, which is D-12's
// duplication problem in a second spelling), and its ~1 s delay and placement are the OS's
// rather than ours. `ActionTip` (components/ui/tips.tsx) is where a sentence goes.
//
// WHAT THIS SCAN CAN SEE, stated plainly because the boundary is the whole design: it
// reads AUTHORED TEXT — a string literal (`title="…"`), a braced string literal
// (`title={"…"}`) or an inline template (`title={`…${x}`}`). Those are where documentation
// actually gets written.
//
// A title whose value is an IDENTIFIER is invisible here and stays a review question. The
// complete list of those as of F4.5c Task 8, so a reader can check the residue rather than
// take its size on trust:
//   - StatusBar's `title={error}` — the clipped esbuild diagnostic itself;
//   - VecField / QuatField / AxisTriad `title={label}` — axis-letter echoes;
//   - inspector `fields/common.tsx`'s `RowCaption` `title={label}` — the caption's own text,
//     for the pointer, because `truncate` can clip it. Structurally the same name echo as
//     the two above, and on EVERY field row in the app rather than on one control;
//   - PaletteLayer ×2 `title={PALETTES[id].title}` — a palette's own name;
//   - LogPalette's `<time>` — an absolute timestamp;
//   - `ReasonTip`'s `title={props.reason}` — the mechanism a DISABLED control needs, which
//     takes neither hover nor focus, so no tooltip has a channel to it at all;
//   - FlagsPalette's `Tag` `title={title}` — the prop plumbing behind the one allowlisted
//     template below;
//   - BurgerMenu ×2 `title={action.hint}` — a menu item is already ↓-reachable and a
//     tooltip would fire on every arrow press.
const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

// components/ui/ is the vendored shadcn layer: it FORWARDS a `title` it never authors, so
// a literal appearing there would be an upstream string rather than one of ours.
const EXCLUDED_DIR = join("components", "ui");

/** A `title` that is a NAME is short. The ceiling stops the allowlist below from becoming
 *  somewhere to park sentences: an entry cannot be admitted by widening it a little.
 *
 *  It is a PROXY and an inexact one — `"stage 2's verdict on …"` is a documentation
 *  fragment that clears it at 22 characters — which is why it is the weaker of the two
 *  gates. The FILE BINDING is the real discriminator: `"advanced"` is a generic eight-
 *  character word that any chrome file could write, and pinning it to the one file that
 *  may write it is what the length can never do. */
const NAME_ECHO_MAX = 24;

/** Every authored `title` text left in the chrome: which file may write it, and why it is
 *  a name rather than documentation.
 *
 *  Three gates, and an entry has to clear all three — it must be listed, it must be short,
 *  and it must appear ONLY in the file named here. */
const ALLOWED = new Map<string, { file: string; why: string }>([
  [
    "Find a command",
    {
      file: "components/shell/CommandPalette.tsx",
      why: "a React prop (CommandDialog's sr-only accessible name), not a DOM attribute",
    },
  ],
  [
    "advanced",
    {
      file: "components/shell/session-card/AdvancedSection.tsx",
      why: "CollapsibleSection's `title` PROP — the section's visible heading",
    },
  ],
  [
    "Entities (…)",
    {
      file: "components/field/EntitiesList.tsx",
      why: "CollapsibleSection's `title` PROP — the section's visible heading",
    },
  ],
  [
    "re-roll the seed",
    {
      file: "components/shell/session-card/SeedRow.tsx",
      why: "the ⚄ button has no visible label, so this is its NAME for a mouse; the aria-label ('re-roll seed') already says everything to everyone else",
    },
  ],
  [
    "stage 2's verdict on …",
    {
      file: "components/shell/FlagsPalette.tsx",
      why: "on a NON-INTERACTIVE chip. A tooltip needs a focusable trigger, and giving a decoration a tab stop per row is a worse trade than a mouse-only note; the chip's SCOPE is already in its visible text (verdictLabel)",
    },
  ],
]);

/** The three authored forms. The left lookbehind is what keeps `menuTitle="…"` and
 *  `groupTitle="…"` from matching as though they were `title=` — neither exists today, and
 *  a false positive in the file that polices everyone else's honesty is the one bug this
 *  file cannot afford. Substitutions collapse to a single `…` so a template compares as
 *  one stable string. */
const TITLE_TEXT =
  /(?<![A-Za-z])title=(?:"([^"]*)"|\{"([^"]*)"\}|\{`([^`]*)`\})/g;

const authoredTitles = (text: string): string[] =>
  [...text.matchAll(TITLE_TEXT)].map((m) =>
    (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, "…"),
  );

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : [];
  });
}

const sources = (): { file: string; titles: string[] }[] =>
  walk(FRONTEND)
    .filter((f) => !relative(FRONTEND, f).startsWith(EXCLUDED_DIR))
    .map((f) => ({
      file: relative(FRONTEND, f),
      titles: authoredTitles(readFileSync(f, "utf8")),
    }))
    .filter((s) => s.titles.length > 0);

test("no authored `title` carries documentation (D-25)", () => {
  const offenders = sources().flatMap(({ file, titles }) =>
    titles
      .filter((t) => ALLOWED.get(t)?.file !== file)
      .map((t) => `${file}: ${t}`),
  );
  expect(offenders).toEqual([]);
});

test("the name-echo allowlist cannot absorb a sentence", () => {
  const tooLong = [...ALLOWED.keys()].filter((t) => t.length > NAME_ECHO_MAX);
  expect(tooLong).toEqual([]);
});

// The allowlist is a record of what SURVIVES, so a converted site must not leave its entry
// behind — otherwise the list drifts into "everything anyone ever wrote", which permits
// re-adding a title nobody re-argued for. Pinned to the FILE for the same reason: an entry
// whose file was renamed is as stale as one whose site was converted.
test("every allowlisted title is still where it says it is", () => {
  const found = sources();
  const stale = [...ALLOWED.entries()]
    .filter(
      ([title, { file }]) =>
        !found.some((s) => s.file === file && s.titles.includes(title)),
    )
    .map(([title, { file }]) => `${file}: ${title}`);
  expect(stale).toEqual([]);
});

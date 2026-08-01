import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// D-F4.5-25's tooltip clause, machine-enforced: a native `title` may carry a NAME, never
// documentation. Three things are wrong with a documented `title` and only the first is
// obvious — it is mouse-only (a Tab-focus gets nothing, on every browser), it cannot
// render a keycap (so a documented shortcut is hardcoded in prose, which is D-12's
// duplication problem in a second spelling), and its ~1 s delay and placement are the OS's
// rather than ours. `ActionTip` (components/field/form-bits.tsx) is where a sentence goes.
//
// WHAT THIS SCAN CAN SEE, stated plainly because the boundary is the whole design: it
// reads AUTHORED TEXT — a string literal (`title="…"`) or an inline template
// (`title={`…${x}`}`). Those are where documentation actually gets written. A title whose
// value is an IDENTIFIER (`title={error}`, `title={label}`, `title={props.reason}`,
// `title={action.menuTitle}`) is invisible here and is a review question; the survivors as
// of F4.5c Task 8 are the status bar's clipped esbuild error, the two vector fields' and
// the axis triad's axis-letter echoes, the palette chips' own names, a `<time>`'s absolute
// timestamp, `ReasonTip`'s wrapper (a DISABLED control takes neither hover nor focus, so a
// tooltip has no channel to it at all) and the burger's `menuTitle` (a tooltip on a menu
// item would fire on every arrow press).
const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

// components/ui/ is the vendored shadcn layer: it FORWARDS a `title` it never authors, so
// a literal appearing there would be an upstream string rather than one of ours.
const EXCLUDED_DIR = join("components", "ui");

/** A `title` that is a NAME is short — that is the whole distinction this file draws, and
 *  the ceiling is what stops the allowlist below from becoming somewhere to park
 *  sentences. Set two characters above the longest survivor ("stage 2's verdict on …", 22)
 *  so it BITES: an entry cannot be added by widening it a little. */
const NAME_ECHO_MAX = 24;

/** Every authored `title` text left in the chrome, with why it is a name rather than
 *  documentation. Membership is one half of the gate and the ceiling above is the other:
 *  an entry that is long fails even when it is listed. */
const ALLOWED = new Map<string, string>([
  [
    "Find a command",
    "CommandPalette — a React prop (CommandDialog's sr-only accessible name), not a DOM attribute",
  ],
  [
    "advanced",
    "AdvancedSection — CollapsibleSection's `title` PROP, the section's visible heading",
  ],
  [
    "Entities (…)",
    "EntitiesList — CollapsibleSection's `title` PROP, the section's visible heading",
  ],
  [
    "re-roll the seed",
    "SeedRow — the ⚄ button has no visible label, so this is its NAME for a mouse; the aria-label ('re-roll seed') already says everything to everyone else",
  ],
  [
    "stage 2's verdict on …",
    "FlagsPalette — on a NON-INTERACTIVE chip. A tooltip needs a focusable trigger, and giving a decoration a tab stop per row is a worse trade than a mouse-only note; the chip's SCOPE is already in its visible text (verdictLabel)",
  ],
]);

/** `title="…"` and `title={`…`}` — the two forms whose text is written in the file.
 *  Substitutions collapse to a single `…` so a template compares as one stable string. */
const TITLE_TEXT = /title=(?:"([^"]*)"|\{`([^`]*)`\})/g;

const authoredTitles = (text: string): string[] =>
  [...text.matchAll(TITLE_TEXT)].map((m) =>
    (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, "…"),
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
    titles.filter((t) => !ALLOWED.has(t)).map((t) => `${file}: ${t}`),
  );
  expect(offenders).toEqual([]);
});

test("the name-echo allowlist cannot absorb a sentence", () => {
  const tooLong = [...ALLOWED.keys()].filter((t) => t.length > NAME_ECHO_MAX);
  expect(tooLong).toEqual([]);
});

// The allowlist is a record of what SURVIVES, so a converted site must not leave its entry
// behind — otherwise the list drifts into "everything anyone ever wrote", which permits
// re-adding a title nobody re-argued for.
test("every allowlisted title is still in the tree", () => {
  const present = new Set(sources().flatMap((s) => s.titles));
  const stale = [...ALLOWED.keys()].filter((t) => !present.has(t));
  expect(stale).toEqual([]);
});

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Radix's Popover content is a `role="dialog"`, and Radix names NEITHER of them for you —
// unlike its Dialog, which throws a console error when `DialogTitle` is missing. So a
// popover ships announcing itself as a bare "dialog" unless the author says otherwise, and
// nothing in the toolchain notices: it type-checks, it renders, it passes every behavioural
// test, and only a screen reader ever finds out.
//
// The F4.5c re-critique measured this the only way it can be measured — Chrome's own AX
// engine over the running app (CDP `Accessibility.getFullAXTree`), which reported
// `role="dialog"` with `name: ""` on the view popover. Three of the four popovers in the
// chrome were unnamed; the fourth (`StatusBar`'s stats chips) had been named at Task 3 and
// is the precedent this scan generalises: the CONTENT takes the TRIGGER's name, so the
// dialog a reader lands in is identifiable as the thing they just opened.
//
// WHY A SCAN AND NOT A RENDER TEST. Both, in fact — the DOM assertions live beside the
// overlays they cover. But a render test only ever covers the popovers someone remembered
// to open, and that is exactly how three of these survived a whole stage: `ToolRail`'s
// member flyout and `StripOverflow`'s ⋯ both HAVE test files, and neither file asked about
// the dialog's name. A scan asks about every one of them, including the next one.
//
// WHAT IT CANNOT SEE, stated so the residue is legible rather than assumed: it checks that
// a name is DECLARED, never that the name is good. `aria-label="dialog"` would pass. The
// value is a review question; the ABSENCE is not, and the absence is what shipped.
const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

// components/ui/ is the vendored shadcn layer. `PopoverContent` is DEFINED there and
// forwards whatever props it is given, so the definition itself carries no name and must
// not be read as an offender.
const EXCLUDED_DIR = join("components", "ui");

/** The opening tag of `<PopoverContent …>`, returned as its attribute text.
 *
 *  Hand-scanned rather than regexed because the attribute lists here contain BRACES with
 *  nested braces and strings (`{...focusReturn.overlay}`, `` {`${row.group} tools`} ``), and
 *  a lazy `<PopoverContent[^>]*>` stops at the first `>` inside a template or a generic —
 *  which would silently truncate the very attribute it is looking for and report a false
 *  PASS. Depth-tracking over `{}` with quote awareness is the smallest thing that is exact.
 */
function openingTags(text: string, tag: string): string[] {
  const out: string[] = [];
  const needle = `<${tag}`;
  for (
    let i = text.indexOf(needle);
    i !== -1;
    i = text.indexOf(needle, i + 1)
  ) {
    // `<PopoverContentFoo` is a different component; only a boundary char ends the name.
    const after = text[i + needle.length];
    if (after !== undefined && /[A-Za-z0-9_]/.test(after)) continue;
    let depth = 0;
    let quote: string | null = null;
    let j = i + needle.length;
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote !== null) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(text.slice(i + needle.length, j));
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

const popoverContents = (): { file: string; attrs: string }[] =>
  walk(FRONTEND)
    .filter((f) => !relative(FRONTEND, f).startsWith(EXCLUDED_DIR))
    .flatMap((f) =>
      openingTags(readFileSync(f, "utf8"), "PopoverContent").map((attrs) => ({
        file: relative(FRONTEND, f),
        attrs,
      })),
    );

const NAMED = /aria-label(?:ledby)?=/;

test("every popover's role=dialog carries an accessible name", () => {
  const unnamed = popoverContents()
    .filter(({ attrs }) => !NAMED.test(attrs))
    .map(({ file }) => file);
  expect(unnamed).toEqual([]);
});

// The scan is worth exactly what its parser is worth, so the parser is pinned separately.
// Both of these defeated the naive `[^>]*` form: the first ends its attribute list AFTER a
// `>` that sits inside a template literal, the second after one inside a generic argument.
test("the opening-tag scanner survives braces, templates and generics", () => {
  expect(
    openingTags(
      '<PopoverContent aria-label={`a > b`} className="x" />',
      "PopoverContent",
    ),
  ).toEqual([' aria-label={`a > b`} className="x" /']);
  expect(
    openingTags(
      "<PopoverContent {...spread}>body</PopoverContent>",
      "PopoverContent",
    ),
  ).toEqual([" {...spread}"]);
  // A longer component name that merely starts with the same letters is not this tag.
  expect(openingTags("<PopoverContentExtra a>", "PopoverContent")).toEqual([]);
});

// The count is asserted so that a refactor which DELETES every popover cannot turn this
// file green by emptying it — the classic way a scan becomes vacuous without anyone
// touching it. Four is the chrome's inventory today: the stats chip, the view popover, the
// tool-rail member flyout, and the tool-strip ⋯.
test("the scan is looking at the popovers it claims to cover", () => {
  expect(
    popoverContents()
      .map((p) => p.file)
      .sort(),
  ).toEqual([
    "components/shell/StatusBar.tsx",
    "components/shell/StripOverflow.tsx",
    "components/shell/ToolRail.tsx",
    "components/shell/ViewPopover.tsx",
  ]);
});

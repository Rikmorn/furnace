import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The completeness half of the conditional viewport focus return (F4.5c Task 10), made
// structural rather than promised.
//
// The costing note this work came from ends with the reason: *"a version wired into two of
// the six overlays would be worse than none, because the inconsistency is exactly what
// makes a focus rule unlearnable."* A user learns "dismiss it and I keep flying" from three
// surfaces and then meets a fourth that drops them on `<body>`; what they take away is that
// the editor is unreliable, which is worse than a rule they never had. The behaviour of the
// hook is pinned in tests/chrome/viewport-focus-return.test.tsx — this file pins that every
// overlay HAS it, so a surface added in a later slice fails here instead of shipping the
// inconsistency.
//
// PER OCCURRENCE, not per file, and that is the realistic regression: `WorldDrawer.tsx`
// already renders two of these (the drawer and each row's ⋯ menu), so a file-level check
// would go green the moment ONE of them was wired and stay green when a third arrived.
const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

// components/ui/ is the vendored shadcn layer: those files DEFINE the wrappers below and
// forward the props, so every match in there is the primitive rather than a use of it.
const EXCLUDED_DIR = join("components", "ui");

/** The dismissible-surface wrappers: the three Radix families that MOVE FOCUS on open and
 *  restore it on close, plus the command palette's own dialog.
 *
 *  Two chrome surfaces are deliberately absent, and both are absent because they move no
 *  focus at all rather than because nobody got to them:
 *    - `CollapsibleSection` (the session card's `advanced`) is a DISCLOSURE. The trigger
 *      keeps focus through the open and the close, Radix has nothing to restore, and a
 *      return here would take focus OFF the control the user is working with. Its own file
 *      carries the argument.
 *    - `SelectContent` (the inspector's `EnumField`) is a form control inside a palette,
 *      and Radix Select owns its focus end to end — it exposes neither of these props, so
 *      there is no seam to wire even if the rule applied. A user editing a field in a panel
 *      came from the panel.
 *  Adding either to this list is a design change, not a bookkeeping one. */
const OVERLAY_CONTENT =
  /<(PopoverContent|DialogContent|DropdownMenuContent|CommandDialog)\b/g;

/** The two spellings a wired site may use: the spread, and the named open handler for the
 *  three sites that cannot spread — the two Radix MENUS, which take the record from
 *  `onOpenChange` because a menu does not expose `onOpenAutoFocus` at all, and the burger,
 *  which additionally owns an `onCloseAutoFocus` of its own for the hand-off. Both spellings
 *  count as one, because each marks exactly one wired overlay. */
const WIRED = /\{\.\.\.focusReturn\}|focusReturn\.onOpenAutoFocus/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

const counted = (): { file: string; overlays: number; wired: number }[] =>
  walk(FRONTEND)
    .filter((f) => !relative(FRONTEND, f).startsWith(EXCLUDED_DIR))
    .map((f) => {
      const text = readFileSync(f, "utf8");
      return {
        file: relative(FRONTEND, f),
        overlays: [...text.matchAll(OVERLAY_CONTENT)].length,
        wired: [...text.matchAll(WIRED)].length,
      };
    })
    .filter((c) => c.overlays > 0 || c.wired > 0);

test("every dismissible overlay in the chrome wires the viewport focus return", () => {
  const unwired = counted()
    .filter((c) => c.wired !== c.overlays)
    .map((c) => `${c.file}: ${c.overlays} overlay(s), ${c.wired} wired`);
  expect(unwired).toEqual([]);
});

// A count nobody can read is a count nobody notices going wrong. Ten is the whole set as of
// this task — the View popover, the rail's member flyout, the strip's ⋯, the two status
// chips' shared popover component, the burger, the shortcuts overlay, the confirm prompt,
// the ⌘K palette, the world drawer and each of its rows' ⋯ menu. A slice that adds an
// eleventh should have to say so here, in the same commit that adds it.
test("the overlay inventory is stated, so growth is deliberate", () => {
  const total = counted().reduce((n, c) => n + c.overlays, 0);
  expect(total).toBe(10);
});

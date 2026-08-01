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
// the editor is unreliable, which is worse than a rule they never had. The BEHAVIOUR is
// pinned in tests/chrome/viewport-focus-return.test.tsx — this file pins that every overlay
// HAS it, so a surface added in a later slice fails here instead of shipping the gap.
//
// PER SITE, not per file, and not by counting tokens. A file-level check goes green the
// moment ONE overlay in a multi-overlay file is wired (`WorldDrawer.tsx` renders two), and a
// bare token count is gameable — unwiring the drawer while leaving a stray `focusReturn`
// reference elsewhere in the file kept an earlier version of this test at 2 == 2 green while
// the behaviour was broken. What is checked now is that the overlay's OWN opening tag
// mentions it.
const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

// components/ui/ DEFINES the wrappers and forwards their props, so every match in there is
// the primitive rather than a use of it.
const UI = join("components", "ui");

/**
 * The overlay families, DERIVED from what `components/ui/` actually contains rather than
 * hand-listed — so a `SheetContent` or an `AlertDialogContent` added to the vendored layer
 * joins the required set automatically instead of being a whole family this guard cannot
 * see while the inventory below still reads a reassuring number. A new family is then
 * either wired at its call sites or explicitly exempted; both are deliberate acts, which is
 * the point.
 */
const uiWrappers = (): string[] => {
  const names = new Set<string>();
  for (const f of readdirSync(join(FRONTEND, UI))) {
    if (!f.endsWith(".tsx")) continue;
    const text = readFileSync(join(FRONTEND, UI, f), "utf8");
    for (const m of text.matchAll(/\b(\w+Content)\b/g))
      if (m[1] !== undefined) names.add(m[1]);
  }
  return [...names];
};

/** Wrappers that are NOT dismissible focus-moving surfaces. Each is a ruling rather than an
 *  oversight, and the shape of the reason is the same every time: nothing here takes focus
 *  on open, so there is nothing to hand back on close. */
const NOT_AN_OVERLAY = new Map<string, string>([
  [
    "CollapsibleContent",
    "a DISCLOSURE — the trigger keeps focus through the open and the close, Radix has nothing to restore, and a return would take focus OFF the control the user is working with (session-card/AdvancedSection.tsx carries the argument)",
  ],
  [
    "TooltipContent",
    "a tooltip is never focused and is not dismissed by the user; there is no close-autofocus seam on it to use",
  ],
  [
    "SelectContent",
    "a form control inside a palette, not a surface you navigate into and dismiss — a user editing a field came from the field. Radix Select also owns its focus end to end: it exposes `onCloseAutoFocus` but NOT `onOpenAutoFocus`, so there is no open edge at which to take a record",
  ],
  [
    "DropdownMenuSubContent",
    "a submenu, whose parent menu owns the dismissal. Radix hard-overrides both autofocus handlers on `MenuSubContent` (react-menu 2.1.20), so the seam is not ours to use — and no submenu exists in this chrome today",
  ],
  ["SubContent", "the local alias for DropdownMenuSubContent — see above"],
]);

/** Wrappers the derivation cannot see because they are not named `*Content`: composed
 *  surfaces of ours that render a Radix content underneath. */
const ALSO_AN_OVERLAY = ["CommandDialog"];

/** SITES that are exempt, keyed by file and wrapper. A site exemption is a much stronger
 *  claim than a family one — it says THIS overlay cannot reach the branch — so it states
 *  the construction that makes it true and what would falsify it. */
const EXEMPT_SITES = new Map<string, string>([
  [
    "components/shell/WorldDrawer.tsx:DropdownMenuContent",
    "the row's ⋯ menu lives INSIDE a modal dialog, so the gesture that opens it always begins on a control in the drawer and its answer would be no every time — a branch the product cannot take. Radix's own trigger restoration is the right answer here and the only safe one while the drawer's focus trap stands. Falsified the day the drawer stops being modal",
  ],
]);

/** How a site declares itself wired: any mention of the hook's result inside the overlay's
 *  own opening tag. Two spellings are in use and both are just `focusReturn` — the spread,
 *  and a named handler for the burger's menu, which composes its own close handler and
 *  takes the open record from `onOpenChange` because Radix does not expose
 *  `onOpenAutoFocus` on a menu at all. */
const WIRED = /focusReturn/;

/** JS comments removed first. The scanner below tracks quotes to find a tag's closing `>`,
 *  and the prose inside a JSX attribute comment carries apostrophes and backticks that would
 *  desynchronise it. Stripping is safe in the direction that matters: a mangled tag reads as
 *  UNWIRED and reddens this test — it can never read as wired. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** The opening tag starting at `from`, i.e. up to the `>` that closes it — tracking brace
 *  depth and quotes so a `>` inside an expression (`(e) => …`) or a string does not end it
 *  early. */
function openingTag(text: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return text.slice(from, i + 1);
  }
  return text.slice(from);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

type Site = { file: string; tag: string; wired: boolean; exempt: boolean };

function sites(): Site[] {
  const families = [
    ...uiWrappers().filter((n) => !NOT_AN_OVERLAY.has(n)),
    ...ALSO_AN_OVERLAY,
  ];
  const opener = new RegExp(`<(${families.join("|")})\\b`, "g");
  return walk(FRONTEND)
    .filter((f) => !relative(FRONTEND, f).startsWith(UI))
    .flatMap((f) => {
      const file = relative(FRONTEND, f);
      const text = stripComments(readFileSync(f, "utf8"));
      return [...text.matchAll(opener)].map((m) => {
        const tag = m[1] ?? "";
        return {
          file,
          tag,
          wired: WIRED.test(openingTag(text, m.index)),
          exempt: EXEMPT_SITES.has(`${file}:${tag}`),
        };
      });
    });
}

test("every dismissible overlay in the chrome wires the viewport focus return", () => {
  const unwired = sites()
    .filter((s) => !s.wired && !s.exempt)
    .map((s) => `${s.file}: <${s.tag}>`);
  expect(unwired).toEqual([]);
});

// An exemption that has stopped matching a real, still-unwired site is a rule about
// nothing — and the next reader would take it as evidence the site is handled that way.
test("every site exemption still names a real, still-unwired overlay", () => {
  const found = sites();
  const stale = [...EXEMPT_SITES.keys()].filter(
    (key) =>
      !found.some((s) => s.exempt && !s.wired && `${s.file}:${s.tag}` === key),
  );
  expect(stale).toEqual([]);
});

// A count nobody can read is a count nobody notices going wrong. Ten is the whole set as of
// this task — the View popover, the rail's member flyout, the strip's ⋯, the two status
// chips' shared popover component, the burger, the shortcuts overlay, the confirm prompt,
// the ⌘K palette, the world drawer, and its rows' ⋯ menu (the one exempt site). A slice that
// adds an eleventh should have to say so here, in the same commit that adds it.
test("the overlay inventory is stated, so growth is deliberate", () => {
  const all = sites();
  expect(all.length).toBe(10);
  expect(all.filter((s) => s.exempt).length).toBe(1);
});

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// D-23's THIRD vocabulary, machine-held. Colour and type already are (`design-tokens.test.ts`);
// focus was not, and the gap was measured rather than suspected: at the F4.5c re-critique,
// reverting the tool rail's ring, `ui/collapsible.tsx`'s ring and the AxisTriad's font ALL AT
// ONCE left `bun test packages/editor` at 1288 pass / 0 fail. Three fixes, no net. The only
// ring assertions in the suite were two incidental ones in `material-swatches.test.tsx` and
// `tool-strip.test.tsx`, neither of which is about the vocabulary.
//
// WHY A CLASS-STRING SCAN IS THE RIGHT INSTRUMENT HERE, given that the defect it is about is a
// RENDERING one. It is not the whole instrument and does not pretend to be — happy-dom runs no
// layout and resolves no styles, so nothing in `bun test` can see a ring. What a scan CAN hold
// is the authored vocabulary, and every one of the three defects was an authoring fact: a
// missing class, a wrong class, an overriding attribute. The pixels are proven once, by hand,
// in headless Chrome; this file is what stops them silently un-proving themselves later.
//
// The sibling scans this is modelled on all live in `design-tokens.test.ts`. This one is its
// own file because it holds the CLASS vocabulary, and that is a different instrument from the
// arithmetic: the ring's COLOUR is a token question and is pinned next door (`--ring` must not
// resolve to `--primary`, and must clear 3:1 on every fill it can abut). Here we only hold
// which classes may be written.
//
// IT USED TO CARRY A LEDGER TOO, and the ledger is gone rather than mislaid. THIS PARAGRAPH IS
// THE ONLY TELLING OF THAT IN THIS FILE — the two docstrings below point at it rather than
// repeating it, because three copies of one obituary rot together and none of them is the
// source. (The token decision itself lives in `styles.css`'s `--ring` block, which is where the
// colour is; this is only about what the retirement left behind here.)
//
// `RING_OVER_OWN_FILL` tracked the controls whose focus ring sat on a fill of the ring's own
// colour — the default button, the selected segment, a checked checkbox, the armed tool — which
// was a real defect class for exactly as long as `--ring` was `var(--primary)`: a 1 px outset
// ring in the fill's own colour does not read as a ring, it reads as the control getting 1 px
// bigger. The open question the ledger's `offset` column existed for was whether to offset all
// four or to move the token. The F4.5c holistic gate moved the token AND rejected the piecemeal
// offset variant in the same ruling, so the premise is false and the rows are not findings any
// more. What survived the retirement is the part that is still true — those controls have
// coloured fills and must keep declaring the house ring, which is now a neutral — and it moved
// into `MUST_DECLARE_HOUSE_RING` at the bottom.
const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

/** JS/JSX comments removed before scanning. Every rule below matches a class NAME, and this
 *  file's own prose is full of them — as is `ui/button.tsx`, which spells out the offset ban
 *  it is documenting, and `ui/dialog.tsx`, which quotes stock shadcn's `focus:ring-2
 *  ring-offset-2` in order to reject it. A naive substring search reads all three as
 *  offenders. Stripping can only ever LOSE text, so it under-reports rather than over-reports:
 *  a mangled file drops matches, it never invents them. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });
}

const sources = (root: string): { file: string; src: string }[] =>
  walk(root).map((f) => ({
    file: relative(FRONTEND, f),
    src: stripComments(readFileSync(f, "utf8")),
  }));

/** The anti-vacuity floor. Every test below is a `filter(...).toEqual([])`, which is exactly
 *  the shape that goes quiet when the corpus empties — a mistyped root, a `walk` that stops
 *  recursing, an extension filter that stops matching `.tsx`. Two of this slice's nineteen
 *  could-not-fail assertions were of that kind, so the guard is asserted rather than assumed,
 *  and it is asserted in EVERY test rather than once: a shared corpus computed at module load
 *  would make one guard cover cases that no longer read it. */
const CORPUS_FLOOR = 50;

// ── the ban ────────────────────────────────────────────────────────────────────────────────

/** Any `focus-visible:ring-*`, captured so the size/colour token can be read off it.
 *
 *  `/g` HERE IS REQUIRED AND SAFE, unlike on `RING_OFFSET` below — the two are worth reading
 *  together. `matchAll` demands the flag and clones the regex per call rather than advancing
 *  this one, so no `lastIndex` survives between files; `.test()` advances the regex itself,
 *  which is the bug that flag caused down there. Any new rule in this file should reach for
 *  `matchAll`/`match`, or declare without `/g`. */
const FOCUS_RING = /focus-visible:ring-([a-z0-9-]+)/g;

/** The house pair, and the ONE sanctioned widening.
 *
 *  `ring-4` is `MaterialSwatches`', and its reason is mechanical rather than aesthetic: the
 *  swatch carries a 2 px SELECTION ring on the same CSS property, and `:focus-visible` outranks
 *  a plain class, so the house `ring-1` was SHRINKING the selected swatch's marker to 1 px on
 *  focus — focus making its own indicator smaller. Widening is what keeps focus additive.
 *
 *  NO OFFSET TOKEN IS SANCTIONED, and that absence is the F4.5c ruling made enforceable rather
 *  than an oversight. `offset-1` and `offset-background` were in here for the tool rail and went
 *  with the reason for them (file header), so a `focus-visible:ring-offset-*` anywhere now
 *  reddens the test below — which is what stops the patch coming back one control at a time. */
const SANCTIONED_RING = new Map<string, string>([
  ["1", "the house width"],
  ["ring", "the house colour (--ring)"],
  ["4", "MaterialSwatches only — see RING_WIDTH_EXCEPTIONS"],
]);

/** `focus-visible:ring-4` is legal in exactly one file. Pinned to the FILE rather than merely
 *  allowed as a token: "some file may widen its ring" is not a rule, "this one may, for this
 *  reason" is. */
const RING_WIDTH_EXCEPTIONS = new Map<string, string>([
  [
    "components/field/MaterialSwatches.tsx",
    "must out-rank its own 2 px selection ring",
  ],
]);

test("every focus ring is the house ring", () => {
  const found = sources(FRONTEND);
  expect(found.length).toBeGreaterThan(CORPUS_FLOOR);
  const offenders: string[] = [];
  for (const { file, src } of found) {
    for (const match of src.matchAll(FOCUS_RING)) {
      // `noUncheckedIndexedAccess` widens a capture group to `string | undefined`. The group is
      // not optional in the pattern, so the `undefined` branch is unreachable — but it is
      // narrowed rather than asserted away, because a `as string` here would be the compiler
      // being overruled on a file whose whole job is to not be overruled.
      const token = match[1];
      if (token === undefined) continue;
      if (!SANCTIONED_RING.has(token))
        offenders.push(`${file}: focus-visible:ring-${token}`);
      if (token === "4" && !RING_WIDTH_EXCEPTIONS.has(file))
        offenders.push(`${file}: widened its focus ring without a reason`);
    }
  }
  expect(offenders).toEqual([]);
});

// ── the offset exception ───────────────────────────────────────────────────────────────────

/** `ring-offset-*` in any form — the focus variant and the bare one alike.
 *
 *  DELIBERATELY NOT `/g`, and the flag's absence is a fix rather than an oversight. A global
 *  regex carries `lastIndex` across calls, and this one is used with `.test()` inside a
 *  `filter` — so the first file that MATCHED (the allowlisted `MaterialSwatches`) left the
 *  index mid-string and the very next file in `walk` order was tested from that offset, with
 *  its own offset classes invisible. Measured: a bare `ring-offset-2 ring-offset-background`
 *  in `components/field/form-bits.tsx` (the file immediately after `MaterialSwatches` in walk
 *  order) left this file at 4 pass / 0 fail, while the same sabotage in `DriftReport.tsx`
 *  reddened correctly. `readdirSync` order is not guaranteed, so WHICH file sat in the blind
 *  spot could move without anyone touching this test. Without the flag, `.test()` is
 *  stateless and every file is read from 0. */
const RING_OFFSET = /(?:focus-visible:)?ring-offset-[a-z0-9-]+/;

/** The offset is BANNED by default and this is the whole allowlist — ONE entry, and it is not
 *  a focus ring.
 *
 *  The ban's own sentence is in `ui/button.tsx`: stock shadcn offsets the ring by 2 px against
 *  `--background`, which paints a halo of the PAGE colour between a control and its ring —
 *  correct on a white page, a dark gash on every raised surface in this shell.
 *
 *  `MaterialSwatches` is the exception because the "gash" is the POINT there, and because it is
 *  not a focus ring at all despite the spelling: it fires on `activeId`, so it is the SELECTED
 *  marker, and a swatch's fill is an arbitrary material colour out of the project that would
 *  swallow a marker drawn flush against it. No token choice can reach an arbitrary colour, which
 *  is what makes the geometric answer the right one here and only here.
 *
 *  `ToolRail` WAS the second entry and is deliberately not one now. Its offset was a genuine
 *  focus ring's and it went with the alias it was compensating for (file header); measured at
 *  3× DPR before the fix, that button's focused and unfocused frames were indistinguishable.
 *  The ring on it is the plain house pair now, and what makes it visible is the token rather
 *  than the geometry. */
const RING_OFFSET_ALLOWED = new Map<string, string>([
  [
    "components/field/MaterialSwatches.tsx",
    "the SELECTION marker on an arbitrary material colour, not a focus ring",
  ],
]);

test("the ring offset stays banned everywhere it is not the point", () => {
  const found = sources(FRONTEND);
  expect(found.length).toBeGreaterThan(CORPUS_FLOOR);
  const offenders = found
    .filter(
      ({ file, src }) =>
        RING_OFFSET.test(src) && !RING_OFFSET_ALLOWED.has(file),
    )
    .map(({ file }) => file);
  expect(offenders).toEqual([]);
});

test("every allowlisted offset is still where it says it is", () => {
  // The allowlist records what SURVIVES. An entry whose site was normalised away, or whose file
  // was renamed, is as stale as one nobody re-argued for — and a stale allowlist quietly
  // re-permits the thing it was written to contain.
  const found = sources(FRONTEND);
  expect(found.length).toBeGreaterThan(CORPUS_FLOOR);
  const stale = [...RING_OFFSET_ALLOWED.keys()].filter(
    (file) => !found.some((s) => s.file === file && /ring-offset-/.test(s.src)),
  );
  expect(stale).toEqual([]);
});

// ── the controls that must not lose their ring ─────────────────────────────────────────────

/** Controls whose focus treatment is load-bearing and would otherwise revert unnoticed.
 *
 *  `ui/collapsible.tsx` is the reason this list exists. It re-exported the bare Radix primitive,
 *  so its trigger declared no focus treatment and Chrome painted its own — measured on the
 *  running app as `outline: rgb(210,212,215) auto 1px`, `box-shadow: none`, the only element in
 *  the tab order wearing the browser's ring instead of the editor's. Nothing failed when that
 *  was reverted.
 *
 *  THE FOUR COLOURED-FILL ROWS BELOW ARE THE RETIRED LEDGER'S ESTATE (file header). Each of the
 *  four wears a fill of the accent lane in one of its states, and each is now correct for
 *  exactly one reason — it declares the house ring and the house ring is a neutral. Drop the
 *  classes and the control has no focus state on its filled state, which is the same failure the
 *  ledger existed to catch minus the offset question. So the list survives under an assertion
 *  that is still TRUE, rather than under one that has become a fossil.
 *
 *  `segmented` is the sharpest of them and worth restating: its own source comment says it "is
 *  ONE tab stop with a roving tabindex, so arrowing between members moves focus with no other
 *  signal that it moved". Arrowing onto the SELECTED member is precisely where the ring is the
 *  only signal there is.
 *
 *  EACH ROW NAMES A CLASS STRING, NOT A FILE, and that is a repair rather than a flourish. The
 *  shape this inherited from the ledger was file-granular — "somewhere in this file there is a
 *  `focus-visible:ring-1`, and somewhere there is a `focus-visible:ring-ring`" — and
 *  `ToolRail.tsx` has THREE ring-declaring class strings: the armed tool's `BUTTON_CLASS`, the
 *  member flyout's tab, and the flyout's member buttons. Measured, not suspected: stripping the
 *  pair from `BUTTON_CLASS` — the armed tool, the control this whole ruling is about — left this
 *  file at 4 pass / 0 fail, because the other two answered the row on its behalf. The `anchor`
 *  is what pins a row to ONE literal, so the ring has to be on the same string as the classes
 *  that identify the control. */
interface HouseRingSite {
  /** A pattern the ring-carrying class string must ALSO match, tested against one string
   *  literal at a time — two classes only reach the same element if they are on the same
   *  string, which is the granularity the file-granular version lost.
   *
   *  TWO ROWS ANCHOR ON THE RING ITSELF (`^…$`) rather than on a neighbouring class, and that
   *  is what their source says rather than a weaker rule: the collapsible trigger and the
   *  segment each compose the house pair in as its own `cn()` argument, with the geometry in a
   *  different one. Both files have exactly one ring site, so neither was ever the vacuous
   *  row — the exact match is what keeps them from becoming one. */
  readonly anchor: RegExp;
  /** Which control this is, so a red names the thing that lost its ring rather than a path. */
  readonly why: string;
}

const HOUSE_RING_WIDTH = /focus-visible:ring-1/;
const HOUSE_RING_COLOUR = /focus-visible:ring-ring/;

const MUST_DECLARE_HOUSE_RING = new Map<string, HouseRingSite>([
  [
    "components/ui/collapsible.tsx",
    {
      anchor:
        /^focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring$/,
      why: "the section trigger, styled in ui/ so it cannot ship with the UA ring again",
    },
  ],
  [
    "components/ui/button.tsx",
    {
      anchor: /^inline-flex items-center justify-center/,
      why: "the cva BASE every variant inherits, `default`'s bg-primary fill included — ex-ledger",
    },
  ],
  [
    "components/ui/segmented.tsx",
    {
      anchor:
        /^focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring$/,
      why: "the selected segment, reached by arrow with no other cue — ex-ledger",
    },
  ],
  [
    "components/ui/checkbox.tsx",
    {
      anchor: /data-\[state=checked\]:bg-primary/,
      why: "the checked box's bg-primary fill — ex-ledger",
    },
  ],
  [
    "components/shell/ToolRail.tsx",
    {
      // The 32 px square is what separates the armed tool from the other two rings in that
      // file — the flyout tab is `h-6 w-8`, the flyout members are `flex flex-col`. The const
      // NAME cannot be the anchor: it is not inside the literal the anchor is matched against.
      anchor: /(?:^| )h-8 w-8(?: |$)/,
      why: "the armed tool's own BUTTON_CLASS — ex-ledger, and the one whose offset the ruling removed",
    },
  ],
]);

/** Every quoted string in a source file, delimiters stripped. Both spellings, because a class
 *  string that grew an interpolation would otherwise leave its row silently unmatched. */
const classStrings = (src: string): string[] =>
  [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? "");

test("every control whose focus ring is load-bearing still declares the house one", () => {
  // NOT "the controls that had to be GIVEN a ring", which this was called and which is false
  // for four of the five rows: only `collapsible` was ever missing one. The other four are here
  // because they sit on a coloured fill, and a name is what a red prints.
  const found = sources(FRONTEND);
  expect(found.length).toBeGreaterThan(CORPUS_FLOOR);
  const missing = [...MUST_DECLARE_HOUSE_RING]
    .filter(([file, { anchor }]) => {
      const source = found.find((s) => s.file === file);
      if (source === undefined) return true;
      return !classStrings(source.src).some(
        (cls) =>
          anchor.test(cls) &&
          HOUSE_RING_WIDTH.test(cls) &&
          HOUSE_RING_COLOUR.test(cls),
      );
    })
    .map(
      ([file, { why }]) =>
        `${file} (${why}): no one class string carries both this row's anchor and the house ring`,
    );
  expect(missing).toEqual([]);
});

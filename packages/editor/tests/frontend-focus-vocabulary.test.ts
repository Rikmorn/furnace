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
// The four sibling scans this is modelled on all live in `design-tokens.test.ts`. This one is
// its own file because it carries a LEDGER as well as a ban, and the ledger is the interesting
// half — see `RING_OVER_OWN_FILL`.
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

/** Any `focus-visible:ring-*`, captured so the size/colour token can be read off it. */
const FOCUS_RING = /focus-visible:ring-([a-z0-9-]+)/g;

/** The house pair, and the ONE sanctioned widening.
 *
 *  `ring-4` is `MaterialSwatches`', and its reason is mechanical rather than aesthetic: the
 *  swatch carries a 2 px SELECTION ring on the same CSS property, and `:focus-visible` outranks
 *  a plain class, so the house `ring-1` was SHRINKING the selected swatch's marker to 1 px on
 *  focus — focus making its own indicator smaller. Widening is what keeps focus additive. */
const SANCTIONED_RING = new Map<string, string>([
  ["1", "the house width"],
  ["ring", "the house colour (--ring)"],
  ["4", "MaterialSwatches only — see RING_WIDTH_EXCEPTIONS"],
  ["offset-1", "the fill exception — see RING_OVER_OWN_FILL"],
  ["offset-background", "the fill exception — see RING_OVER_OWN_FILL"],
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

/** `ring-offset-*` in any form — the focus variant and the bare one alike. */
const RING_OFFSET = /(?:focus-visible:)?ring-offset-[a-z0-9-]+/g;

/** The offset is BANNED by default and this is the whole allowlist.
 *
 *  The ban's own sentence is in `ui/button.tsx`: stock shadcn offsets the ring by 2 px against
 *  `--background`, which paints a halo of the PAGE colour between a control and its ring —
 *  correct on a white page, a dark gash on every raised surface in this shell.
 *
 *  Both exceptions are cases where the "gash" is the POINT, and they are different cases:
 *
 *  - `MaterialSwatches` — not a focus ring at all, despite the spelling. It fires on `activeId`,
 *    so it is the SELECTED marker, and a swatch's fill is an arbitrary material colour that
 *    would swallow a ring drawn flush against it.
 *  - `ToolRail` — a genuine focus ring, over a fill of the RING'S OWN COLOUR. `--ring` IS
 *    `--primary` and the armed tool is `bg-primary`, so with no offset the ring paints the
 *    colour the button already is: measured at 3x DPR, the focused and unfocused frames of the
 *    armed tool are indistinguishable, while an inactive rail button shows an unmistakable
 *    ring. Here the 1 px of `--background` is not a gash between a control and its ring, it is
 *    the only thing that makes the ring EXIST. */
const RING_OFFSET_ALLOWED = new Map<string, string>([
  [
    "components/field/MaterialSwatches.tsx",
    "the SELECTION marker on an arbitrary material colour, not a focus ring",
  ],
  [
    "components/shell/ToolRail.tsx",
    "a focus ring over a fill of the ring's own colour",
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
  RING_OFFSET.lastIndex = 0;
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

// ── the ledger ─────────────────────────────────────────────────────────────────────────────

/** Every control whose focus ring sits on a fill of the RING'S OWN COLOUR, and whether it has
 *  been given the offset that makes the ring visible there.
 *
 *  This is the defect class, not the defect: `--ring` is `--primary`, so ANY `bg-primary`
 *  control with the house ring has an invisible focus state. The tool rail is the one that was
 *  measured and fixed. The other three are REAL AND OPEN, and they are recorded here rather
 *  than in a comment because a comment is not a check — the F4.5c review's finding was that the
 *  residue had been deferred in prose only, where nothing would ever surface it again.
 *
 *  They are deliberately NOT fixed. The choice is one-or-other and it belongs to the same
 *  ruling as the rail's: give the offset to every `bg-primary` control, or take `--ring` off
 *  `--primary` and give focus a neutral of its own. Fixing three call sites piecemeal would
 *  spend the decision without making it.
 *
 *  `segmented` is the sharpest of the three and worth stating: its own source comment says it
 *  "is ONE tab stop with a roving tabindex, so arrowing between members moves focus with no
 *  other signal that it moved". Arrowing onto the SELECTED member is precisely where the ring
 *  is the only signal — and precisely where it is invisible. */
interface RingOverOwnFill {
  readonly file: string;
  /** Does it carry `ring-offset-*`, i.e. is the ring visible on the filled state? */
  readonly offset: boolean;
  readonly what: string;
}

const RING_OVER_OWN_FILL: readonly RingOverOwnFill[] = [
  {
    file: "components/shell/ToolRail.tsx",
    offset: true,
    what: "the armed tool — measured, fixed, pixel-proven",
  },
  {
    file: "components/ui/button.tsx",
    offset: false,
    what: "the `default` variant's bg-primary fill — OPEN, awaiting the ruling",
  },
  {
    file: "components/ui/segmented.tsx",
    offset: false,
    what: "the selected segment, reached by arrow with no other cue — OPEN",
  },
  {
    file: "components/ui/checkbox.tsx",
    offset: false,
    what: "the checked box's bg-primary fill — OPEN",
  },
];

test("the ring-over-own-fill ledger matches what the source actually does", () => {
  // Both directions matter. A `true` row going false is the tool rail's fix being reverted —
  // the case that had no net at all before this file. A `false` row going true is one of the
  // three open controls being fixed without the ruling that decides all four, which should
  // stop and be argued rather than land quietly.
  const found = sources(FRONTEND);
  expect(found.length).toBeGreaterThan(CORPUS_FLOOR);
  const actual = RING_OVER_OWN_FILL.map(({ file }) => {
    const s = found.find((f) => f.file === file);
    if (s === undefined)
      throw new Error(`ledger names a missing file: ${file}`);
    return { file, offset: /ring-offset-/.test(s.src) };
  });
  expect(actual).toEqual(
    RING_OVER_OWN_FILL.map(({ file, offset }) => ({ file, offset })),
  );
});

test("every control in the ledger really does declare a focus ring", () => {
  // Without this, a row whose control lost its ring entirely would still satisfy the ledger by
  // reading `offset: false` — the ledger would agree with a control that has no focus state at
  // all, which is a worse defect than the one it is tracking.
  const found = sources(FRONTEND);
  expect(found.length).toBeGreaterThan(CORPUS_FLOOR);
  const ringless = RING_OVER_OWN_FILL.filter(
    ({ file }) =>
      !found.some(
        (s) =>
          s.file === file &&
          /focus-visible:ring-1/.test(s.src) &&
          /focus-visible:ring-ring/.test(s.src),
      ),
  ).map(({ file }) => file);
  expect(ringless).toEqual([]);
});

// ── the controls that must not lose their ring ─────────────────────────────────────────────

/** Controls whose focus treatment was ADDED as a fix and would otherwise revert unnoticed.
 *
 *  `ui/collapsible.tsx` is the reason this list exists. It re-exported the bare Radix primitive,
 *  so its trigger declared no focus treatment and Chrome painted its own — measured on the
 *  running app as `outline: rgb(210,212,215) auto 1px`, `box-shadow: none`, the only element in
 *  the tab order wearing the browser's ring instead of the editor's. Nothing failed when that
 *  was reverted. */
const MUST_DECLARE_HOUSE_RING = new Map<string, string>([
  [
    "components/ui/collapsible.tsx",
    "styled in ui/ so a section trigger cannot ship with the UA ring again",
  ],
]);

test("the controls that had to be given a ring still declare one", () => {
  const found = sources(FRONTEND);
  expect(found.length).toBeGreaterThan(CORPUS_FLOOR);
  const missing = [...MUST_DECLARE_HOUSE_RING.keys()].filter(
    (file) =>
      !found.some(
        (s) =>
          s.file === file &&
          /focus-visible:ring-1/.test(s.src) &&
          /focus-visible:ring-ring/.test(s.src),
      ),
  );
  expect(missing).toEqual([]);
});

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// D-23's contrast floor and type scale, machine-pinned. The chrome's palette is a handful
// of OKLCH literals in one file, and "is this pair readable?" is arithmetic on them — so it
// is a test rather than a review question that decays.
//
// WHY THE CSS IS PARSED AS TEXT rather than measured in a rendered tree: the chrome's test
// environment is happy-dom, which runs no layout and resolves no styles, so
// `getComputedStyle` there reports the authored string and never a colour. There is no DOM
// in this suite that can tell us what a pixel would be. The tokens are static literals,
// which is what makes the text path exact rather than a compromise.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. It proves the TOKEN PAIRS meet WCAG 1.4.3. It does
// NOT prove any element actually wears the pair asserted here — arithmetic cannot see a
// component that puts `text-warning` on a surface this file never named. The pairs below
// are therefore taken from the SITES that exist (grep `text-warning` / `text-success` /
// `text-destructive-text`), and every surface a tone is used on is asserted, not just the
// darkest one.
//
// TRANSLUCENT fills get their own section near the bottom. Their painted colour depends on
// a compositing space this file cannot settle headlessly, so those pairs are asserted
// against the WORSE of the two plausible assumptions rather than against a single number.

const STYLES = join(import.meta.dir, "..", "src", "frontend", "styles.css");
const FRONTEND = join(import.meta.dir, "..", "src", "frontend");

// ── OKLCH → sRGB → WCAG relative luminance ─────────────────────────────────────────
// Björn Ottosson's Oklab matrices (https://bottosson.github.io/posts/oklab/), then the sRGB
// transfer function, then WCAG 2.x relative luminance. The round trip THROUGH the
// gamma-encoded, CLAMPED sRGB channel is deliberate: an out-of-gamut OKLCH does not render
// as its unclamped linear value, it renders as the clamped one, and the clamped one is what
// a reader's eye gets.

/** OKLCH (L 0..1, C, H degrees) → linear-sRGB triple, unclamped. */
function oklchToLinearSrgb(
  L: number,
  C: number,
  H: number,
): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Linear channel → gamma-encoded sRGB, clamped to the displayable [0,1]. */
function encodeSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

/** Gamma-encoded sRGB → linear, the WCAG spelling. */
function decodeSrgb(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The 0..255 sRGB triple an OKLCH colour renders as. Only the anchor test needs the
 *  bytes; everything else goes straight to luminance. */
function toRgb255(L: number, C: number, H: number): [number, number, number] {
  const [r, g, b] = oklchToLinearSrgb(L, C, H);
  return [
    Math.round(encodeSrgb(r) * 255),
    Math.round(encodeSrgb(g) * 255),
    Math.round(encodeSrgb(b) * 255),
  ];
}

/** WCAG relative luminance of an OKLCH colour, via the clamped sRGB it renders as. */
function luminance(L: number, C: number, H: number): number {
  const [r, g, b] = oklchToLinearSrgb(L, C, H);
  return (
    0.2126 * decodeSrgb(encodeSrgb(r)) +
    0.7152 * decodeSrgb(encodeSrgb(g)) +
    0.0722 * decodeSrgb(encodeSrgb(b))
  );
}

/** WCAG contrast ratio between two luminances, 1..21. */
function ratio(l1: number, l2: number): number {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test("the colour converter agrees with the sRGB primaries", () => {
  // Without this, every ratio below is a number produced by ~30 lines of transcribed matrix
  // constants that nothing checks. The anchors are the CSS Color 4 / Oklab values for the
  // sRGB primaries, which must round-trip to the corners of the cube exactly.
  //
  // ITS RESOLUTION, measured rather than assumed: perturbing a matrix constant by ≥ ~9e-4
  // reddens here, while ≤ ~1e-4 does not. That residue is immaterial — a coefficient error
  // that small cannot move a rendered 8-bit channel or a 2 dp ledger entry — but the claim
  // is "a transcription slip", not "any digit anywhere". The 18-entry ledger `toEqual` below
  // is the second net, and it is the tighter one.
  expect(toRgb255(0.62796, 0.25768, 29.23)).toEqual([255, 0, 0]);
  expect(toRgb255(0.86644, 0.29483, 142.5)).toEqual([0, 255, 0]);
  expect(toRgb255(0.45201, 0.31322, 264.05)).toEqual([0, 0, 255]);
  expect(toRgb255(1, 0, 0)).toEqual([255, 255, 255]);
  expect(toRgb255(0, 0, 0)).toEqual([0, 0, 0]);
  // A zero-chroma colour has to stay achromatic through the whole round trip.
  const [r, g, b] = toRgb255(0.5, 0, 0);
  expect([g, b]).toEqual([r, r]);
  // And the WCAG formula's own extreme.
  expect(ratio(luminance(1, 0, 0), luminance(0, 0, 0))).toBeCloseTo(21, 6);
});

// ── the tokens ─────────────────────────────────────────────────────────────────────

const css = readFileSync(STYLES, "utf8");

/** Every `--name: oklch(L C H);` in the file, plus one level of `--name: var(--other);`
 *  indirection (which is how `@theme inline`'s `--color-*` bridge lines are spelled — and how
 *  `--ring` was spelled until the F4.5c holistic gate gave focus its own literal). A chain
 *  deeper than one resolves to nothing here rather than to something wrong, and every lookup
 *  below throws on a miss. */
function parseTokens(source: string): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  for (const m of source.matchAll(
    /--([a-z-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g,
  )) {
    out.set(`--${m[1]}`, [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  for (const m of source.matchAll(/--([a-z-]+):\s*var\(\s*(--[a-z-]+)\s*\)/g)) {
    const target = out.get(m[2] as string);
    // `@theme inline`'s `--color-*: var(--*)` bridge lines land here too, which is
    // harmless — they alias the same values under a second name.
    if (target !== undefined) out.set(`--${m[1]}`, target);
  }
  return out;
}

const tokens = parseTokens(css);

function lum(name: string): number {
  const t = tokens.get(name);
  if (t === undefined) throw new Error(`no such token in styles.css: ${name}`);
  return luminance(t[0], t[1], t[2]);
}

/** The measured ratio for a pair, EXACT. Every floor assertion uses this one.
 *
 *  Separate from {@link contrast} because rounding defeats a floor at exactly the boundary
 *  that matters, and this file found that out by sabotage rather than by reading: darkening
 *  `--destructive` to 0.52 puts its border at 2.9953:1 against `--popover`, which
 *  `Math.round(…* 100) / 100` turns into a 3.00 that sails through `>= 3`. The same trap sits
 *  one step away on the text floor — a 0.57 destructive hover measures 4.4979:1 and rounds
 *  to a reassuring 4.50. Round for the ledger; never for a gate. */
function rawContrast(fg: string, bg: string): number {
  return ratio(lum(fg), lum(bg));
}

/** The measured ratio at the 2 dp the ledger and DESIGN.md quote. LEDGER ONLY — see
 *  {@link rawContrast} for why a floor must never be asserted against this. */
function contrast(fg: string, bg: string): number {
  return Math.round(ratio(lum(fg), lum(bg)) * 100) / 100;
}

/** WCAG 1.4.3 AA for body-size text. The chrome's type runs SMALL, so this is the floor
 *  everywhere — the 3:1 large-text relaxation needs 18.66 px bold or 24 px, and nothing in
 *  this shell is that. */
const AA = 4.5;

test("the parser found the ramp it is about to measure", () => {
  // Guards the whole file against a silent regex miss: a rename that made `parseTokens`
  // return an empty map would leave `lum` throwing rather than passing vacuously, and
  // this states that out loud instead of relying on it.
  expect(tokens.size).toBeGreaterThan(15);
  expect(tokens.get("--background")).toEqual([0.16, 0.005, 250]);
  // The one-level alias resolves rather than going missing. `--ring` used to be this
  // file's example of it and is deliberately no longer one — see the focus-ring section
  // below — so the coverage moves to `@theme inline`'s bridge lines, which are where the
  // `--x: var(--y)` spelling still lives and are the reason the branch exists at all.
  expect(tokens.get("--color-primary")).toEqual(tokens.get("--primary"));
});

test("body text clears AA on every surface of the ramp", () => {
  for (const surface of ["--background", "--card", "--popover"]) {
    expect(rawContrast("--foreground", surface)).toBeGreaterThanOrEqual(AA);
  }
  // The secondary tier is held to the same floor rather than exempted: it carries real
  // copy (timestamps, counts, hints), not just disabled states.
  expect(rawContrast("--muted-foreground", "--card")).toBeGreaterThanOrEqual(
    AA,
  );
});

test("error text clears AA on the surfaces it is used on", () => {
  // `--destructive-text` sites: toast + log rows (--popover); status bar, world drawer,
  // palettes, inspector field errors (--card). The FILL it split from does NOT clear the
  // floor as text (see the ledger) — that gap is the whole reason the token exists.
  for (const surface of ["--card", "--popover"]) {
    expect(rawContrast("--destructive-text", surface)).toBeGreaterThanOrEqual(
      AA,
    );
  }
});

test("warning text clears AA on the surfaces it is used on", () => {
  // `text-warning` sites: the toast row (--popover); the log row, the session card's
  // stale notice and the flags palette's info dot (--card).
  //
  // This is the assertion that CANCELLED a planned `--warning-text`: the F4.5c plan
  // expected the amber to measure under the floor as text the way `--destructive` did,
  // and it does not (see the ledger). A second token for a pair that already passes
  // would be surface bought with nothing.
  for (const surface of ["--card", "--popover"]) {
    expect(rawContrast("--warning", surface)).toBeGreaterThanOrEqual(AA);
  }
});

test("success text clears AA on the surfaces it is used on", () => {
  // `text-success-text` sites: the toast row (--popover); the log row and the world
  // drawer's tracked badge (--card); the flags palette's `clear` verdict chip (a tinted
  // surface, which the chip pin below covers separately).
  for (const surface of ["--card", "--popover"]) {
    expect(rawContrast("--success-text", surface)).toBeGreaterThanOrEqual(AA);
  }
});

/** Every surface `text-primary` is read on, enumerated with the site that puts it there.
 *
 *  ENUMERATED rather than scanned, for the same reason the translucent-fill table below is:
 *  a class-string scan cannot pair a child's `text-primary` with the `bg-accent` its PARENT
 *  ROW paints, and the parent row is exactly where this broke. `WorldDrawer`'s row is
 *  `selected && "bg-accent"` and its "▶ game loads this" badge was `text-primary`, so the
 *  accent read at 4.2002:1 on the one row the user had just clicked — a resting state, not
 *  a hover.
 *
 *  Why `--primary` gets no `-text` sibling when `--destructive` and `--success` did: it does
 *  not need one. It clears the floor on every surface it is actually READ on (--card,
 *  --popover); it fails only on the interaction neutrals, and the badge did not need the hue
 *  in its TEXT — `border-primary` carries the same meaning and is held to the non-text floor
 *  instead. Deleting the usage was smaller than adding a token, and D-23's own rule is that a
 *  split is earned by measurement (see `--warning` in styles.css, where the same test came
 *  back the other way and the planned token was cancelled). */
interface PrimaryTextSite {
  /** Path under `src/frontend`, so the ledger is bound to the code and not to memory. */
  readonly file: string;
  /** The surface it is READ on, or `null` for a spelling that ships unused. */
  readonly surface: string | null;
  readonly site: string;
}

const PRIMARY_TEXT_SITES: readonly PrimaryTextSite[] = [
  {
    file: "components/shell/SessionStrip.tsx",
    surface: "--card",
    site: "the STAMP label, top bar",
  },
  {
    file: "components/shell/SessionCard.tsx",
    surface: "--card",
    site: "the STAMP label, card header",
  },
  // Carried, not read: shadcn's `link` variant ships `text-primary` and this editor uses it
  // NOWHERE (`variant="link"` has zero call sites). Listed rather than exempted so the ledger
  // is the whole truth about the spelling — and so the day someone uses it, this row is where
  // they find out which surfaces it may sit on.
  {
    file: "components/ui/button.tsx",
    surface: null,
    site: "the unused `link` variant",
  },
];

/** The interaction neutrals, where the accent does NOT clear the floor as text. Asserted as
 *  FAILING on purpose: this is the measurement that says "confine `text-primary` to the flat
 *  reading surfaces", and an assertion that only checked the passing side would go quiet the
 *  day someone widened the ramp. */
const PRIMARY_TEXT_FORBIDDEN = ["--secondary", "--input", "--accent"];

test("the accent clears AA as text on every surface it is read on", () => {
  for (const { surface } of PRIMARY_TEXT_SITES) {
    if (surface === null) continue;
    expect(rawContrast("--primary", surface)).toBeGreaterThanOrEqual(AA);
  }
});

/** `text-primary` and nothing longer — `text-primary-foreground` is a different token. */
const BARE_PRIMARY_TEXT = /text-primary(?![\w-])/g;

test("the accent-as-text ledger names every file that spells it", () => {
  // THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT, stated plainly because the two tests
  // above would not have: they measure the surfaces the ledger CLAIMS, and a ledger that
  // claims nothing about the world drawer passes happily while the world drawer reads at
  // 4.2:1. Binding the ledger to the source is what makes it a check rather than a note —
  // a new `text-primary` anywhere reddens here, and the fix is to add the row and say which
  // surface it sits on, which is the moment the measurement gets made.
  const files = sourceFiles(FRONTEND);
  expect(files.length).toBeGreaterThan(50);
  const found: string[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    if (BARE_PRIMARY_TEXT.test(src)) found.push(relative(FRONTEND, file));
    BARE_PRIMARY_TEXT.lastIndex = 0;
  }
  expect(found.sort()).toEqual(PRIMARY_TEXT_SITES.map((s) => s.file).sort());
});

test("…and does NOT clear it on the interaction neutrals, which is why it is confined", () => {
  for (const surface of PRIMARY_TEXT_FORBIDDEN) {
    expect(rawContrast("--primary", surface)).toBeLessThan(AA);
  }
  // The border is the channel that survives on those surfaces, and it is held to the
  // non-text floor there rather than assumed: this is what lets the world drawer's badge
  // keep saying "this is the one" after its text colour went back to the neutral ramp.
  expect(rawContrast("--primary", "--accent")).toBeGreaterThanOrEqual(3);
});

test("an on-fill foreground clears AA on BOTH states of its fill", () => {
  // The destructive pair is where this is a live constraint rather than a formality:
  // `--destructive-foreground` is near-white, so it LOSES contrast as the fill lightens —
  // the opposite of the primary pair, and the reason `--destructive` had to move DOWN
  // before `--destructive-hover` could sit above it.
  for (const [fg, fill] of [
    ["--destructive-foreground", "--destructive"],
    ["--destructive-foreground", "--destructive-hover"],
    ["--primary-foreground", "--primary"],
    ["--primary-foreground", "--primary-hover"],
  ] as const) {
    expect(rawContrast(fg, fill)).toBeGreaterThanOrEqual(AA);
  }
});

/** The non-text floor, borrowed from WCAG 1.4.11 rather than compelled by it — see the
 *  `--destructive` block in `styles.css`. It is the constraint that stopped the token being
 *  darkened as far as the button alone would have liked. */
const AA_NON_TEXT = 3;

test("a meaning-carrying border clears the non-text floor on its surface", () => {
  // `border-destructive` sites: the error toast (on --popover) and the world drawer's
  // invalid-name field (on --background). At BOTH the state is also carried in words — the
  // toast's `--destructive-text` copy and icon, the drawer's message beside the field — so
  // 1.4.11 does not strictly bind here. Held anyway, as the conservative direction for a
  // colour whose only job is to mark the destructive thing.
  for (const surface of ["--popover", "--background"]) {
    expect(rawContrast("--destructive", surface)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  }
});

test("a hover fill is LIGHTER than the fill it replaces", () => {
  // D-23, as arithmetic rather than as intent. This is the assertion that makes the two
  // `-hover` tokens necessary at all: the alpha spelling they replaced
  // (`hover:bg-primary/90`, `hover:bg-destructive/90`) composited the dark surface
  // underneath into the fill and came out DARKER, which no amount of reviewing the class
  // string reveals.
  expect(lum("--primary-hover")).toBeGreaterThan(lum("--primary"));
  expect(lum("--destructive-hover")).toBeGreaterThan(lum("--destructive"));
  // The neutral ramp's own hover step, which `bg-accent` is the house spelling of.
  for (const rest of ["--muted", "--secondary", "--input"]) {
    expect(lum("--accent")).toBeGreaterThan(lum(rest));
  }
});

// ── the focus ring ─────────────────────────────────────────────────────────────────
// `--ring` is the FOCUS colour and, since the F4.5c holistic gate, nothing else. It used
// to be `var(--primary)` — focus and selection spelled the same — and that made every
// `bg-primary` control's focus state invisible: a 1 px outset ring painted in the fill's
// own colour does not read as a ring, it reads as the control getting 1 px bigger. The
// ruling took the alias off and gave focus its own neutral, and FOCUS ≠ SELECTION is now a
// rule rather than an accident. These are the pins that keep it one.
//
// HOW THE FILL SET WAS DERIVED, stated so it can be re-derived instead of trusted:
//   `grep -rhoE 'bg-[a-z0-9-]+(/[0-9]+)?' src/frontend | sort -u`  → 24 spellings
// then keep the ones that land on, or behind, an element declaring `focus-visible:ring-ring`.
// BOTH adjacencies of a 1 px outset ring are in here, because it has two: the control's own
// fill on the inside edge (the defect the ruling closes) and the surface the control sits on
// outside it (the pixels the ring replaces when it appears).
//
// WHAT WAS EXCLUDED, said out loud rather than quietly omitted:
//   - `--warning` — one site, `TopBar.tsx`'s 7 px `aria-hidden` dirty dot. Not a control and
//     not adjacent to any ring; the chip AROUND it is `bg-muted`, which is in the set.
//   - `bg-black/80` — `ui/dialog.tsx`'s scrim. Nothing focusable sits on it, and the dialog
//     it dims is `bg-background`, which is in the set.
//   - `--border` — a 1 px separator `<span>` in the top bar.
//   - `bg-transparent` — not a colour. Those controls show whatever surface is behind them,
//     and every such surface (`--card`, `--popover`, `--background`) is in the set.
//   - the translucent tints (`bg-primary/15`, `bg-muted/50`, `bg-muted/40`,
//     `bg-destructive/20`, `bg-success/20`). A composite is not a token, and it does not need
//     to be one here: each composites its base over `--card`, so the painted colour lies
//     strictly BETWEEN the base and `--card`, and contrast against a LIGHT ring falls
//     monotonically as the backdrop lightens — clearing both ends clears everything between
//     them. `bg-success/20` is the one whose base is absent from the set, and it is absent
//     because that chip is a `<Tag>` rendered OUTSIDE the button (`FlagsPalette.tsx`), so no
//     ring ever abuts it.
//   - `MaterialSwatches`' swatches. The fill is an arbitrary material colour out of the
//     project, so no arithmetic in this file can reach it — which is exactly why that control
//     has its own answer, a `ring-offset-1` SELECTION marker rather than a token choice. See
//     `frontend-focus-vocabulary.test.ts`.
//   - the CANVAS itself. `CanvasHost`'s ring is `ring-inset` over rendered 3D, arbitrary for
//     the same reason. `--viewport-background` IS in the set: it is the cell's colour before
//     the first frame and wherever the canvas does not paint.

/** A fill a focusable control in this chrome wears, or sits on, bound to the site that puts
 *  it there — the same discipline as `PRIMARY_TEXT_SITES`, and for the same reason: a bare
 *  token list decays into a list nobody can re-check. */
interface FocusableFill {
  readonly token: string;
  readonly where: string;
}

const FOCUSABLE_FILLS: readonly FocusableFill[] = [
  {
    token: "--primary",
    where:
      "button `default`, the selected segment, a checked checkbox, the armed tool",
  },
  {
    token: "--destructive",
    where: "button `destructive` — every ConfirmDialog",
  },
  { token: "--destructive-hover", where: "…that same button under the cursor" },
  { token: "--secondary", where: "button `secondary`" },
  {
    token: "--accent",
    where: "the house hover fill, and WorldDrawer's selected row at rest",
  },
  {
    token: "--muted",
    where:
      "the disabled swap on a coloured button; the world chip; the status-bar chips",
  },
  {
    token: "--input",
    where: "an unselected segment; the dense inspector inputs",
  },
  {
    token: "--card",
    where: "panels, the tool rail column, the palette-layer buttons",
  },
  {
    token: "--popover",
    where: "menus, toasts, the tool rail's member flyout",
  },
  {
    token: "--background",
    where: "button `outline`; the dialog surface its close button sits on",
  },
  {
    token: "--viewport-background",
    where: "the canvas cell — CanvasHost's inset ring, the AxisTriad caps",
  },
];

/** The luminance a ring must REACH to clear {@link AA_NON_TEXT} on a fill from above. */
const lightestNeeded = (fill: string): number =>
  AA_NON_TEXT * (lum(fill) + 0.05) - 0.05;

/** …and the one it must STAY UNDER to clear that fill from below. */
const darkestAllowed = (fill: string): number =>
  (lum(fill) + 0.05) / AA_NON_TEXT - 0.05;

/** The ONE fill the floor is not held on — and it is excluded by a PROOF rather than by a
 *  choice, which is the whole reason it is named here instead of being left out of
 *  `FOCUSABLE_FILLS` silently.
 *
 *  It is the fill of a `bg-primary` button that is focused AND under the cursor. The ruling
 *  asked for ≥3:1 against every committed fill; that bar is unsatisfiable on this palette,
 *  and the test below is the arithmetic rather than an assertion of it. The state it gives up
 *  on is also the state with a second, stronger location cue in it — the pointer is on the
 *  control — and the neutral still more than doubles the margin the alias had there. */
const UNREACHABLE_FILL = "--primary-hover";

test("focus is not selection — the ring is its own token, not an alias", () => {
  // The ruling's own sentence, machine-held. `.not.toEqual` is stronger than banning the
  // `var(--primary)` SPELLING, because `parseTokens` resolves one level of alias: a literal
  // copy of the accent's value pasted in reddens here too.
  const ring = tokens.get("--ring");
  expect(ring).toBeDefined();
  expect(ring).not.toEqual(tokens.get("--primary"));
  expect(ring).not.toEqual(tokens.get("--primary-hover"));
  // And it is spelled as a LITERAL, not as an alias of anything. An alias is a second name
  // for a decision taken elsewhere; this one is its own, and the ledger has to be able to
  // measure the token rather than whatever it currently points at.
  //
  // Asserted against the extracted DECLARATION rather than against `css` itself: a
  // `not.toMatch` over the whole stylesheet prints the whole stylesheet on failure, which
  // buries the one line the reader came for. Verified by sabotage, both ways.
  const declaration = /^\s*--ring:\s*([^;]+);/m.exec(css)?.[1];
  expect(declaration).toBeDefined();
  expect(declaration).toMatch(/^oklch\(/);
});

test("the focus ring clears the non-text floor on every fill it can abut", () => {
  // WCAG 1.4.11: a focus indicator is visual information required to identify a state, and
  // 3:1 against adjacent colour is the floor for it. Named-and-numbered rather than counted,
  // because the fix for a failure is a token choice and the reader needs to know how far off
  // it is and on which fill.
  const offenders = FOCUSABLE_FILLS.filter(
    ({ token }) => rawContrast("--ring", token) < AA_NON_TEXT,
  ).map(({ token }) => `${token}: ${contrast("--ring", token)}`);
  expect(offenders).toEqual([]);
});

test("the one excluded fill is excluded by arithmetic, not by preference", () => {
  // THE RULING'S BAR AS WRITTEN CANNOT BE MET, and this is the proof rather than the excuse.
  // Two directions exist for a ring to clear a fill — be lighter than it, or be darker — and
  // on this palette both are closed for `--primary-hover`.
  //
  // DARKER is closed first, and not by that fill: the darkest surface a focusable control
  // sits on is near black, so a ring dark enough to contrast with THAT would need negative
  // luminance. Every legal ring in this chrome is therefore a light one.
  expect(darkestAllowed("--card")).toBeLessThan(0);
  expect(darkestAllowed("--background")).toBeLessThan(0);
  // LIGHTER is then closed by the fill itself. The luminance needed exceeds 1, which is the
  // luminance of pure white — there is no such colour, in sRGB or anywhere a display can go.
  expect(lightestNeeded(UNREACHABLE_FILL)).toBeGreaterThan(1);
  expect(ratio(luminance(1, 0, 0), lum(UNREACHABLE_FILL))).toBeLessThan(
    AA_NON_TEXT,
  );
  // What the move DID buy there, held so a later darkening of `--ring` cannot quietly give
  // it back: the alias measured 1.22:1 on this fill (a ring one hover-step off its own
  // colour). The comparison is computed from the tokens rather than typed, so it stays true
  // if the accent lane moves.
  expect(rawContrast("--ring", UNREACHABLE_FILL)).toBeGreaterThan(
    ratio(lum("--primary"), lum(UNREACHABLE_FILL)),
  );
});

test("the measured ratios, recorded", () => {
  // A LEDGER, not a floor. These are the numbers DESIGN.md §2 quotes, pinned exactly so a
  // token edit that moves one cannot land without moving the prose that cites it.
  //
  // `--destructive` on the two surfaces is in here despite having no text sites left: it
  // is the evidence for the split, and if it ever climbed over 4.5 the split would be
  // worth undoing.
  expect({
    "--foreground/--background": contrast("--foreground", "--background"),
    "--foreground/--card": contrast("--foreground", "--card"),
    "--foreground/--popover": contrast("--foreground", "--popover"),
    "--muted-foreground/--card": contrast("--muted-foreground", "--card"),
    "--destructive/--card": contrast("--destructive", "--card"),
    "--destructive/--popover": contrast("--destructive", "--popover"),
    "--destructive-foreground/--destructive-hover": contrast(
      "--destructive-foreground",
      "--destructive-hover",
    ),
    "--success-text/--card": contrast("--success-text", "--card"),
    "--destructive-text/--card": contrast("--destructive-text", "--card"),
    "--destructive-text/--popover": contrast("--destructive-text", "--popover"),
    "--warning/--card": contrast("--warning", "--card"),
    "--warning/--popover": contrast("--warning", "--popover"),
    "--success/--card": contrast("--success", "--card"),
    "--success/--popover": contrast("--success", "--popover"),
    "--destructive-foreground/--destructive": contrast(
      "--destructive-foreground",
      "--destructive",
    ),
    "--primary-foreground/--primary": contrast(
      "--primary-foreground",
      "--primary",
    ),
    "--primary-foreground/--primary-hover": contrast(
      "--primary-foreground",
      "--primary-hover",
    ),
    // The DISABLED pair: `ui/button.tsx` swaps a coloured fill for `--muted` and its
    // label for `--muted-foreground` rather than fading it. WCAG exempts an inactive
    // control from 1.4.3, so this is a ledger entry rather than a floor — but the whole
    // point of the swap over `opacity-50` is that the label survives it.
    "--muted-foreground/--muted": contrast("--muted-foreground", "--muted"),
    // The focus ring's two boundary numbers. `--primary` is the TIGHTEST fill the floor is
    // actually held on, so it is the one that says how much room the accent lane has left
    // before focus stops being visible on it; `--primary-hover` is the fill no colour can
    // reach, recorded so the gap is a number in the ledger rather than a claim in a comment.
    "--ring/--primary": contrast("--ring", "--primary"),
    "--ring/--primary-hover": contrast("--ring", "--primary-hover"),
  }).toEqual({
    "--foreground/--background": 13.1,
    "--foreground/--card": 12.46,
    "--foreground/--popover": 11.96,
    "--muted-foreground/--card": 5.71,
    "--destructive/--card": 3.26,
    "--destructive/--popover": 3.13,
    "--destructive-foreground/--destructive-hover": 4.69,
    "--success-text/--card": 7.83,
    "--destructive-text/--card": 5.96,
    "--destructive-text/--popover": 5.72,
    "--warning/--card": 5.63,
    "--warning/--popover": 5.4,
    "--success/--card": 4.9,
    "--success/--popover": 4.7,
    "--destructive-foreground/--destructive": 5.33,
    "--primary-foreground/--primary": 5.48,
    "--primary-foreground/--primary-hover": 6.67,
    "--muted-foreground/--muted": 5.23,
    "--ring/--primary": 3.19,
    "--ring/--primary-hover": 2.63,
  });
});

// ── text on a TRANSLUCENT fill ─────────────────────────────────────────────────────
// The class of pair the flat-token assertions above cannot see. `bg-success/20` is not a
// token; it is a token composited over whatever surface it lands on, and the result is
// lighter than that surface — so a text colour that clears the floor on `--card` can fail
// on a chip drawn on `--card`. That is exactly how the `clear` verdict chip shipped at
// ~3.9:1 while `--success` on `--card` measured a passing 4.90.
//
// WHY THE VERDICT IS PINNED AND THE NUMBER IS NOT. Tailwind emits `bg-X/20` as
// `color-mix(in oklab, …)`, and where the browser then composites that against the
// backdrop — gamma sRGB, or the oklab it was mixed in — is not something a headless test
// can settle. So both are computed and the WORSE of the two must clear the floor. The
// verdict is invariant across the ambiguity even though the exact ratio is not, and an
// assertion that only holds under the friendlier assumption would be a coincidence
// enshrined.

/** Alpha-composite in gamma-encoded sRGB — what a browser does when it paints a
 *  translucent layer over an opaque one. Returns the result's relative luminance. */
function compositeSrgb(
  fill: readonly [number, number, number],
  backdrop: readonly [number, number, number],
  alpha: number,
): number {
  const f = oklchToLinearSrgb(...fill).map(encodeSrgb);
  const b = oklchToLinearSrgb(...backdrop).map(encodeSrgb);
  const mix = f.map((c, i) =>
    decodeSrgb(c * alpha + (b[i] as number) * (1 - alpha)),
  );
  return (
    0.2126 * (mix[0] as number) +
    0.7152 * (mix[1] as number) +
    0.0722 * (mix[2] as number)
  );
}

/** The same blend interpolated in Oklab, the space `color-mix` names. */
function compositeOklab(
  fill: readonly [number, number, number],
  backdrop: readonly [number, number, number],
  alpha: number,
): number {
  const toLab = ([L, C, H]: readonly [number, number, number]) => {
    const h = (H * Math.PI) / 180;
    return [L, C * Math.cos(h), C * Math.sin(h)] as const;
  };
  const [l1, a1, b1] = toLab(fill);
  const [l2, a2, b2] = toLab(backdrop);
  const L = l1 * alpha + l2 * (1 - alpha);
  const a = a1 * alpha + a2 * (1 - alpha);
  const b = b1 * alpha + b2 * (1 - alpha);
  const H = (Math.atan2(b, a) * 180) / Math.PI;
  return luminance(L, Math.hypot(a, b), H < 0 ? H + 360 : H);
}

/** Every surviving text-on-translucent-fill pair in the chrome, as `[label, text, fill,
 *  backdrop, alpha]`. Enumerated rather than discovered: no scan can pair a `bg-<tone>/<alpha>` with
 *  the text colour that happens to land on it, so this list is maintained by review.
 *
 *  TWO SITES ARE ABSENT BECAUSE THE ALPHA WAS REMOVED, not because they were overlooked —
 *  both failed this check and both were fixed by making the fill opaque, which moves them
 *  under the flat on-fill assertion instead:
 *    - the tool rail's member-flyout tab (`bg-primary/80` + `--primary-foreground`, 3.84)
 *    - the destructive button's hover (`bg-destructive/90` + `--destructive-foreground`)
 *  Both had a DARK foreground on a fill that alpha was darkening, which is the same
 *  mechanism as D-23's hover rule seen from the text's side.
 *
 *  THIS LIST BEING HAND-MAINTAINED IS ITS WEAKNESS, and the paragraph above does not fix
 *  it: re-adding either pair leaves every assertion here green, which was demonstrated
 *  rather than assumed. The scan below ("no class string tints a fill and then puts that
 *  fill's own foreground on it") is what actually stops them coming back. */
const TINTED_SITES = [
  [
    "FlagsPalette trapped chip",
    "--destructive-text",
    "--destructive",
    "--card",
    0.2,
  ],
  ["FlagsPalette clear chip", "--success-text", "--success", "--card", 0.2],
  [
    "FlagsPalette filter chip (on)",
    "--foreground",
    "--primary",
    "--card",
    0.15,
  ],
  ["FlagsPalette selected row", "--foreground", "--primary", "--card", 0.15],
  ["EntitiesList selected row", "--foreground", "--primary", "--card", 0.15],
] as const;

/** The worse of the two compositing assumptions, which is the one that has to clear. */
function worstTintedContrast(
  text: string,
  fill: string,
  backdrop: string,
  alpha: number,
): number {
  const f = tokens.get(fill);
  const b = tokens.get(backdrop);
  if (f === undefined || b === undefined)
    throw new Error(`no such token in styles.css: ${fill} / ${backdrop}`);
  return Math.min(
    ratio(lum(text), compositeSrgb(f, b, alpha)),
    ratio(lum(text), compositeOklab(f, b, alpha)),
  );
}

test("text on a translucent fill clears AA under BOTH compositing assumptions", () => {
  // Named-and-numbered rather than counted: a failure here has to say which chip and how
  // far off it is, because the fix is a token choice rather than a one-line revert.
  const offenders = TINTED_SITES.filter(
    ([, text, fill, backdrop, alpha]) =>
      worstTintedContrast(text, fill, backdrop, alpha) < AA,
  ).map(
    ([label, text, fill, backdrop, alpha]) =>
      `${label}: ${Math.round(worstTintedContrast(text, fill, backdrop, alpha) * 100) / 100}`,
  );
  expect(offenders).toEqual([]);
});

/** The tones whose `-foreground` sibling is an ON-FILL colour — one meant to be read on top
 *  of that tone as a solid block.
 *
 *  `muted` is deliberately absent, and the omission is the whole reason this is a list
 *  rather than a sweep over every `--*-foreground` token in `styles.css`.
 *  `--muted-foreground` is the chrome's SECONDARY TEXT TIER, worn by timestamps, hints and
 *  counts on ordinary surfaces — not the label of a `bg-muted` block. Including it flags two
 *  innocent rows (`FlagsPalette`, `DriftReport`) whose `hover:bg-muted/50` lightens a
 *  transparent row, which D-23 explicitly sanctions. */
const ON_FILL_TONES = [
  "primary",
  "destructive",
  "secondary",
  "accent",
  "popover",
  "success",
  "warning",
] as const;

/** Every quoted string in a source file — the granularity that matters, because two classes
 *  only compose if they land on the SAME element. */
const stringLiterals = (src: string): string[] =>
  [...src.matchAll(/"[^"\n]*"|`[^`]*`/g)].map((m) => m[0]);

test("no class string tints a fill and then puts that fill's own foreground on it", () => {
  // The gap this closes was PROVEN open, not theorised: `TINTED_SITES` above is hand
  // maintained, and re-adding the exact `bg-primary/80 text-primary-foreground` pair that
  // F4.5c removed from the tool rail left all 14 assertions in this file green. A comment
  // saying "absent because fixed" enforces nothing.
  //
  // THE MECHANISM. An on-fill foreground is chosen against the SOLID tone. Alpha over this
  // dark shell pulls the surface underneath into the fill, and where that foreground is the
  // DARK member of the pair (`--primary-foreground`, `--destructive-foreground` on a light
  // fill) the label loses contrast as the fill dims — the tool rail's armed flyout tab sat
  // at 3.84:1 in its RESTING state this way. Either make the fill opaque, or put the pair in
  // `TINTED_SITES` where it is measured.
  //
  // WHAT IT CANNOT SEE, stated plainly rather than overclaimed: it reads ONE class string at
  // a time, so a tint applied by a parent or sibling element with the text on a child is
  // invisible to it, as is any tint composed at runtime. It catches the spelling that has
  // actually occurred here — both offending sites wrote fill and foreground on one element —
  // and nothing wider than that.
  const files = sourceFiles(FRONTEND);
  expect(files.length).toBeGreaterThan(50);
  const offenders: string[] = [];
  for (const file of files) {
    for (const literal of stringLiterals(
      stripComments(readFileSync(file, "utf8")),
    )) {
      for (const tone of ON_FILL_TONES) {
        const tinted = new RegExp(`bg-${tone}/\\d`).test(literal);
        if (tinted && new RegExp(`text-${tone}-foreground`).test(literal))
          offenders.push(`${relative(FRONTEND, file)}: ${literal}`);
      }
      // `--success` has a `-text` sibling now, so its bare form on its own tint is the
      // second spelling of the `clear` chip's original 3.82:1 defect.
      if (
        /bg-success\/\d/.test(literal) &&
        /text-success(?![\w-])/.test(literal)
      )
        offenders.push(`${relative(FRONTEND, file)}: ${literal}`);
    }
  }
  expect(offenders).toEqual([]);
});

// ── the source scans ───────────────────────────────────────────────────────────────

/** JS/JSX comments removed first. Both scans below match a class NAME, and this file's own
 *  vocabulary is discussed in prose all over the chrome — `EntitiesList` explains at length
 *  why its destructive verbs carry no `text-destructive`, which a naive substring search
 *  reads as the very thing it says is absent. Stripping is safe in the direction that
 *  matters: a mangled file loses matches, so it can only ever under-report, and both scans
 *  guard that with a non-empty file count. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

/** `text-destructive` / `text-success` and nothing longer: the `-text` and `-foreground`
 *  siblings are the spellings allowed to survive. */
const BARE_DESTRUCTIVE_TEXT = /text-destructive(?![\w-])/g;
const BARE_SUCCESS_TEXT = /text-success(?![\w-])/g;

test("no text wears the success FILL colour", () => {
  // The `--destructive` rule, applied to the second semantic colour that now has a `-text`
  // sibling. `--success` clears the floor on the FLAT surfaces (4.90 on --card), which is
  // why this is not a contrast assertion — it is a single-source-of-truth one. Two ways to
  // spell "success text" is how the `clear` chip ended up at 3.9:1 while every flat site
  // read fine, and one of the two spellings has to stop existing for that to be checkable.
  const files = sourceFiles(FRONTEND);
  expect(files.length).toBeGreaterThan(50);
  const offenders: string[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    if (BARE_SUCCESS_TEXT.test(src)) offenders.push(relative(FRONTEND, file));
    BARE_SUCCESS_TEXT.lastIndex = 0;
  }
  expect(offenders).toEqual([]);
});

test("no text wears the destructive FILL colour", () => {
  // D-23's split, enforced rather than remembered. `--destructive` measures 3.26:1 on
  // --card and 3.13:1 on --popover (the ledger above), so `text-destructive` is an
  // accessibility failure wherever it appears — and it is also the spelling every shadcn
  // snippet on the internet uses, which is how it comes back. Fills and borders
  // (`bg-destructive`, `border-destructive`) are untouched by this: contrast is a reading
  // question, and neither of those is read.
  const files = sourceFiles(FRONTEND);
  expect(files.length).toBeGreaterThan(50);
  const offenders: string[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    if (BARE_DESTRUCTIVE_TEXT.test(src))
      offenders.push(relative(FRONTEND, file));
    BARE_DESTRUCTIVE_TEXT.lastIndex = 0;
  }
  expect(offenders).toEqual([]);
});

/** A `-foreground` token with an opacity modifier: `text-primary-foreground/80` and friends.
 *  The `(?![\w-])` tail is what keeps `text-primary-foreground` itself out of the match. */
const FADED_ON_FILL_FOREGROUND = /text-[a-z-]+-foreground\/\d+(?![\w-])/g;

test("no on-fill foreground is FADED — the pair is measured at full opacity", () => {
  // The pairs test above measures `--primary-foreground` on `--primary` at 5.4805:1 and
  // calls it clear. An `/80` makes that measurement describe a colour that is not on screen:
  // the composited text reads 4.3233:1, under the floor, on the tool-rail flyout's hint line
  // for the ARMED member — the one row in that popover a user is most likely to read.
  //
  // The alpha bought nothing a token could not: the hint is already subordinate by size
  // (`text-2xs`) and by position. So the ban is total rather than a threshold — "how faded
  // is too faded" is a question with a different answer per pair, and per surface under a
  // translucent fill, and none of those answers is checkable from a class string. Full
  // opacity is, and it is what the pairs test already asserts.
  const files = sourceFiles(FRONTEND);
  expect(files.length).toBeGreaterThan(50);
  const offenders: string[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    const hits = src.match(FADED_ON_FILL_FOREGROUND);
    if (hits !== null)
      offenders.push(`${relative(FRONTEND, file)}: ${hits.join(", ")}`);
  }
  expect(offenders).toEqual([]);
});

/** An authored `font-family`, in either of the two spellings React accepts: the JSX style
 *  property (`fontFamily=`) and the CSS/SVG attribute (`font-family=`). */
const AUTHORED_FONT_FAMILY =
  /font-?[Ff]amily\s*=\s*(?:"([^"]*)"|\{"([^"]*)"\}|\{`([^`]*)`\})/g;

/** The only families the chrome may name, and they are both `var()` references rather than
 *  stacks: DESIGN.md §3 commits the stacks ONCE, in `styles.css`, and a second copy of them in
 *  a component is a copy that drifts. */
const TOKEN_FAMILIES = new Set(["var(--font-mono)", "var(--font-sans)"]);

test("no font family is named outside the two tokens", () => {
  // The sibling of the size scan above, and it exists because of a defect the size scan's
  // shape could never have seen: `AxisTriad`'s SVG labels carried `fontFamily="monospace"` —
  // a CSS GENERIC, not a bracketed Tailwind class, so no `text-[…]` pattern touches it. It
  // measured as a THIRD font family in the running chrome, alongside Inter and JetBrains
  // Mono, with nobody having chosen it.
  //
  // What makes an SVG presentation attribute the place this happens: it is the one styling
  // channel that sits BELOW the cascade, so it silently wins against the inherited stack
  // without appearing in any class string. Proven in Chrome rather than assumed — an SVG
  // `<text>` with no `font-family` computes to the Inter stack (it inherits like any other
  // element), one carrying `font-family="monospace"` computes to `monospace`, and one
  // carrying `font-family="var(--font-mono)"` computes to the full JetBrains stack. So the
  // attribute was overriding a stack that was already correct, and `var()` is a legal value
  // there, which is what makes the token spelling available as the fix.
  const files = sourceFiles(FRONTEND);
  expect(files.length).toBeGreaterThan(50);
  const offenders: string[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(AUTHORED_FONT_FAMILY)) {
      const value = m[1] ?? m[2] ?? m[3] ?? "";
      if (!TOKEN_FAMILIES.has(value))
        offenders.push(`${relative(FRONTEND, file)}: ${value}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("no arbitrary font size survives outside the scale", () => {
  // D-23's type clause, as the user ruled it at F4.5c: the chrome has ONE scale, and a
  // `text-[…]` size is one that belongs to no tier and answers to no token. `--text-2xs`
  // (10 px) is the micro tier the 10 px, 11 px and 9 px sites collapsed into; the 13 px
  // and 12.5 px sites went to `text-xs`. Anything bracketed after that is drift.
  //
  // The pattern is ANY bracketed `text-*`, not `\d+px`. The first draft of this scan
  // matched integers only and walked straight past `command.tsx`'s `text-[12.5px]` — the
  // one site in the chrome that was off the scale by a FRACTION, and the one the two
  // hand-run censuses before it had missed for exactly the same reason. A colour or a
  // custom property in brackets (`text-[#fff]`, `text-[--x]`) would trip this too, which
  // is correct: neither belongs in a class string when a token exists.
  const files = sourceFiles(FRONTEND);
  expect(files.length).toBeGreaterThan(50);
  const offenders: string[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/text-\[[^\]]+\]/g)) {
      offenders.push(`${relative(FRONTEND, file)}: ${m[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});

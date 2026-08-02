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
// It also does not reach TRANSLUCENT fills (`bg-success/20`), whose painted colour depends
// on a compositing space this file cannot verify without a browser. Those stay a gate
// question; see the note on the ledger.

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
  // Without this, every ratio below is a number produced by ~30 lines of transcribed
  // matrix constants that nothing checks — a single mistyped digit would shift them all
  // and the floors would still "pass". The anchors are the CSS Color 4 / Oklab values for
  // the sRGB primaries, which must round-trip to the corners of the cube exactly.
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
 *  indirection (which is how `--ring` is spelled). A chain deeper than one resolves to
 *  nothing here rather than to something wrong, and every lookup below throws on a miss. */
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

/** The measured ratio for a pair, at the 2 dp the ledger and DESIGN.md quote. */
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
  // The one-level alias resolves rather than going missing.
  expect(tokens.get("--ring")).toEqual(tokens.get("--primary"));
});

test("body text clears AA on every surface of the ramp", () => {
  for (const surface of ["--background", "--card", "--popover"]) {
    expect(contrast("--foreground", surface)).toBeGreaterThanOrEqual(AA);
  }
  // The secondary tier is held to the same floor rather than exempted: it carries real
  // copy (timestamps, counts, hints), not just disabled states.
  expect(contrast("--muted-foreground", "--card")).toBeGreaterThanOrEqual(AA);
});

test("error text clears AA on the surfaces it is used on", () => {
  // `--destructive-text` sites: toast + log rows (--popover); status bar, world drawer,
  // palettes, inspector field errors (--card). The FILL it split from does NOT clear the
  // floor as text (see the ledger) — that gap is the whole reason the token exists.
  for (const surface of ["--card", "--popover"]) {
    expect(contrast("--destructive-text", surface)).toBeGreaterThanOrEqual(AA);
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
    expect(contrast("--warning", surface)).toBeGreaterThanOrEqual(AA);
  }
});

test("success text clears AA on the surfaces it is used on", () => {
  // `text-success` sites: the toast row (--popover); the log row and the world drawer's
  // tracked badge (--card). Clears, but by the smallest margin in the ramp — a darkening
  // of `--success` or a lightening of `--popover` is what this catches.
  for (const surface of ["--card", "--popover"]) {
    expect(contrast("--success", surface)).toBeGreaterThanOrEqual(AA);
  }
});

test("an on-fill foreground clears AA on its own fill", () => {
  expect(
    contrast("--destructive-foreground", "--destructive"),
  ).toBeGreaterThanOrEqual(AA);
  expect(contrast("--primary-foreground", "--primary")).toBeGreaterThanOrEqual(
    AA,
  );
  // A hover state is not a moment when a label may become unreadable, so the hover fill
  // is held to the same floor as the resting one.
  expect(
    contrast("--primary-foreground", "--primary-hover"),
  ).toBeGreaterThanOrEqual(AA);
});

test("a hover fill is LIGHTER than the fill it replaces", () => {
  // D-23, as arithmetic rather than as intent. This is the assertion that makes the
  // `--primary-hover` token necessary at all: the alpha spelling it replaced
  // (`hover:bg-primary/90`) composited the dark surface underneath into the fill and came
  // out DARKER, which no amount of reviewing the class string reveals.
  expect(lum("--primary-hover")).toBeGreaterThan(lum("--primary"));
  // The neutral ramp's own hover step, which `bg-accent` is the house spelling of.
  for (const rest of ["--muted", "--secondary", "--input"]) {
    expect(lum("--accent")).toBeGreaterThan(lum(rest));
  }
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
  }).toEqual({
    "--foreground/--background": 13.1,
    "--foreground/--card": 12.46,
    "--foreground/--popover": 11.96,
    "--muted-foreground/--card": 5.71,
    "--destructive/--card": 3.55,
    "--destructive/--popover": 3.4,
    "--destructive-text/--card": 5.96,
    "--destructive-text/--popover": 5.72,
    "--warning/--card": 5.63,
    "--warning/--popover": 5.4,
    "--success/--card": 4.9,
    "--success/--popover": 4.7,
    "--destructive-foreground/--destructive": 4.89,
    "--primary-foreground/--primary": 5.48,
    "--primary-foreground/--primary-hover": 6.67,
    "--muted-foreground/--muted": 5.23,
  });
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

/** `text-destructive` and nothing longer: `text-destructive-text` and
 *  `text-destructive-foreground` are the two spellings that are allowed to survive. */
const BARE_DESTRUCTIVE_TEXT = /text-destructive(?![\w-])/g;

test("no text wears the destructive FILL colour", () => {
  // D-23's split, enforced rather than remembered. `--destructive` measures 3.55:1 on
  // --card and 3.40:1 on --popover (the ledger above), so `text-destructive` is an
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

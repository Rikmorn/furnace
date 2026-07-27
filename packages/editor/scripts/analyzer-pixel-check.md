# Analyzer marker pixel check

The walkability advisor's viewport markers are the one part of F4 whose output is
**pixels**, and pixels are the one thing the `bun:test` suite cannot see. Deleting
the `layers.flags && flagMarkers` push from `renderScene` fails no test in this
repo; so does forcing every marker tint to white. `tests/field-host-analyzer.gpu.test.ts`
says so in its own header, and this file is the other half of that sentence.

Run it whenever anything under the marker layer changes — `rebuildFlagMarkers`,
`flagTint`, the `flags` layer gate, the marker material, or the tints in
`src/viewport-host/field-flags.ts`. It takes about three minutes.

Precedent: `docs/learnings/2026-07-21-invisible-line-overlays.md`, rule 1 — *any
feature whose output is pixels needs either a pixel check or an error-scope check;
renders-clean logic tests prove nothing about visibility.*

## What it must establish

| # | Claim | Evidence |
|---|-------|----------|
| 1 | A dig raises **red** candidate markers where you dug | marker pixels appear over the hole, core colour ≈ `rgb(243, 144, 149)` |
| 2 | The `info` filter reveals **amber** markers | shown count jumps; new pixels core colour ≈ `rgb(255, 225, 149)` |
| 3 | The `flags` layer gate is live | unchecking it removes exactly N pixels; re-checking restores exactly the same N |
| 4 | A browser-side Verify returns a real verdict | verdict chips land in seconds, with a spread of outcomes and no status-line error |

The two colours are the sRGB of `CANDIDATE_TINT` `[0.90, 0.28, 0.30]` and
`INFO_TINT` `[1, 0.75, 0.3]` — the markers' material is unlit, so the tint reaches
the framebuffer with only the linear→sRGB encode applied. Sample the **strongest**
changed pixels, not the mean of all of them: a 0.18 m cube is a handful of pixels
and its anti-aliased edge drags a plain mean toward the wall behind it.

## Setup

```bash
# terminal 1 — the daemon. Rebuilds the frontend bundle first; the daemon serves
# it FROM DISK, so a later `bun run --cwd packages/editor build:frontend` plus a
# browser reload picks up chrome changes with no restart.
cd /path/to/furnace && bun run dungeon:editor
#   → http://127.0.0.1:4500/
```

Then, from anywhere:

```bash
node /tmp/pixel-check.mjs      # the script below
```

Two things that are easy to get wrong:

- **Browser.** Playwright's own chromium is *not* downloaded in this workspace
  (`~/Library/Caches/ms-playwright` holds no browser build). Launch the system Chrome instead:
  `chromium.launch({ channel: "chrome", … })`. WebGPU works headless there with
  `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=metal`.
- **Never `waitUntil: "networkidle"`.** The editor holds the SSE change feed open
  for the life of the page, so the network never goes idle. Use
  `domcontentloaded` and an explicit `waitForTimeout`.

`playwright` itself lives in `packages/editor/node_modules` (bun hoists it there),
so anchor a `createRequire` at that directory.

## The script

```js
import { createRequire } from "node:module";
const require = createRequire("/path/to/furnace/packages/editor/node_modules/");
const { chromium } = require("playwright");

const OUT = "/tmp";                         // screenshots land here
const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://127.0.0.1:4500/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const canvas = page.locator("canvas").first();
const layer = (n) => page.getByRole("group", { name: "layer visibility" }).getByLabel(n);
const filter = (n) => page.getByRole("group", { name: "flag filters" }).getByLabel(n);
const flags = async () =>
  (await page.locator("body").innerText()).split("\n").filter((l) => /flags ·/.test(l));

const shot = async (name) => ({
  b64: (await canvas.screenshot({ path: `${OUT}/${name}.png` })).toString("base64"),
});

// A WebGPU canvas reads back as pure black through `drawImage`, so pixels have to
// come from a Playwright screenshot — and Node has no image decoder. Hand the two
// PNGs BACK to the page and let Chrome decode them.
const diff = (a, b, tol = 24) =>
  page.evaluate(
    async ([aB64, bB64, t]) => {
      const load = (b64) =>
        new Promise((res) => {
          const img = new Image();
          img.onload = () => res(img);
          img.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([load(aB64), load(bB64)]);
      const px = (img) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const [da, db] = [px(ia), px(ib)];
      const rows = [];
      for (let i = 0; i < da.length; i += 4) {
        const d = [0, 1, 2].map((k) => Math.abs(da[i + k] - db[i + k]));
        if (d.some((v) => v > t))
          rows.push([d[0] + d[1] + d[2], da[i], da[i + 1], da[i + 2]]);
      }
      if (rows.length === 0) return { changed: 0, core: null };
      // Strongest 20%: the marker's interior, free of its anti-aliased edge.
      const top = rows.sort((p, q) => q[0] - p[0]).slice(0, Math.max(1, rows.length / 5));
      const m = (k) => Math.round(top.reduce((s, x) => s + x[k], 0) / top.length);
      return { changed: rows.length, core: [m(1), m(2), m(3)] };
    },
    [a.b64, b.b64, tol],
  );

/** One flags-on / flags-off pair at the current camera = the marker pixels. */
async function markerPixels(tag) {
  await page.mouse.move(1500, 500);            // park the brush ghost off-canvas
  await page.waitForTimeout(700);
  const on = await shot(`${tag}-on`);
  await layer("flags").uncheck();
  await page.waitForTimeout(800);
  const off = await shot(`${tag}-off`);
  await layer("flags").check();
  await page.waitForTimeout(800);
  const again = await shot(`${tag}-again`);
  return {
    gate: await diff(on, off),
    restored: await diff(again, off),
    // The strict half: the layer must come back IDENTICAL, not merely similar.
    idempotent: await diff(on, again),
  };
}

// --- 1 + 3: dig in a VIRGIN world, then read the markers -------------------
// `New` touches nothing on disk and gives a zero baseline, so every marker on
// screen was raised by the dig you just made.
await page.getByRole("button", { name: "New", exact: true }).click();
await page.waitForTimeout(2000);
const box = await canvas.boundingBox();
const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];

await page.getByRole("button", { name: "Dig", exact: true }).click();
await page.getByRole("slider").first().fill("1.25");
for (const [dx, dy] of [[0, 0], [40, 0], [-40, 0], [0, 30], [0, -30], [30, 25], [-30, 25]]) {
  await page.mouse.click(cx + dx, cy + dy);
  await page.waitForTimeout(500);
}
await page.waitForTimeout(5000);              // the whole-world pass rides a 500 ms idle tail
console.log("after dig:", await flags());
console.log("candidates:", JSON.stringify(await markerPixels("v-cand")));

// --- 2: the info band ------------------------------------------------------
await filter("info").check();
await page.waitForTimeout(2000);
console.log("with info:", await flags());
console.log("all:", JSON.stringify(await markerPixels("v-all")));
await filter("info").uncheck();

// --- 4: a browser-side verify ---------------------------------------------
// Load a real world — a virgin dig gives the mover nothing to walk.
await page.getByPlaceholder("world name").fill("hello");
await page.getByRole("button", { name: "Load", exact: true }).click();
await page.waitForTimeout(12000);
for (let i = 0; i < 8; i++) {
  const btn = page.locator('button[aria-label^="verify "]').nth(i);
  const name = await btn.getAttribute("aria-label");
  if (name === null || name.includes("Unavailable")) continue;
  await btn.click();
  await page.waitForTimeout(3000);
  const row = (await page.locator("ul li").allInnerTexts())[i] ?? "";
  console.log(`[${i}]`, name.split(" — ")[0], "->", row.replace(/\n/g, " "));
}
console.log(
  "status:",
  (await page.locator("body").innerText()).split("\n").filter((l) => /chunks ·/.test(l)),
);
await browser.close();
```

## Reading the output

A pass looks like this (measured 2026-07-26, `packages/dungeon`, Chrome 1600×1000,
the viewport canvas 800×415):

```
after dig:   203 flags · 11 shown
candidates:  { gate:       { changed: 1977,  core: [243,144,149] },
               restored:   { changed: 1977,  core: [243,144,149] },
               idempotent: { changed: 0,     core: null } }
with info:   203 flags · 203 shown
all:         { gate:       { changed: 31759, core: [254,216,149] }, … }
[0] verify low-clearance ×31 @ (-0.1, -3.3, -16.6) -> … FIRST: TRAPPED
[6] verify low-clearance ×15 @ (-2.4, -0.5, 11.4) -> … FIRST: CLEAR
status: 190 chunks · remesh 0.8ms · … (no error)
```

> **Read the SHAPE, not the digits.** Every absolute pixel count above is one
> camera's reading — it moves with the window size, the canvas size, and wherever
> the framed camera happened to land. An independent re-run on the same commit
> measured 2182 where this one measured 1977, on an 800×586 canvas. Only the
> **relations** are the pass criteria: `gate > 0`, `restored === gate`,
> `idempotent === 0`, and the `core` colours. A different count is not a
> regression.

- `gate.changed > 0` is claim 3's whole point: those pixels exist only while the
  `flags` layer is on. `restored.changed` must equal it, and `idempotent.changed`
  must be **0** — that is what says the layer came back identical rather than
  merely similar.
- `core` is the tint. Candidates ≈ `[243, 144, 149]`, info ≈ `[255, 225, 149]`.
  A grey/white core means the per-instance tint is not reaching the shader.
  The `all:` line reads `[254, 216, 149]` rather than pure amber for a boring
  reason: that diff is the WHOLE marker layer against no layer, so it averages the
  red candidates in with the amber. To read the amber alone, diff info-on against
  candidates-only (measured on `worlds/hello`: `[255, 225, 149]`).
- Verdicts must show a **spread**. All-`inconclusive` is not a failure on its own
  (it is a real outcome — see `walk-probe.ts`), but a `clear` and a `trapped` in
  the set are what prove the mover actually walked lanes.
- A verify that raises a status-line error instead of a chip is a **P-F4-2 NO-GO**:
  the Bun spike proved only that the engine bundle imports off a temp file, and the
  browser's native `import("/engine.js")` over http is a different transport.

Also worth eyeballing rather than measuring: open `v-cand-on.png`. The red cubes
should sit ON the dug surface at the rim, not float in the air or sink into it —
`rebuildFlagMarkers` lifts each one half a cell so it occupies the AIR cell its
flag anchors on.

## Known properties, not defects

- **Markers are depth-tested**, so advice behind rock is invisible from outside the
  cave. Hiding the `field` + `kit` layers makes that visible: on `worlds/hello` one
  camera went from 2425 to 4048 marker pixels and another from 493 to 8778. Do not
  turn either into a percentage of the FINDINGS — the ratio is whatever the camera
  is pointing at (a camera sitting inside terrain sees almost nothing), and a
  pixel count cannot distinguish a fully-occluded marker from a partly-occluded
  one. The direction is the finding; the magnitude is not a property. The void cast
  deliberately goes the other way (`compare: "always"`).
- **A dig into an existing cave floor mostly raises `info`**, not candidates. A
  spherical bite adds headroom and leaves a climbable bowl, so it produces `ledge` /
  `lip-near-wall`; under the amended pit semantics it is not a `pit` either. The
  virgin-world dig above is different because the cavity's own walls are what carry
  the low headroom. Do not read "I dug and got no red cube" as a broken advisor
  without opening the `info` filter first.
- **The flat shading mode is `shader.normalColor`** — the rainbow surfaces in every
  screenshot are the intended normal-distinct faces, not a broken material.

## Never write to `worlds/`

The script above only ever uses `New` and `Load`. Do not add a `Save` or a
`Bake & make default` click — `packages/dungeon/worlds/` is user data. Check
`git status packages/dungeon/worlds/` after a session.

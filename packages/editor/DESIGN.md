<!-- Transcribed from src/frontend/styles.css and components/ui/, and synced at the F4.5
     seal (2026-08-03). Every token below is a rendered value; every rule in §5 is one the
     chrome is actually written in and, where noted, one a test holds. The arithmetic behind
     the contrast pairs is argued once at each token's own declaration in styles.css and
     pinned in tests/design-tokens.test.ts — this file states the rule, not the derivation.
     As-built layout: docs/reference/editor/chrome.md and docs/reference/editor/design-system.md. -->

---
name: furnace editor
description: Desktop-grade field authoring cockpit for the furnace engine — a precision instrument, not a web dashboard.
---

# Design System: furnace editor

## 1. Overview

**Creative North Star: "The Precision Cockpit"**

A dark, quiet, capability-dense instrument. The editor follows the proven grammar of the pro-editor category — Blender / Unity / Unreal tool rails, inspector rows, gizmo viewport — refined with the typographic and whitespace discipline of modern design tools (Figma, Rive, Spline). The layout is an **overlay cockpit**: one full-window canvas, two fixed-height bars, a fixed tool rail, and everything else floating over the canvas as a palette the user can move, size, collapse or hide. Chrome recedes; the viewport and the data lead. Identity is carried by type and spacing discipline on a near-monochrome base, with a single cool steel-blue accent that appears only when something demands attention.

This system explicitly rejects the web SaaS dashboard aesthetic (cards, marketing gradients, roomy landing-page spacing), garish or decorative color, and 2005-toolkit dinginess (density without discipline). It must sit inside a native desktop wrapper without looking out of place.

**Key Characteristics:**
- Dark-first, near-monochrome, restrained single accent (steel-blue lane)
- Compact fixed rem type scale; technical sans for UI, mono for data values
- Density as a feature — every control earns its space
- Motion is responsive feedback only (150–250ms), never choreography
- Category-familiar affordances; innovation lives in workflow, not widgets

## 2. Colors

Restrained strategy: a dark neutral ramp carries the entire chrome; one cool accent plus a small semantic set carries all meaning. Values below are the rendered ones (`src/frontend/styles.css`, OKLCH). The whole neutral ramp sits on a single cool hue (250°, chroma ≤0.01) and the accent one step warmer (240°), so the near-monochrome base stays coherent.

### Primary
- **Steel Blue** (`--primary: oklch(0.62 0.11 240)`; foreground `oklch(0.15 0.02 240)`): SELECTION, the armed tool, the primary action. Its hover is a lighter step, `--primary-hover: oklch(0.67 0.11 240)` — lightening it also *improves* the pair's contrast (5.48:1 → 6.67:1), because its foreground is the dark member.

### Focus
- **`--ring: oklch(0.96 0.005 250)`** — a NEUTRAL light ring, its own literal and deliberately not an alias. **Focus is not selection** (see §5); the value is the arithmetic's, not taste's: the 3:1 non-text floor against `--primary` is crossed at L 0.93904, and 0.96 clears it at 3.19:1.

### Neutral
- **Dark neutral ramp** (hue 250°): surfaces step up from the 3D content out to the chrome — `--viewport-background: oklch(0.12 0.005 250)` (viewport content, one tonal step darker than the app base) → `--background: oklch(0.16 0.005 250)` (app/body) → `--card: oklch(0.19 0.005 250)` (bars, rail, palettes) → `--popover: oklch(0.21 0.005 250)` (floating surfaces). Interaction neutrals: `--muted: oklch(0.23 0.005 250)`, `--secondary: oklch(0.25 0.005 250)`, `--input: oklch(0.26 0.005 250)`, `--accent: oklch(0.27 0.005 250)` (the house HOVER surface), `--border: oklch(0.3 0.005 250)`. Foreground ramp: `--foreground: oklch(0.87 0.005 250)` (primary text, ≥4.5:1 on its surface), `--muted-foreground: oklch(0.65 0.01 250)` (secondary, and the label of a disabled control at 5.23:1 on `--muted`).

### Semantic
- **Error red** `--destructive: oklch(0.53 0.14 25)` (fg `oklch(0.98 0.01 25)`, hover `oklch(0.56 0.14 25)`) / **Warning amber** `--warning: oklch(0.65 0.12 80)` (fg `oklch(0.16 0.02 80)`) / **Success green** `--success: oklch(0.6 0.1 155)` (fg `oklch(0.16 0.02 155)`), desaturated to sit on the dark base. Never decorative.
- **Fill colours are not text colours.** `--destructive` at 0.53 L reads 3.26:1 as text on `--card`, under the 4.5:1 floor — so a destructive *label or glyph* uses `--destructive-text: oklch(0.68 0.16 25)` and a success one uses `--success-text: oklch(0.72 0.12 155)`. `--destructive-text` is pinned on `--accent` (the hover surface it has to survive) at 4.86:1.
- Inspector JSON leaf values use a deliberately separate `--syntax-value: oklch(0.72 0.05 160)` so the data view never reads as a semantic signal.

### Named Rules
**The Attention Rule.** Hue appears only when it means something — selection, primary action, job status, destructive/error. Inactive chrome never carries the accent; the accent covers ≤10% of any screen.

## 3. Typography

**UI Font:** **Inter Variable** (self-hosted, weights 100–900; stack `"Inter Variable", ui-sans-serif, system-ui, sans-serif`)
**Data Font:** **JetBrains Mono** (self-hosted, weight 400; stack `"JetBrains Mono", ui-monospace, "SF Mono", monospace`)

**Character:** One well-tuned technical sans carries all UI — labels, buttons, panel titles, menus. The mono companion is reserved for data: numeric fields, entity IDs, file paths, JSON. Fixed rem scale, tight ratio (1.125–1.2), compact sizes befitting a desktop tool.

### Hierarchy
Tailwind's fixed-rem scale plus **one** custom tier — no `clamp()`, and no other `@theme` font-size override: `text-2xs` **0.625rem** / `text-xs` 0.75rem / `text-sm` 0.875rem / `text-base` 1rem / `text-lg` 1.125rem (a tight ~1.14–1.2 ratio). The dense chrome runs on `text-sm` (body default) and `text-xs` (labels, palette headers, mono data); `text-base`/`text-lg` are reserved for dialog titles. Weights in use: `font-normal` body, `font-medium` buttons/menu triggers, `font-semibold` palette/section titles. Corner radius token `--radius: 0.25rem` (sm/md/lg/xl derived at −4px / −2px / base / +4px).

**`text-2xs` is the micro tier** (F4.5c), and it exists because 23 arbitrary `text-[10px]` / `text-[11px]` sites across 13 files were already a de-facto tier. It declares **no paired line-height** on purpose: an arbitrary size never set leading, so pairing one would change the HEIGHT of every migrated row rather than its font size — and nothing in this chrome may move the viewport. Leading stays the caller's (`leading-none`, `leading-tight`). Arbitrary `text-[Npx]` is now zero in `src/frontend`, and that is the check to re-run.

**One label column.** Every caption→value row aligns its value on the same x through `--spacing-label-col` (5rem). Before it, `Width` started its slider 33 px in and `Door South Offset` 103 px in, on adjacent rows of one form.

### Named Rules
**The Data-Is-Mono Rule.** Values the user reads or scrubs — numbers, IDs, paths, JSON — render in mono with tabular alignment. UI labels never do.
**The Casing Rule.** lowercase for CHROME (headings, group labels, param captions); Sentence case for anything naming a THING (menu items, options, action labels).

## 4. Elevation

Flat by default. Fixed chrome — the top bar, the status bar, the tool rail — is flat; depth is conveyed by 1px borders and tonal layering between the canvas and the chrome layer. Shadows belong to CONTAINERS that genuinely float: palettes, popovers, dropdowns, dialogs, tooltips, toasts.

**A control never casts one.** shadcn's stock variants ship a per-button `shadow`/`shadow-sm`; every one is stripped, and `ui/input.tsx` and `SelectTrigger` were stripped with them. A button that casts a shadow inside a raised box is a second, smaller elevation reading as a sticker rather than as depth. The invariant is testable by grep: every `shadow-*` still standing in `components/ui/` is on a container.

### Named Rules
**The Flat-Control Rule.** If it's a control, it's flat. If it's a floating surface, it may cast one quiet shadow — and its contents may not add a second.

## 5. Components — the state vocabulary

**The inventory** (as built): top bar + world chip + tool strip · status bar with its chips, keymap line and segment HUD · a 44px tool rail with member flyouts · five floating palettes (entities, session card, flags, history, log) · the burger menu with three submenus · the ⌘K command palette · the world drawer · the shortcuts overlay · toasts + the message log · confirm dialogs · the inspector field system (number / slider / stepper / segmented / enum / string / boolean / vec / color / quat / object).

**Every interactive control ships default, hover, focus, active and disabled — no half-vocabularies.** The five rules below are what those states MEAN here, and each is spelled out once in source (`components/ui/button.tsx` is where all three colour rules meet) rather than per component.

### 5.1 Focus, hover, disabled

**FOCUS IS THE RING AND ONLY THE RING** — `focus-visible:ring-1 focus-visible:ring-ring`, no `ring-offset-*`, and no exceptions anywhere in the chrome. Stock shadcn offsets the ring by 2px against `--background`, which draws a halo of the PAGE colour between a control and its ring: correct on a white page, a visible dark gash on every raised surface here. `tests/frontend-focus-vocabulary.test.ts` holds the ban and pins each ring-bearing control to the class string that carries its ring.

**FOCUS IS NOT SELECTION.** They are different colours by rule, not by coincidence. `--ring` was `var(--primary)` until the F4.5 gate — which meant the ring on a `bg-primary` control painted the colour that control already is, reading as the control getting 1px bigger rather than as a ring. Selection stays `--primary`; focus is the neutral.

**HOVER LIGHTENS, NEVER FADES.** `hover:bg-X/90` is a fade: on a dark shell it composites the surface underneath into the fill, so the control gets DARKER under the cursor and reads as pressed-and-stuck. Every hover names a lighter colour — `--accent` for the neutral ramp, `--primary-hover` and `--destructive-hover` for the two chromatic lanes.

**DISABLED DROPS HUE.** A coloured fill swaps to `--muted` and its label to `--muted-foreground` (5.23:1 — a dead control stays legible). `opacity-50` on a *coloured fill* is the failure this rule names, because a half-transparent fill takes the label's contrast down with it. A variant with no coloured fill has no hue to drop and dims instead — and every disabled-or-refused dim in the chrome is that same 50%. Resting de-emphasis (a dialog close at `opacity-70`, a menu shortcut at `opacity-60`) is not a state and is not this tier.

### 5.2 Refusal

**Every refusal is visible AND explained, and pressing one says so.** A control that cannot run now shows it (dimmed, or `aria-disabled` where the control must stay tabbable), carries its reason on its accessible name, and — when pressed — posts that reason as a toast through the ONE mechanism, `notify.sayRefusal`. A hover tooltip is opt-in: it costs a wait, and it costs knowing there is something to wait for; a press is the gesture a user actually makes.

- `reason: null` means **the label already carries it** — nothing is posted, and the enabled case is silent structurally rather than by luck.
- **The same sentence does not stack while it is on screen.** Keyed on what is visible, not on what has ever been said: once the toast is gone, asking again says it again.
- A button and its keyboard shortcut refuse **in the same words**, because both read the same verdict.

### 5.3 Tooltips

Two wrappers, and which one a control gets is decided by one fact — can the user reach it? An AVAILABLE control gets `ActionTip`: a real tooltip, opening on focus as well as hover, carrying **the registry's own keycap** so the cap shown and the key that runs the verb cannot drift apart. A REFUSED one gets `ReasonTip`, because a `disabled` control takes neither pointer events nor focus. Nothing carries both, and nothing that carries either may also carry a `title` (machine-enforced, with a named allowlist). A tooltip stays SHUT while arrow keys travel the rows of a list — every row's tip says the same sentence — and opens when they step the verbs *within* a row, where each sentence is the answer being looked for.

### 5.4 Chips, popovers, palettes

**A chip is a compact readout, and its shape says whether clicking does anything.** Two chips run a verb, three open a detail popover, one is inert text and wears the shape alone. A popover mounts nothing until it is open.

**A palette is a container the user owns.** It can be moved (drag its title, or arrow it 8px / ⇧-arrow 32px), sized (a corner handle, arrows too), collapsed to a chip, closed, or hidden with the rest at ⌘\ — and its geometry, collapse and open state persist per project. Two rules follow:

- **A declared extent is a DEFAULT SIZE, never a ceiling.** A user-set height REPLACES it. Size is *unset until set*, so "has this been sized?" needs no flag and a later change to a default still reaches everyone who never dragged.
- **An extent has ONE home.** A palette body that caps its own list with an inner `max-height` is a second ceiling the layer cannot see and a resize cannot drop — which is exactly how dragging a palette taller comes to add empty space under a ten-row list.

**Nothing floating may move the canvas.** Opening a palette, changing selection, growing a status line: none of them may reflow the viewport. Only the two fixed bars and the fixed rail take space from it.

### 5.5 Keyboard

**One tab stop per control cluster, walked with the arrows** (roving tabindex): the tool rail and the three row grids. A caller prevents default only for keys it actually claimed — the arrows are also the region nudge, and Esc is the app's one cancel ladder.

**Motion budget: 150–250ms, ease-out, state feedback only**, all durations zeroed under `prefers-reduced-motion`. The one deliberate flourish is a **180ms promotion pop** when a resting inspector silently becomes a live editing session — a state change that otherwise has no signal at all.

## 6. Do's and Don'ts

### Do:
- **Do** keep the accent for selection, primary action, generation state, and destructive/error — nothing else (The Attention Rule).
- **Do** use density deliberately: compact controls, tight panels, information-rich surfaces — "capability per pixel".
- **Do** follow category-standard affordances (tool rail, palettes, inspector rows, gizmo viewport); users of Blender/Unity/Unreal should feel at home.
- **Do** use ONE control library — `components/ui/`. A raw `<select>`, checkbox or radio anywhere else in the chrome is an authoring-time lint error, allowlisted only with a written reason.
- **Do** honor `prefers-reduced-motion`, keep body text ≥4.5:1, and give every control a visible focus state.
- **Do** keep motion 150–250ms, ease-out, state-conveying only.

### Don't:
- **Don't** use the "web SaaS dashboard aesthetic — cards, marketing gradients, hero metrics, roomy landing-page spacing" (PRODUCT.md anti-reference, verbatim).
- **Don't** use "garish or decorative color — saturated accents on inactive chrome; hue that doesn't mean something".
- **Don't** be the "Electron-app-that-forgot-it's-a-tool — oversized controls, decorative motion, modal-first flows". Exhaust inline/progressive alternatives before any modal.
- **Don't** ship "2005-toolkit dinginess — density without discipline: cramped, low-contrast, inconsistent controls".
- **Don't** use display fonts in labels/buttons/data, custom scrollbars, or reinvented form controls.
- **Don't** use side-stripe accent borders (>1px colored `border-left`), gradient text, or decorative glassmorphism — banned outright.

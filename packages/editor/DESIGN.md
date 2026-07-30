<!-- Tokens (§2 colors, §3 typography, §4 elevation) are the committed 3.2.2 live-pass
     values, transcribed from src/frontend/styles.css. Component states (§5) are still
     unspecced — re-run /impeccable document at the component-scan pass to fill them in.

     F4.5a (2026-07-30): the chrome moved from DOCKED panels to an OVERLAY cockpit — one
     full-window canvas with floating palettes over it. The tokens are unaffected; the
     "docked panels" language below is the category reference, not the layout. The
     component inventory (§5) is stale on the same axis. Both get their pass at the F4.5
     seal; the as-built is editor-architecture.md §20. -->

---
name: furnace editor
description: Desktop-grade scene editor and generation cockpit for the furnace engine — a precision instrument, not a web dashboard.
---

# Design System: furnace editor

## 1. Overview

**Creative North Star: "The Precision Cockpit"**

A dark, quiet, capability-dense instrument. The editor follows the proven grammar of the pro-editor category — Blender / Unity / Unreal docked panels, tree + inspector, gizmo viewport — refined with the typographic and whitespace discipline of modern design tools (Figma, Rive, Spline). Chrome recedes; the viewport, inspector data, and generation results lead. Identity is carried by type and spacing discipline on a near-monochrome base, with a single cool steel-blue accent that appears only when something demands attention.

This system explicitly rejects the web SaaS dashboard aesthetic (cards, marketing gradients, roomy landing-page spacing), garish or decorative color, and 2005-toolkit dinginess (density without discipline). It must sit inside a native desktop wrapper without looking out of place.

**Key Characteristics:**
- Dark-first, near-monochrome, restrained single accent (steel-blue lane)
- Compact fixed rem type scale; technical sans for UI, mono for data values
- Density as a feature — every control earns its space
- Motion is responsive feedback only (150–250ms), never choreography
- Category-familiar affordances; innovation lives in workflow, not widgets

## 2. Colors

Restrained strategy: a dark neutral ramp carries the entire chrome; one cool accent plus a small semantic set carries all meaning. Values below are the committed 3.2.2 live-pass baseline (`src/frontend/styles.css`, OKLCH). The whole neutral ramp sits on a single cool hue (250°, chroma ≤0.01) and the accent one step warmer (240°), so the near-monochrome base stays coherent. Iterate as the tool is used.

### Primary
- **Steel Blue** (`--primary: oklch(0.62 0.11 240)`; foreground `oklch(0.15 0.02 240)`; also `--ring`): selection state, focused/active control, primary action, generation-in-progress. The category-native "selected" color — cool, technical, instantly legible.

### Neutral
- **Dark neutral ramp** (hue 250°): surfaces step up from the 3D content out to the chrome — `--viewport-background: oklch(0.12 0.005 250)` (viewport content, one tonal step darker than the app base) → `--background: oklch(0.16 0.005 250)` (app/body) → `--card: oklch(0.19 0.005 250)` (panels/toolbars/docks) → `--popover: oklch(0.21 0.005 250)` (floating surfaces). Interaction neutrals: `--muted: oklch(0.23 0.005 250)`, `--secondary: oklch(0.25 0.005 250)`, `--input: oklch(0.26 0.005 250)`, `--accent: oklch(0.27 0.005 250)`, `--border: oklch(0.3 0.005 250)`. Foreground ramp: `--foreground: oklch(0.87 0.005 250)` (primary text, ≥4.5:1 on its surface), `--muted-foreground: oklch(0.65 0.01 250)` (secondary/disabled).

### Semantic
- **Error red** `--destructive: oklch(0.55 0.14 25)` (fg `oklch(0.98 0.01 25)`) / **Warning amber** `--warning: oklch(0.65 0.12 80)` (fg `oklch(0.16 0.02 80)`) / **Success green** `--success: oklch(0.6 0.1 155)` (fg `oklch(0.16 0.02 155)`), desaturated to sit on the dark base: validation failures, conflict states, bake results. Never decorative. Inspector JSON leaf values use a deliberately separate `--syntax-value: oklch(0.72 0.05 160)` so the data view never reads as a semantic (primary/success/warning) signal.

### Named Rules
**The Attention Rule.** Hue appears only when it means something — selection, primary action, generation state, destructive/error. Inactive chrome never carries the accent; the accent covers ≤10% of any screen.

## 3. Typography

**UI Font:** **Inter Variable** (self-hosted, weights 100–900; stack `"Inter Variable", ui-sans-serif, system-ui, sans-serif`)
**Data Font:** **JetBrains Mono** (self-hosted, weight 400; stack `"JetBrains Mono", ui-monospace, "SF Mono", monospace`)

**Character:** One well-tuned technical sans carries all UI — labels, buttons, panel titles, menus. The mono companion is reserved for data: numeric fields, entity IDs, file paths, JSON. Fixed rem scale, tight ratio (1.125–1.2), compact sizes befitting a desktop tool.

### Hierarchy
Tailwind's default fixed-rem type scale — no `clamp()`, no custom `@theme` font-size overrides: `text-xs` 0.75rem / `text-sm` 0.875rem / `text-base` 1rem / `text-lg` 1.125rem (a tight ~1.14–1.2 ratio). The dense chrome runs on `text-sm` (body default) and `text-xs` (labels, panel headers, mono data); `text-base`/`text-lg` are reserved for dialog titles. Weights in use: `font-normal` body, `font-medium` buttons/menu triggers, `font-semibold` panel/section titles. Corner radius token `--radius: 0.25rem` (sm/md/lg/xl derived at −4px / −2px / base / +4px).

### Named Rules
**The Data-Is-Mono Rule.** Values the user reads or scrubs — numbers, IDs, paths, JSON — render in mono with tabular alignment. UI labels never do.

## 4. Elevation

Flat by default. Docked chrome (panels, toolbars, status bar) is flat; depth is conveyed by 1px borders and tonal layering between the content surface and the panel layer. Shadows are reserved for things that genuinely float: menus, popovers, dropdowns, dragged palettes.

### Named Rules
**The Flat-Dock Rule.** If it's docked, it's flat. If it floats, it may cast one quiet shadow.

## 5. Components

An inventory exists (top bar + world chip, burger menu, floating palettes, world drawer, toasts + message log, the field control stack, inspector field system — number/vec/color/quat/enum/resource-ref fields, status bar) but no committed visual spec yet. Component states, shapes, and treatments `[to be specced at the component-scan pass]` (the 3.2.2 live pass committed the token layer — §2–§4 — but not per-component visual specs). Baseline requirement carried from the product register: every interactive component ships default, hover, focus, active, and disabled states — no half-vocabularies.

## 6. Do's and Don'ts

### Do:
- **Do** keep the accent for selection, primary action, generation state, and destructive/error — nothing else (The Attention Rule).
- **Do** use density deliberately: compact controls, tight panels, information-rich surfaces — "capability per pixel".
- **Do** follow category-standard affordances (docked panels, tree + inspector, gizmo viewport); users of Blender/Unity/Unreal should feel at home.
- **Do** honor `prefers-reduced-motion`, keep body text ≥4.5:1, and give every control a visible focus state.
- **Do** keep motion 150–250ms, ease-out, state-conveying only.

### Don't:
- **Don't** use the "web SaaS dashboard aesthetic — cards, marketing gradients, hero metrics, roomy landing-page spacing" (PRODUCT.md anti-reference, verbatim).
- **Don't** use "garish or decorative color — saturated accents on inactive chrome; hue that doesn't mean something".
- **Don't** be the "Electron-app-that-forgot-it's-a-tool — oversized controls, decorative motion, modal-first flows". Exhaust inline/progressive alternatives before any modal.
- **Don't** ship "2005-toolkit dinginess — density without discipline: cramped, low-contrast, inconsistent controls".
- **Don't** use display fonts in labels/buttons/data, custom scrollbars, or reinvented form controls.
- **Don't** use side-stripe accent borders (>1px colored `border-left`), gradient text, or decorative glassmorphism — banned outright.

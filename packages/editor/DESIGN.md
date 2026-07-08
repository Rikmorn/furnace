<!-- SEED: re-run /impeccable document once the 3.2 visual pass lands, to capture the actual tokens and components. -->

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

Restrained strategy: a dark neutral ramp carries the entire chrome; one cool accent plus a small semantic set carries all meaning. Exact values `[to be resolved during implementation]` — the current code baseline (`--background oklch(0.145 0 0)`, `--foreground oklch(0.85 0 0)`, `--border oklch(0.3 0 0)`) is an uncommitted placeholder, not the final ramp.

### Primary
- **Steel Blue** (accent, `[to be resolved]`): selection state, focused/active control, primary action, generation-in-progress. The category-native "selected" color — cool, technical, instantly legible.

### Neutral
- **Dark neutral ramp** (`[to be resolved]`): body background, a second slightly-differentiated layer for panels/toolbars/docks, borders, and a disciplined foreground ramp (primary text ≥4.5:1 against its surface, secondary text, disabled).

### Semantic
- **Error red / Warning amber / Success green** (`[to be resolved]`, desaturated to sit on the dark base): validation failures, conflict states, bake results. Never decorative.

### Named Rules
**The Attention Rule.** Hue appears only when it means something — selection, primary action, generation state, destructive/error. Inactive chrome never carries the accent; the accent covers ≤10% of any screen.

## 3. Typography

**UI Font:** technical sans `[font to be chosen at implementation]`
**Data Font:** mono companion `[font to be chosen at implementation]`

**Character:** One well-tuned technical sans carries all UI — labels, buttons, panel titles, menus. The mono companion is reserved for data: numeric fields, entity IDs, file paths, JSON. Fixed rem scale, tight ratio (1.125–1.2), compact sizes befitting a desktop tool.

### Hierarchy
`[to be resolved at implementation — compact fixed-rem scale, no fluid clamp()]`

### Named Rules
**The Data-Is-Mono Rule.** Values the user reads or scrubs — numbers, IDs, paths, JSON — render in mono with tabular alignment. UI labels never do.

## 4. Elevation

Flat by default. Docked chrome (panels, toolbars, status bar) is flat; depth is conveyed by 1px borders and tonal layering between the content surface and the panel layer. Shadows are reserved for things that genuinely float: menus, popovers, dropdowns, dragged dockview panels.

### Named Rules
**The Flat-Dock Rule.** If it's docked, it's flat. If it floats, it may cast one quiet shadow.

## 5. Components

An inventory exists (toolbar, scene selector, dockview panels, entity tree, inspector field system — number/vec/color/quat/enum/resource-ref fields, generation panel, status bar, JSON view) but no committed visual spec yet. Component states, shapes, and treatments `[to be specced at the scan pass after the 3.2 visual work]`. Baseline requirement carried from the product register: every interactive component ships default, hover, focus, active, and disabled states — no half-vocabularies.

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

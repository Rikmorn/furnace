# Product

## Register

product

## Users

Roberto — solo developer, dogfooding. Uses the editor daily while building the furnace engine and the dungeon-crawler demo, in long desktop sessions (Safari primary, Chrome to verify; possibly bundled in a native wrapper later). Two jobs, both first-class at equal weight:

1. **Cockpit curation** — generate → reroll → see → curate → freeze & bake procedural content.
2. **Scene editing** — pick entities, inspect and tweak properties, drive gizmos, save documents.

## Product Purpose

The furnace editor is the engine's tooling face: a Node-portable daemon serving a React chrome that opens any furnace consumer project (`bun run edit`), edits scene documents transactionally, and hosts the generation cockpit for procedural content. Success is measured in capability — the editor materially accelerates building the dungeon crawler. It must feel like a desktop application, ready to sit inside a native wrapper without looking out of place — never like a web dashboard.

## Brand Personality

Precision instrument. Quiet, engineered, capable. Identity is carried by typographic and spacing discipline on a near-monochrome dark base; color exists to call attention (selection, primary action, generation state, errors) and for nothing else. Follows the proven grammar of the pro-editor category — Blender / Unity / Unreal panel-and-inspector density ("they work and people like them") — refined with the type and whitespace quality of modern design tools (Figma / Rive / Spline). Accent lane: restrained, neutral-quiet or cool-technical; the exact hue is a deliberate DESIGN.md decision, not an ember-orange reflex from the product name.

## Anti-references

- **Web SaaS dashboard aesthetic** — cards, marketing gradients, hero metrics, roomy landing-page spacing. This is a desktop tool.
- **Garish or decorative color** — saturated accents on inactive chrome; hue that doesn't mean something.
- **Electron-app-that-forgot-it's-a-tool** — oversized controls, decorative motion, modal-first flows.
- **2005-toolkit dinginess** — pro-editor density without discipline: cramped, low-contrast, inconsistent controls.

## Design Principles

1. **Capability per pixel** — density is a feature; every control earns its space, and chrome recedes so content (viewport, inspector data, generation results) leads.
2. **Earned familiarity** — follow the pro-editor category's proven affordances (docked panels, tree + inspector, gizmo viewport); innovate in workflow, not in widget vocabulary.
3. **Desktop-app posture** — reads native inside a wrapper: compact fixed rem type scale, real keyboard affordances, no web-dashboard tells.
4. **Color = attention** — near-monochrome base; hue appears only when it means something (selection, primary action, generation status, destructive).
5. **Two first-class workflows** — cockpit curation and scene inspection get equal design weight; neither is a sidebar to the other.

## Accessibility & Inclusion

Pragmatic defaults, no formal WCAG audit target: body text ≥4.5:1 contrast against its surface, visible focus states on every interactive control, `prefers-reduced-motion` honored on all animation, keyboard-friendly controls throughout.

# Product

## Register

product

## Users

Roberto — solo developer, dogfooding. Uses the editor daily while building the furnace engine and the dungeon-crawler demo, in long desktop sessions (Safari primary, Chrome to verify; possibly bundled in a native wrapper later). **One job, and it is the whole product:**

**Authoring a FIELD** — sculpt and paint a voxel world, stamp and reconfigure smart objects, scatter props, read the walkability advisor, then save, bake, and walk the result in the game.

## Product Purpose

The furnace editor is the engine's tooling face: a Node-portable daemon serving a React chrome that opens a furnace consumer project (`bun run edit`) as one full-window field viewport with a cockpit floating over it. Success is measured in capability — the editor materially accelerates building the dungeon crawler. It must feel like a desktop application, ready to sit inside a native wrapper without looking out of place — never like a web dashboard.

## Brand Personality

Precision instrument. Quiet, engineered, capable. Identity is carried by typographic and spacing discipline on a near-monochrome dark base; color exists to call attention (selection, primary action, generation state, errors) and for nothing else. Follows the proven grammar of the pro-editor category — Blender / Unity / Unreal panel-and-inspector density ("they work and people like them") — refined with the type and whitespace quality of modern design tools (Figma / Rive / Spline). Accent lane: restrained, neutral-quiet or cool-technical; the exact hue is a deliberate DESIGN.md decision, not an ember-orange reflex from the product name.

## Anti-references

- **Web SaaS dashboard aesthetic** — cards, marketing gradients, hero metrics, roomy landing-page spacing. This is a desktop tool.
- **Garish or decorative color** — saturated accents on inactive chrome; hue that doesn't mean something.
- **Electron-app-that-forgot-it's-a-tool** — oversized controls, decorative motion, modal-first flows.
- **2005-toolkit dinginess** — pro-editor density without discipline: cramped, low-contrast, inconsistent controls.

## Design Principles

1. **Capability per pixel** — density is a feature; every control earns its space, and chrome recedes so content (viewport, inspector data, generation results) leads.
2. **Earned familiarity** — follow the pro-editor category's proven affordances (tool rail, floating palettes, inspector rows, gizmo viewport); innovate in workflow, not in widget vocabulary.
3. **Desktop-app posture** — reads native inside a wrapper: compact fixed rem type scale, real keyboard affordances, no web-dashboard tells.
4. **Color = attention** — near-monochrome base; hue appears only when it means something (selection, primary action, job status, destructive).
5. **ONE workflow, and the viewport is it.** The editor is a FIELD tool: the canvas fills the window and everything else floats over it, so the only surface with a permanent claim on space is the world being built. The dungeon is the sole consumer, and the field is the whole of what the editor edits — there is no second first-class workflow competing for design weight, and adding one would cost exactly the density this file's first principle is about. There is no second workflow waiting in the wings either: foundations T2 deleted the daemon's `scene.*` half AND `@furnace/core/scene`, so a document surface is not parked — it is gone, and anything document-shaped would be new work against the field artifact rather than a revival.

## Accessibility & Inclusion

Pragmatic defaults, no formal WCAG audit target: body text ≥4.5:1 contrast against its surface, visible focus states on every interactive control, `prefers-reduced-motion` honored on all animation, keyboard-friendly controls throughout.

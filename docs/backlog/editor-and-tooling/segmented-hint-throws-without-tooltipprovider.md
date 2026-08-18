---
summary: `Segmented`'s optional `hint` renders through a Radix tooltip, which THROWS with no `TooltipProvider` above it — so a `components/ui/` leaf's behaviour depends on where it is mounted; latent today because every call site sits under the shell's provider
---

# `Segmented`'s optional `hint` throws when there is no `TooltipProvider` above it

`components/ui/segmented.tsx` takes an optional `hint` per option and renders it through
`ActionTip` (`:136-139`, guarded by `o.hint === undefined`). `ActionTip` is a Radix
`Tooltip.Root`, and Radix does not degrade outside a provider — it throws. `ui/tooltip.tsx`
exports `TooltipProvider` as a separate component, mounted once by the shell, so nothing in
the type system pairs the two.

The result is a control-library component whose behaviour depends on **where it is mounted**:
`<Segmented>` with no `hint` works anywhere, and the same component with a `hint` works only
under the shell's provider. That is not a leaf property, and `components/ui/` is supposed to
be a leaf — D-24's scope claim (`components/ui/` is the one place a raw `<input>` or
`<select>` may be written) is only worth something while the directory can be depended on
without conditions.

## Context

**This is the residue of a resolved entry, kept because the fix did not cover it.** It was
one of two costs named by *Two layering back-edges: `ui/` reaching app chrome, and
`field-host/` reaching `frontend/lib/`* — an entry in
`docs/backlog/editor-and-tooling/chrome-shape-follow-ons.md` (gone), un-merged at
genre-contracts — taken at foundations T3b1 (2026-08-06); the move's as-built is
`docs/reference/editor/bundling.md`. That move fixed the **direction** problem — the tooltip trio
moved to `components/ui/tips.tsx`, so no file under `ui/` imports app-layer chrome any more.
It did **not** fix this, because the throw is a Radix runtime requirement that travels with
`ActionTip` wherever the file lives. Filed separately rather than dropped with the section.

No occurrence today: every current `Segmented` call site sits under the shell's provider, so
this is a latent shape problem rather than a live defect. Candidate shapes, none costed:

- render the hint as a plain `title` when no provider is present (needs a context probe —
  Radix exposes none for this, so it would mean our own context beside the provider);
- make the provider a hard requirement of the whole library by mounting it inside `ui/`
  rather than in the shell, which removes the conditional at the cost of a provider in every
  test that renders one control;
- accept it and say so in `Segmented`'s TSDoc, which is the cheapest and is honest, but
  leaves the type silent.

## Trigger to revisit

The first `Segmented` with a `hint` mounted outside the shell's `TooltipProvider` — most
likely a test rendering the control in isolation, or a second app surface (a settings window,
a detached palette) that does not inherit the shell's provider. Also fires on the next audit
of `components/ui/` for leaf-ness, since this is the one condition standing in the way of
that claim.

## Reference

- `packages/editor/src/frontend/components/ui/segmented.tsx` — `hint?: string` at `:41`, the
  `ActionTip` branch at `:136-139`.
- `packages/editor/src/frontend/components/ui/tips.tsx` — `ActionTip`, whose docblock already
  states the requirement ("Requires the shell's single `TooltipProvider` above it — a Radix
  `Tooltip` outside one does not degrade, it throws").
- `packages/editor/src/frontend/components/ui/tooltip.tsx` — `TooltipProvider`, the
  separately-exported piece nothing forces a caller to mount.
- `docs/reference/editor/bundling.md` (the layer arrow the T3b1 move established) and
  §18's tips paragraph (the trio's two moves).

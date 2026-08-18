---
summary: `help.shortcuts` matches the CHARACTER `?`, which is layout-agnostic everywhere except the layouts that produce it with AltGr — Windows reports AltGr as ctrl+alt and both of the matcher's exclusions refuse it, so the key is simply dead
---

# `?` cannot reach the shortcut overlay on a layout that needs AltGr for it

`help.shortcuts` (the keyboard-shortcut overlay) is bound to the CHARACTER `?` rather than to a
modifier + physical key:

```ts
const question = (e: KeyboardEvent): boolean =>
  !mod(e) && !e.altKey && e.key === "?";
```

That is deliberately layout-agnostic across the common cases — `?` is ⇧/ on a US layout, ⇧ß on a
German one, ⇧, on a French one, and the matcher states none of it. The residue is the layouts
where `?` is an **AltGr** combination. Windows reports AltGr as ctrl+alt, and both exclusions in
the matcher refuse it (`mod(e)` covers ctrl, `!e.altKey` covers alt), so on such a layout the key
is simply dead.

## Context

Filed by the F4.5 holistic gate's ruling 3, in the commit that bound the key. The ruling itself
named the tradeoff and accepted it: *"note: `?` is ⇧/ on most layouts — fine, macOS-primary"*.

The exclusions are not incidental and cannot simply be relaxed:

- `mod(e)` (⌘ **or** ctrl) is what makes every chord in the table work on macOS and Windows
  alike. Admitting ctrl+alt here would make `?` a chord as well as a bare key.
- `!e.altKey` is the whole table's rule, for two reasons stated on `chord`: ⌥ is the viewport's
  eyedropper modifier, and on macOS it REWRITES `e.key` anyway.

So a fix means either a per-binding exemption from the ⌥ rule, or matching on something other
than `e.key` — and `e.code` is exactly the wrong tool here (`Slash` is the physical key only on
the layouts that already work).

**The overlay is not unreachable on those layouts** — the burger's Help ▸ Keyboard shortcuts item
and the ⌘K palette both open it, and the ⌘K route reaches it by name. What is lost is one
keystroke, on a keyboard nobody in this project uses.

## What a fix would have to decide

- Whether a binding may carry its own modifier policy (an `ActionDef` that opts out of the ⌥
  exclusion) — the first such exception in a table whose value is that ⇧ and ⌥ mean ONE thing
  across all of it.
- Or whether the editor grows a rebinding surface, which subsumes this and several other items.

## Trigger to revisit

Either of:

- **A non-US-layout user reports the key dead.** The specific layouts at risk are the ones
  producing `?` via AltGr; a user on ⇧-something is already covered.
- **A second binding needs a layout-dependent character.** One exception is a note; two are a
  policy, and the policy belongs in `ActionGate` rather than in a matcher's docblock.

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — `question()` (the matcher and its docblock),
  `chord()`/`bare()`/`shifted()` (the ⌥ and ⇧ rules it is the exception to), and the
  `help.shortcuts` row.
- `packages/editor/tests/keybindings.test.ts` — "`?` is matched by the CHARACTER, not by ⇧"
  asserts the AltGr case is refused, so this entry describes tested behaviour rather than a
  suspicion.
- `packages/editor/src/frontend/components/shell/ShortcutsDialog.tsx` — `GROUP_NOTES.help`, which
  tells the user the binding is on the character.

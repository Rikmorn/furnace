# `bake-default-world.ts` leaves stale artifacts when a world's piece set shrinks

**Context.** `packages/dungeon/scripts/bake-default-world.ts` writes exactly the files
`bakeWorld` returns and nothing else — it never prunes `worlds/default/`. `bakeWorld`
emits one `.fmesh` sidecar per bore connector and per field-organic region, keyed by
piece id, so the emitted file SET changes whenever a world's regions/connectors are
renamed or removed.

W2 Task 14 hit this: replacing the two-cave `DEFAULT_WORLD` with the gate world left
`cave-a-0.fmesh`, `cave-b-0.fmesh` and `tunnel-1-0.fmesh` sitting in `worlds/default/`,
still tracked, still served, referenced by nothing. They were `git rm`'d by hand. Nothing
in the test suite or the loader would have caught it: the loader only fetches sidecars the
manifest names, so orphans are invisible at runtime and simply ship as dead bytes.

**Why it isn't urgent.** The orphans are inert (never fetched — the manifest is the only
index into the dir) and a human reviewing `git status` after a re-bake sees the untracked
adds. It bites when nobody is watching: a CI/daemon-driven bake, or a world whose region
set churns often, silently accumulates dead artifacts in a committed fixture dir.

**Trigger to revisit.** Any of: (a) the editor daemon gains a "bake world to disk" command
that writes `worlds/<name>/` unattended; (b) a second committed world lands (the blast
radius stops being one hand-checked dir); (c) a bake is wired into CI.

**Fix (when triggered).** Have the script diff the emitted paths against the existing dir
contents and delete the difference, rather than blind-writing. Keep the deletion scoped to
the world's own dir and to the extensions `bakeWorld` owns (`.fmesh`, `.scene.json`,
`manifest.json`) so a stray hand-authored file in the dir isn't collateral. The safer
shape is probably for `bakeWorld` to keep returning only files (it is PURE by contract —
see `docs/reference/dungeon-architecture.md`) and for the *writer* to own the prune, so
the purity contract and the determinism gate both survive.

**Reference.** `packages/dungeon/scripts/bake-default-world.ts`;
`packages/dungeon/src/bake.ts` (`bakeWorld`, `appendPiece` — sidecar naming).

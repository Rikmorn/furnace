# Scatter's `variants` is not bound to the archetype it places

**Context.** Found live (2026-08-11) by the first agent world-building probe: the world
it built failed to load in the dungeon with

```
Error: world: archetype "stalagmite" has no mesh for variant 3
```

The chain, verified end to end:

- `packages/core/src/field/scatter.ts:411` — `const variantIndex = rng() % p.variants;`
- `SCATTER_PARAMS.variants` — `z.number().min(1).max(8)`, **default 3**. A static range;
  it never consults the archetype being placed.
- `packages/dungeon/catalog/entities.json` — `stalagmite` ships **2** meshes, and the
  archetype's own `scatter.variants: 2` states that fact. **The generator ignores it.**
- `packages/dungeon/src/world/world-loader.ts:479` — `archetype.meshes[variantIndex]`
  is `undefined`, and the module throws, per its declared setup-loud stance.

**Why it is worse than a bad-params story.** The generator's own default (3) already
exceeds `stalagmite`'s mesh count, so `generate {generatorId: "scatter", params:
{archetypeId: "stalagmite"}}` — a call naming nothing but the archetype — bakes a world
the game refuses to open. Nothing refuses at generate time, nothing refuses at bake
time; the failure lands at **world load in the game**, the furthest possible point from
the call that caused it, and for an agent over the MCP door that is a failure it cannot
see at all.

It is also a two-spellings-of-one-fact instance: the catalog already declares the right
number on the archetype (`scatter.variants`), and the generator param shadows it.

**Where the fix can live, and why it is a design question rather than a one-liner.**
Core's scatter cannot self-validate — it takes a material table and a field-access
context, never an entity catalog; `archetypeId` is an opaque string to it by design.
So the check belongs at one of:

- **The editor's generate path**, which parses the catalog and could refuse a scatter
  whose `variants` exceeds the named archetype's mesh count — the setup-loud half, and
  where the caller still exists to be told.
- **The catalog becoming the source**, with the generator param removed or narrowed to
  "at most what the archetype has" — the reductive option, and the one that kills the
  second spelling.
- **The loader**, which today throws. Note its module header declares that stance
  deliberately ("any manifest-referenced artifact that fails to fetch throws with the
  offending path"), so relaxing it to warn-and-skip is a stance change, not a fix, and
  should not be done to unblock a walkthrough.

**Trigger to revisit:** the next scatter/catalog touch, or the agent-door tranche that
gives `generate` catalog-aware refusals — whichever comes first. This blocks any agent
building with props, because the default params are the broken case.

**Reference:** `packages/core/src/field/scatter.ts` (`SCATTER_PARAMS.variants`, the
`rng() % p.variants` draw); `packages/dungeon/src/world/world-loader.ts` (the throw);
`packages/dungeon/catalog/entities.json` (`scatter.variants` per archetype).

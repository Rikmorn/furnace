# Svelte formatting (Prettier or biome upgrade)

Biome 2.x has partial `.svelte` support; the ecosystem standard is Prettier + the Svelte plugin. Currently `.svelte` files are not in biome's `files.includes` list, so they go unformatted. Acceptable for one ~25-line component; not at scale.

**Trigger to revisit:** `.svelte` content grows past ~3 components or ~200 lines total.

# Hot-reload for WGSL shaders

`bun --hot` reloads TS/HTML, but a WGSL text-import change requires recreating the WebGPU pipeline. Currently you need a full page reload to pick up shader edits.

**Trigger to revisit:** When iterating heavily on a shader and the friction shows.

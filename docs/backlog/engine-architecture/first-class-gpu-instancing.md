# First-class GPU instancing

`mesh.create({ geometry, material })` returns one drawable; many copies of the same shape require many `mesh.create` calls and many draws. WebGPU supports `pass.draw(vertexCount, instanceCount, ...)` and per-instance vertex-buffer attributes — exposing this lets a single draw call render N copies efficiently.

Likely shape: `mesh.createInstanced(ctx, { geometry, material, instances: Float32Array })` where `instances` is packed per-instance model matrices (or position + rotation + scale tuples decoded in the vertex shader). The engine routes them through an instance vertex buffer and `pass.draw(..., instanceCount)`. Per-instance transform via `setPosition(mesh, i, [...])` style setters.

Open design questions:
- Per-instance uniform buffer (dynamic offsets) vs per-instance vertex buffer (instance stride)? Vertex buffer is more standard; uniform offsets are flexible but more complex.
- Does the engine impose a fixed instance vertex layout (mat4 per instance = 64 bytes)? Or accept arbitrary instance attributes?
- How does the binding contract grow — does group 0 binding 1 become "default model" with instance buffer overriding?

Master spec § Section 3 listed "instance management" in mesh's purpose column, but the phrase was ambiguous when tranche 4 designed mesh and the headline demo had 2–3 draws.

**Trigger to revisit:** First demo with ≫10 copies of the same geometry — particles, foliage, instanced ECS entities.

**Reference:** Tranche-4 design § Out (`docs/superpowers/specs/2026-05-23-core-tranche-4-drawable-primitives-design.md`).

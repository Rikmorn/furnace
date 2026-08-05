# Editor AI-integration milestone (descoped from M4, 2026-06-11)

The editor epic's M4 was renamed from "MCP command layer" to "command layer" after a design
session concluded that for an FS-capable agent (Claude Code in the repo) **direct file editing is
the superior mutation interface** — faster, less context, bulk-capable, git-composable, and it
reaches extension *code*, which scene commands never can. M4 therefore shipped the AI-agnostic
substrate (a zod-validated command registry behind one `dispatch()` choke point, a closed
error-code union, an SSE change feed) and proved the seam with Claude Code over plain HTTP +
disk edits. The AI-specific *bindings* were descoped here, to be designed together, end-to-end.

> **Re-anchored 2026-08-05 (foundations T2).** M4's substrate ALSO included a mutable document
> session, a scene mutation command set, transactional `validateDocument` validation, undo, and
> scene-file watching with conflict semantics. All of it is deleted, along with
> `@furnace/core/scene`. **What this milestone would mount over is now 8 commands** —
> `project.get`, `field.load`, `generation.bake` and the five `world.*` verbs
> (`docs/reference/editor-architecture.md` §4) — and the "direct file editing beats mutation
> tools" premise points at a different file: an agent authoring a world edits `oplog.json` and
> re-bakes, or drives `generation.bake`, rather than editing a scene JSON. The three binding
> shapes below are unaffected — they are about TRANSPORT, and the transport-agnostic substrate
> is exactly what survived. `viewport.capture` is if anything MORE valuable now: the field is
> harder to read off disk than a scene document was.

**The design space (bidirectional — all three converge on M4's command registry):**

1. **Inbound — agent drives the editor.** Mount an MCP server over the daemon's handler registry
   (`@modelcontextprotocol/sdk`, low-level `Server` API + `z.toJSONSchema()` from the handlers'
   existing zod schemas so `dispatch()` stays the single validator; streamable HTTP transport on
   the existing Node `http` server). Residual value after the descope is real but specific:
   standardized discovery for **sandboxed/FS-less clients** (Claude desktop/web/mobile, other
   agents) and protocol-level conformance (tool envelopes, session headers) — the only part of
   the seam M4's HTTP gate leaves unproven. Verify the SDK's zod-version surface at plan time.
2. **Eyes — `viewport.capture`.** The most differentiated AI tool furnace can offer: AI authoring
   on disk is editing blind; the rendered viewport is the ground truth nothing on disk
   substitutes for (the shadow-bug learning applied to AI authoring). AI/automation-only feature
   (humans already see the viewport), so it travels with this milestone. Needs a daemon↔frontend
   request/response backchannel (SSE event out + result POST back, timeout when no viewport is
   connected) and a WebGPU canvas-readback spike (`toDataURL` presented-frame quirks, Safari
   especially; fallback: engine-side texture readback). Stopgap until then: browser-driving
   agents can screenshot the editor tab themselves (done in M3 debugging via Playwright MCP).
3. **Embedded agent — the editor hosts the AI** (the Cursor model). The daemon spawns an agent
   session (e.g. Claude Agent SDK) and hands it the command registry as in-process tools — no
   MCP transport involved. Likely wants a chat/command surface in the chrome.
4. **Outbound — editor calls the LLM.** "Make this material look wet"-class features: provider
   integration, key management, context packaging (current doc + selection + introspected
   schemas + a capture), human review of proposed mutations. Big product/UX surface entangled
   with M5's chrome.

**Boundary:** AI *generation* of assets (textures, meshes, audio) is the fenced-out Rust
asset-pipeline backend (epic spec §4.1), not this milestone. This milestone is AI authoring of
WORLDS with existing engine capability — dig, stamp, scatter, paint, bake. Runtime AI (NPC
planning, TTS) is separate again: `docs/backlog/ai-agents/llm-as-planner-experiments.md`.

**Trigger to revisit:** appetite after M5 lands — outbound UX needs chrome to live in and capture
wants a stable viewport; slot into the epic execution order at that point. Also reopens early if
a sandboxed-client need shows up (someone wants Claude desktop/web driving the editor).

**Reference:** `docs/reference/editor-architecture.md` (the command-registry substrate this builds on); `packages/editor/src/daemon/handlers.ts` (the registry all three bindings mount over); `docs/research/2026-05-25-ai-asset-authoring/`.

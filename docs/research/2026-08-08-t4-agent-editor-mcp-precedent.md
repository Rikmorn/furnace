# T4 agent-editor MCP — precedent research (2026-08-08)

Pre-commitment research pass for foundations T4, run at the direction-discussion session
after the collaboration model was settled (human = chrome, agent = Claude Code over MCP,
one claimed session, shared op log + undo, capabilities-not-buttons). Three parallel
research strands: (A) editor-MCP prior art, (B) MCP protocol + tool-design guidance,
(C) vision feedback loops + two-actors-one-document precedent. This file is the
distillation that feeds the T4 plan; every load-bearing claim carries its source.

## Verdict on the direction

**Confirmed, with one place furnace is ahead of all precedent.** Every shipped editor
bridge surveyed (BlenderMCP 25.6k★, CoplayDev unity-mcp 13.3k★, Epic's official UE 5.8
MCP, Figma Dev Mode MCP, Godot servers) operates the human's live editor session — the
collaboration topology is the industry shape. But **none brokers through a shared
op-log/undo**: the only adjacent points are mkdevkit/godot-mcp routing agent edits
through the editor undo stack, Zed's multiplayer agents, and one CHI 2026 co-editing
paper. Shared-session brokering is an opportunity with no prior art on its failure
modes — the closest documented hazards are Unity's multi-editor cross-talk and Epic's
"no overlapping tool calls" serialization mandate.

## The nine rulings the evidence supports

1. **Structured state is the primary perception channel; the screenshot is the
   verifier.** MindCube: VLMs near-random (37.8%) on spatial reasoning from views;
   explicit "map-then-reason" beat adding views by +20pts
   (arxiv.org/abs/2506.21458). BlenderMCP practitioner postmortem: agents holding
   screenshots still missed orientation, clipping, scale, Z-offsets (bufogen.com/1.html).
   tldraw's agent ships screenshots + structured shape data + canvas lints as a dual
   channel (tldraw.dev/starter-kits/agent). Figma states the token rationale for sparse
   structured metadata explicitly (figma.com/blog/introducing-figma-mcp-server).

2. **Ship deterministic spatial asserts/lints as first-class read tools.** The
   second-generation Blender server (PatrykIti/blender-ai-mcp) exists because raw
   code-exec + vision was unreliable; its answer is `scene_assert_contact` /
   `scene_assert_dimensions` / `scene_assert_containment` etc., with vision demoted to
   interpretation aid. VULCAN replaces screenshot judgment with specialized measurement
   tools (arxiv.org/abs/2512.22351). BlenderGym (CVPR 2025): ~10× human-VLM gap *with*
   renders; generator-**verifier** loops dominate and verification deserves its own
   compute budget (arxiv.org/abs/2504.01786).

3. **Mutation surface: few reads + batched typed-op verbs, not one tool per registry
   row.** The adoption pattern: small curated surfaces win (BlenderMCP has only 4 core
   editor tools; CoplayDev 47 `manage_*` multi-action verbs; Epic ships toolsets behind
   3 progressive-disclosure meta-tools; Figma converged on ~24 tools with **one**
   general mutation verb, `use_figma`, over a validated command language — skipping the
   many-bespoke-verbs stage entirely). Furnace's op log gives code-exec's composability
   (a batch of typed ops) without arbitrary code. Resist mirroring the action registry
   1:1 into MCP tools.

4. **Code-execution tools are wrong for furnace despite BlenderMCP's success.** The
   code-exec pole (BlenderMCP: `execute_blender_code` + screenshot) maximizes
   capability-per-tool, but its documented costs — no validation, no failure contract,
   no undo, API drift, context-sensitive state assumptions — are exactly what the
   daemon's zod registry already solves. Anthropic's code-execution-with-MCP economics
   (98.7% token cut) target hundreds of tools + bulk data and require shipping a
   sandbox (anthropic.com/engineering/code-execution-with-mcp). Not at our scale.

5. **The cull is accuracy-justified, not just token-justified.** Anthropic: deferring
   large tool sets *raised* MCP eval accuracy (Opus 4: 49%→74%)
   (anthropic.com/engineering/advanced-tool-use). RAG-MCP: selection accuracy collapses
   with pool size (arxiv.org/abs/2505.03275). Threshold guidance: >10 tools / >10K
   tokens of definitions is where degradation starts; the rejected naive ~43-tool
   projection sits right at it.

6. **Engine-side capture, post-tonemap, is the primary path — browser snapshot is the
   fallback.** WebGPU snapshot semantics are spec-defined (presented buffer stays
   readable; gpuweb explainer + issues #1548/#1781), but Safari 26 conformance is
   unverified, `captureStream` has a black-frame bug history, and HDR-canvas readback
   is a spec hole (webgpu-hdr explainer has zero readback spec; w3c/ColorWeb-CG#79).
   Engine-side `renderToTexture` → `copyTextureToBuffer` → `mapAsync` is deterministic,
   resolution-controlled, annotation-capable; 1–3-frame latency is irrelevant at agent
   frequency. In-repo precedent: `render-to-texture.ts` exists; readback exists only in
   GPU tests. Cheap disconfirming probe kept: the 10-line Safari `toDataURL` spike.
   Size budget from the client side: ≤1568px long edge, 25K-token MCP result cap with
   **no** text-style escape hatch for images (code.claude.com/docs/en/mcp;
   platform.claude.com vision docs). Precedent caps: BlenderMCP 800px, CoplayDev 512px.

7. **Shared undo is the better-supported choice for this regime — with three
   guardrails.** Industry per-actor undo (Figma, UE Multi-User, Docs) comes from
   symmetric human-human parallel work. The "Just Undo It" VR study
   (arxiv.org/html/2403.11756): **global undo won both performance and closeness** in
   exactly our quadrant (two actors, asymmetric, collaborative on one artifact);
   selective undo failed on interdependent 3D edits. Guardrails: (a) the agent never
   undoes human ops (the study's "efforts undermined" finding); (b) agent work batches
   into named strokes so one ⌘Z = one agent intention (UE transaction / Cursor
   checkpoint precedent); (c) any human undo invalidates the agent's world model — the
   state-read carries a revision cursor + "ops undone since your last read" marker
   (Figma echo-discard precedent; the bufogen stale-model failure class).

8. **The agent is a visible co-actor: presence, attribution, interrupt.** tldraw
   streams each mutation live and exposes `cancel()`/`interrupt()`; the PartyKit×tldraw
   study found presence markers + restraint are what made co-editing trusted
   (blog.partykit.io/posts/ai-interactions-with-tldraw). Copilot Workspace doctrine:
   the AI "must take the human with it." For furnace: agent presence in the viewport,
   attributed ops in the session UI, interrupt as a first-class verb. Approval gates
   only for destructive/world-scale ops — Claude Code's
   `_meta["anthropic/requiresUserInteraction"]` forces a per-call prompt, cheaper than
   elicitation (code.claude.com/docs/en/mcp); shared undo makes per-op gating friction.

9. **Protocol posture: app-level claim, transport isolated, text-first results.** The
   2026-07-28 MCP revision **deletes protocol sessions**; its migration guidance —
   "server-minted handles as ordinary tool arguments" — is literally the session-claim
   design (modelcontextprotocol.io/specification/2026-07-28/changelog). SDK 1.x tops
   out at protocol 2025-11-25; keep transport concerns in one module for the v2
   migration. Never couple the world-claim to `Mcp-Session-Id` (it identifies a client
   connection). Hardening MUSTs the hand-rolled server lacks: validate `Origin` (403 on
   mismatch), keep 127.0.0.1. Claude Code realities: `outputSchema` has broken tool
   registration outright (issue #25081), `structuredContent` historically ignored — the
   `text` block is the contract; the server `instructions` field (≤2KB) is the
   tool-search discovery surface; MCP notifications refresh capability lists, they do
   NOT inject events into context — staleness reaches the agent via the revision cursor
   (or, non-portably, Claude Code channels).

## The cost warning

The one sobering datapoint: MindStudio's donut benchmark — recreating a tutorial scene
via BlenderMCP consumed ~60% of a 5× Max plan's session tokens over two hours, failing
on clipping/scale/camera, with scene coherence degrading at context limit
(mindstudio.ai/blog/claude-blender-mcp-60-percent-tokens-donut-test-results).
Screenshot-iterate loops converge slowly and expensively on spatial problems. Every
mitigation above exists to avoid this: structured-state-first, deterministic asserts,
size-capped captures, batched ops. The T4 gate should measure captures-per-task and
tokens-per-world as first-class outcomes, not incidentals.

## Dependencies

**No new runtime dependency beyond `@modelcontextprotocol/sdk` is warranted.** Probed
2026-08-08 (v1.30.0): zod is a non-optional peer at `^3.25 || ^4.0` (furnace's 4.4.3
satisfies it — no two-instance risk); wire `Tool.inputSchema` is a plain JSON-Schema
object; `StreamableHTTPServerTransport.handleRequest(IncomingMessage, ServerResponse)`
mounts on plain `node:http`. Caveat: the SDK hard-deps express 5 + hono (~92 packages)
— unused node_modules weight the daemon inherits. Everything else hand-rolls on
existing substrate: no sandbox (ruling 4), no CRDT/OT (Figma-style serialized single
authority is already the daemon's topology), no image library (browser encodes PNG from
engine readback via 2D canvas; daemon relays base64).

## Sources

Full three-strand reports (agent transcripts, session-local). Primary sources cited
inline above; the load-bearing ones: modelcontextprotocol.io spec changelogs
(2025-06-18 / 2025-11-25 / 2026-07-28), code.claude.com/docs/en/mcp,
anthropic.com/engineering (writing-tools-for-agents, advanced-tool-use,
code-execution-with-mcp), github.com/ahujasid/blender-mcp (server.py read directly),
CoplayDev/unity-mcp docs, Epic UE 5.8 MCP docs, developers.figma.com MCP tools
reference, tldraw.dev/starter-kits/agent, arxiv 2506.21458 (MindCube), 2504.01786
(BlenderGym), 2512.22351 (VULCAN), 2403.11756 (Just Undo It), 2505.03275 (RAG-MCP),
figma.com multiplayer engineering posts, Unreal Multi-User Editing docs.

**Fed:** the agent-door design in `docs/reference/editor/agent-door.md`; `docs/reference/editor/daemon.md` cites this file for the loopback-bind requirement on local HTTP servers.

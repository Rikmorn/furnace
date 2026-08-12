---
summary: hand a foundation model structured scene state and execute the JSON actions it returns through the classical layer (A*, animation, physics) — far future
---

# LLM-as-planner experiments

Architecture doc §16. Hand a foundation model structured scene state, get JSON actions back, execute via classical layer (A*, animation, physics). Far future.

**Trigger to revisit:** When we have a scene with enough state to be interesting (entities, world, NPCs).

**Related research:** `docs/research/2026-05-25-ai-asset-authoring/` — the *authoring* side of AI-in-furnace (AI-generated meshes, sprites, audio). Together these sketch a furnace where AI authors the assets, AI drives the characters at runtime, and AI scripts the editor itself via MCP. The runtime TTS path (see `audio.md` §"Connection to the AI-character direction") is where this backlog item and that research most directly intersect — a streaming TTS layer turns LLM-generated dialogue into voiced NPC speech.

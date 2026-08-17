# viewport.capture — technique research + spikes (2026-08-09)

Pre-commitment research for foundations T4c's capture tool, run at the T4b review after
the user rated this "one of the most important elements in T4" and sanctioned a research
pass. Three evidence sources: a web-research strand (all four shipped editor-capture
codebases read at source), two live local spikes, and an engine napkin read from source.
Feeds the T4c plan. Companion: `2026-08-08-t4-agent-editor-mcp-precedent.md`.

## The verdict

**Engine-side capture that BORROWS the live viewport's composition is primary** — same
lights, same line overlays, live camera by default, agent-suppliable pose/size — via
`renderToTexture` + a lines-to-texture variant + readback. **Canvas snapshot
(`toDataURL`) demotes to a secondary, debug-grade tool** with a documented Safari
caveat. This inverts the 2026-08-08 research doc's ruling 6 ("engine-side primary" for
different reasons, then challenged by the T4c digest) — the final position is the
BlenderMCP middle path: deterministic AND what-the-human-sees parity.

## Why (the load-bearing evidence)

1. **Safari — the primary browser — has an OPEN capture-correctness bug.**
   bugs.webkit.org/316538 (filed 2026-06-08, status NEW as of 2026-08-09):
   toDataURL/toBlob around active rendering returns STALE or INCOMPLETE frames across
   multiple timings; Chrome/Firefox pass the same test. Our live Safari check (181 KB
   dataURL from the real editor) proved non-blank — which is exactly what this bug
   still produces; staleness/tearing are invisible to a length check. The editor's
   frame is multi-submit (frame.render + up to 14 drawLines passes), making
   "incomplete" a real hazard, not theoretical.
2. **No shipped tool re-renders through a separate clean pipeline.** Read at source:
   BlenderMCP `get_viewport_screenshot` = `GPUOffScreen.draw_view3d` reusing the LIVE
   view's camera matrices + shading settings (in-code rationale: window grabs go black
   when uncomposited); Unity-MCP `screenshot-scene-view` = re-render through the actual
   editor camera; godot-mcp = live viewport texture read; Unity-MCP's only
   default-enabled eye (`screenshot-isolated`) INJECTS a default white directional
   light rather than rendering unlit. A zero-light separate pipeline has no precedent.
3. **Shading is a measurable vision-model input channel; soft default lighting captures
   most of the value.** VISER (arxiv 2605.06311): specular off 10% vs on 90% task
   success; soft shadows 49% vs none 12% vs hard shadows 0% (direction solid,
   magnitudes approximate — VLA policies, not VLM verifiers). Photorealism gains
   "marginal beyond medium" (arxiv 2603.22876). DepthCues (2411.17385) names
   light-and-shadow among the six depth cues large models read. Unlit captures zero
   out real channels; one soft light suffices.
4. **Precise contact/floating judgments belong to geometric probes + overlay marks,
   not shading perception.** VULCAN (2512.22351) answers floating/collision with ray
   probes and Set-of-Mark-style annotated renders; its metrics collapse without them
   (floating 0→0.711). Validates T4c's spatial lint read as first-class, and overlay
   marks as capture parameters worth having.
5. **The WebGPU spec guarantees post-present snapshots** (drawing buffer "outlives the
   currentTexture… only cleared in Replace the drawing buffer"; `alphaMode:"opaque"`
   forces clean alpha) — so snapshot-as-secondary is spec-sound everywhere; the Safari
   bug is an implementation defect with an escalation trail, not a spec hole.
6. **Size/cadence norms:** shipped 3D tools default 512–1920 px longest edge, PNG,
   capture-on-demand ("verify between major steps"); Anthropic guidance: pre-scale to
   ~1024 px rather than letting API downscaling cost accuracy. PNG over JPEG where
   thin overlay lines matter (ringing).

## The local spikes (both run 2026-08-09 against the real editor)

- **Chromium (headless, playwright):** `toDataURL` on the live WebGPU canvas outside
  rAF: 28 ms, ~528 KB PNG at 2312×1388, 184 distinct colors, 100% non-black opaque —
  real lit frame with overlays. `toBlob` JPEG q80: 287 KB / 27 ms. PASS.
- **Safari (user console, real session):** `toDataURL().length` → 181,038 — non-blank
  PASS, with the freshness caveat above (the open bug makes this necessary-not-
  sufficient).

## The engine napkin (read from source at `df202056`)

- **Lighting through `renderToTexture`: ~15 lines.** `_writeSceneBuffer` already takes
  lights/ambient (frame.render passes them); RTT passes `undefined, undefined, []`
  with an in-code "backlog" note (`render-to-texture.ts:277-285`). Thread
  `lights`/`ambient` through `RenderToTextureOptions`. Shadows already degrade
  harmlessly (documented no-op at `:134-137`).
- **Lines into a texture: ~50 lines.** `drawLines` is a self-contained per-call pass
  compositing over a target view with `loadOp:"load"` + shared depth
  (`render-lines.ts:269-365`); the capture variant re-targets the same pass at the
  capture texture + its depth. **The editor's MSAA removal (user ruling 2026-08-09) is
  what makes this cheap**: pipelines are built at context sample count, so at
  sampleCount 1 the existing mesh AND line pipelines draw directly into the offscreen
  pass — no new pipelines, and drawLines' MSAA/resolve branch is dead weight for the
  editor.
- **Editor side: moderate.** Only `field-render.ts renderScene` composes the frame's
  draw list (inline, per frame); the capture verb needs that composition extracted
  (~60-80 lines split), then texture/depth alloc + lit RTT + line passes + readback
  (the GPU-test pattern, ~30 lines) + PNG encode via 2D canvas (~25 lines, new).

## What the T4c plan takes from this

Capture tool shape: `viewport_capture {view?: "user"|named-pose, size?, overlays?}` —
engine-side composed capture as the one implementation; "user" view borrows the live
camera; other poses never touch the human's camera (the collaboration constraint).
Default ~1024 px longest edge, PNG, MCP image content block (~1-1.5K vision tokens —
the earlier 8-16×-over arithmetic priced base64-as-text, wrong for image blocks).
Canvas snapshot ships only as a debug secondary or not at all (decide in-plan).
Spatial lint read is first-class beside it (evidence line 4). Capture-on-demand only.

**Fed:** the viewport-capture seam in `docs/reference/editor-architecture.md` (cited there as the source for the capture path) and the capture caveats recorded at `docs/backlog/editor-and-tooling/editor-seams-and-preview-deferrals.md`.

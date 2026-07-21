# Invisible line overlays: two slices shipped dead pixels, and the bug was already filed

**What happened (One Field F1 → F2b, resolved at the F2b gate 2026-07-21).** The editor
FieldHost requested a `sampleCount: 4` context from its very first F1 commit. Core's
`frame.drawLines` composed its pass as swapchain color (always 1×) + the context's
shared depth texture (4× on MSAA contexts) — an invalid attachment combination that
WebGPU rejects at `beginRenderPass`, dropping the whole submit. Result: **every line
overlay in the field viewport rendered nothing, silently, for two sealed slices** —
F1's ground-reference grid, F2a's dig-target ring, F2b's selection boxes, anchor cross,
live region preview, and entity highlights. Meshes rendered fine (frame.render's MSAA
path is internally consistent), so the viewport looked "working". The user gated F1 and
F2a without ever seeing the overlays those slices claimed to ship — the features were
felt through behaviour (dig worked), so nobody flagged the missing pixels — and the
F2b gate finally rejected the tool as unusable ("no feedback").

**The kicker: the defect class was already known in-repo.** Bowling's collider overlay
carried a comment ("under MSAA the drawLines pipeline is single-sample but the engine
depth texture is 4× ... flag for the gate") and
`docs/backlog/engine-architecture/drawlines-msaa-sample-count-mismatch.md` existed —
with partially wrong guidance, but the right headline. Neither surfaced during F1/F2a
design or the first two rounds of F2b gate triage.

**Root-cause of the *process* failure, and the rules that follow:**

1. **Silent-drop is the failure mode of WebGPU validation.** Uncaptured device errors
   go to a console callback nobody asserts on; the frame keeps presenting. Any feature
   whose output is pixels needs either a pixel check or an error-scope check —
   renders-clean logic tests prove nothing about visibility (the shadow-mapping lesson,
   third occurrence). The regression guard is now
   `packages/core/tests/frame/draw-lines-msaa.gpu.test.ts`: MSAA context + render +
   drawLines inside `pushErrorScope("validation")` — it failed for the exact
   sample-count error pre-fix.
2. **When diagnosing a rendering symptom, grep `docs/backlog/` for the subsystem
   FIRST.** The triage sessions read code and reproduced headless (good) but never
   searched the backlog register where the exact class was filed (bad). A 30-second
   grep would have cut two gate rounds to one.
3. **Visual features gate visually.** F1's "ground reference" and F2a's "ghost target
   ring" passed their Safari gates without anyone confirming those specific pixels.
   Gate checklists for view-layer features must name the expected visual artifact
   explicitly ("you should SEE the amber box follow the cursor"), so its absence is a
   finding, not background noise.
4. **Headless-browser repro is cheap and decisive.** The playwright + `--enable-unsafe-webgpu`
   recipe (slice 3.2.2) turned "feedback is overall poor" into the exact validation
   error string in one scripted run, after two rounds of code-reading produced only
   plausible-but-wrong hypotheses (contrast, stuck layer toggles).

**Fix record (F2b fix round 2):** `drawLines` now renders into the MSAA scene color
target with a resolve to the swapchain (scene pass stores MSAA color+depth); the
MSAA + post-chain + drawLines combo (bowling with MSAA on) is a warn-once skip rather
than frame corruption; blended no-depth-write draws record after all opaques
(`render-blend-order.gpu.test.ts`), fixing translucent ghosts rendering behind
instanced kit tiles.

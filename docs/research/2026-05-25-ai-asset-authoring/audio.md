# Audio — AI and procedural authoring

*Captured 2026-05-25. Sourced from web search performed in-session; specific URLs in **Sources** at end. Latency and quality claims from vendor/community pages — not independently verified in this session.*

## The closed-loop problem

Unlike images, **Claude has no native audio perception**. I can't listen to a generated voice line, music clip, or SFX. This is the single biggest constraint on AI-driven audio authoring from a Claude-driven editor:

| Loop step | Mesh/sprite | Audio |
|---|---|---|
| Generate asset | Script tool | Script tool |
| Render | Headless renderer → PNG | Bake to WAV/Ogg |
| Evaluate | `Read` PNG → visual judgement | **Need human ear, or numerical proxy** |
| Iterate | Adjust script, regenerate | Same — but blind |

Partial mitigations that close *some* of the loop without human listening:

- **Spectrogram → PNG** via `ffmpeg -lavfi showspectrumpic` or `librosa.display.specshow` → `Read` PNG. I can see frequency content, timing, dynamics envelope. I can't tell if it *sounds good*.
- **Numerical analysis**: loudness (LUFS), spectral centroid, MFCC distance from a reference, beat tracking. Useful for "does this match the spec" but not for "is this pleasant."
- **Audio embedding similarity**: CLAP embeddings (audio-text contrastive model) can score "does this audio match this text prompt." Useful as a soft check.

**Practical implication:** AI audio authoring needs the human in the loop more than mesh/sprite authoring does. The editor pipeline should be designed for "AI proposes 5 variants, human picks one" rather than "AI iterates autonomously to a target."

## Authoring-time vs runtime split

This split matters more for audio than for meshes/sprites, because audio has a serious runtime branch that meshes/sprites don't:

| | Authoring-time (bake) | Runtime (synth/stream) |
|---|---|---|
| **Music** | MusicGen, Stable Audio → bake to OGG | Dynamic music systems (rare for indie) |
| **SFX** | AudioGen, EzAudio → bake to WAV | Procedural synth (sfxr, Pure Data) |
| **Voice (canned)** | XTTS, Fish Speech → bake voice lines | — |
| **Voice (dynamic NPCs)** | — | Streaming TTS (Chatterbox-Turbo, CosyVoice2) |

The dynamic-NPC-voice path is the one that directly intersects the LLM-as-character-planner work — see [llm-as-planner-experiments.md](../../backlog/ai-agents/llm-as-planner-experiments.md). If an LLM is generating dialogue text at runtime, that text needs to become voice with low enough latency to feel responsive. That's a streaming TTS problem.

## Music generation

Open-source models, as of 2026:

- **MusicGen** (Meta, part of AudioCraft) — text-to-music + melody-conditioning. PyTorch. 16GB GPU recommended; smaller variants run on less. The reference open model.
- **Stable Audio Open 3.0** (Stability AI) — three open-weight models in the family, trained on licensed data. Comparable to MusicGen.
- **DiffRhythm**, **Yue AI**, **ACE-Step** — newer 2026 entrants. Not deeply evaluated here.
- **OpenAI Jukebox** — older, very high quality, very slow. Mostly historical at this point.

Commercial (hosted): **Suno**, **Udio**, **Mubert**. Significantly higher quality than open models today, but closed and pay-per-generation.

**Apple Silicon:** MusicGen works on MPS but slower than CUDA. Stable Audio similar. Hosted APIs sidestep this entirely.

## Sound effects (SFX)

- **AudioGen** (Meta, also in AudioCraft) — text-to-SFX, the sibling to MusicGen.
- **AudioCraft 2** — improved version of the Meta line. 32kHz output is the trade-off vs. some commercial alternatives.
- **EzAudio** — competitive open-source SFX model, latent-diffusion architecture (the dominant text-to-audio shape in 2026).
- Commercial: **ElevenLabs SFX**, **CassetteAI**, **SFX Engine**.

Procedural / non-AI:
- **sfxr** / **jsfxr** / **bfxr** — retro game SFX, parameter-driven, tiny. Great for UI clicks, hits, pickups, lasers. Trivially scriptable.
- **Pure Data** (`pd`) — visual DSP, headless mode for batch synthesis.
- **Csound** — text-based orchestra/score, fully CLI-driven.
- **SuperCollider** (`sclang`) — text-based synthesis language, scriptable.
- **Faust** — functional DSP, compiles to wasm/JS/C++/native. **This one is interesting for furnace** because the wasm output could ship as runtime synthesis modules inside the engine, paralleling Manifold for CSG. Audio's equivalent of "wasm hot path in core."

## Voice / TTS (the most relevant for AI characters)

The 2026 open-source TTS landscape is genuinely strong — closer to ElevenLabs than it was a year ago. Per community benchmarks (not independently verified):

### Models

- **Piper** ([rhasspy/piper](https://github.com/rhasspy/piper)) — CPU, MIT licence, real-time on M-series Macs (~15× realtime on CPU via ARM NEON per community reports). 30+ languages. **No voice cloning** — fixed voice set. Best fit when you want predictable, offline, free, commercial-OK output.
- **Coqui XTTS-v2** ([coqui/XTTS-v2](https://huggingface.co/coqui/XTTS-v2)) — voice cloning from a 6-second sample. 17 languages. Emotional tone replication. **Licence problem: Coqui Public Model Licence restricts to non-commercial.** Disqualifying for any product use unless re-licensed.
- **Fish Speech** — Apache 2.0 (clean commercial use), MOS 4.1, 8 languages, reference-audio voice cloning. The recommended commercial-OK voice-cloning option as of early 2026.
- **Bark** ([suno/bark](https://github.com/suno-ai/bark)) — TTS plus non-verbal sounds (laughter, sighs, crying, music). Heavy VRAM requirements; hardest of the lot to run on Apple Silicon.
- **StyleTTS 2** — high quality, works on M1/M2/M3 with dependency adjustments.
- **F5-TTS**, **IndexTTS-2** — 2026 SOTA contenders. Top picks per multiple 2026 reviews alongside Fish Speech.
- **Chatterbox-Turbo** (Resemble AI, MIT) — purpose-built for low-latency streaming. **~150ms first-packet latency** per vendor claim. 9+ languages.
- **CosyVoice2-0.5B** — ultra-low latency streaming, recommended for real-time applications.
- **VoXtream** (arxiv paper) — claims **102ms initial delay on GPU**, lowest of publicly available streaming TTS as of the paper's date.

### Integration

- **RealtimeTTS** ([KoljaB/RealtimeTTS](https://github.com/KoljaB/RealtimeTTS)) — Python integration library that wraps multiple TTS engines behind a unified streaming interface (local, cloud, neural). Useful as a vendor-abstraction layer.

### What this means for AI characters in furnace

For NPCs driven by an LLM planner, the design constraints stack like this:

1. **Latency budget** — anything over ~300ms first-packet starts to feel sluggish in dialogue. Chatterbox-Turbo, CosyVoice2, VoXtream are the candidates. Most of these require GPU; CPU-streaming for cloned voices is harder.
2. **Voice consistency** — a character needs the same voice across sessions. Needs voice cloning (Fish Speech, XTTS) or a fixed voice set (Piper).
3. **Emotional inflection** — XTTS and Fish Speech do this; Piper does not.
4. **Cancellable streams** — when player interrupts, the in-flight TTS stream must abort cleanly. Most streaming TTS supports this; check per-engine.
5. **Licence** — Fish Speech (Apache 2.0) > Piper (MIT) > XTTS (CPML, non-commercial only — disqualifying).

**Pragmatic stack guess (revisit when actually building):** Fish Speech for character voice cloning, Chatterbox-Turbo if Fish Speech's streaming isn't tight enough. Piper as the fallback for any voice that doesn't need cloning.

## Audio MCP servers

This is more developed than I expected — the audio MCP ecosystem in 2026 is mature, especially around DAWs:

- **Ableton Live MCP** ([ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp), same author as `blender-mcp`) — connects Claude to Ableton Live through a Remote Script. Track creation, MIDI/audio editing, transport, tempo, device loading, MIDI generation. The most polished of the DAW MCPs.
- **REAPER MCP** — full project/track/MIDI/FX/audio-import/mixing/rendering/mastering/analysis surface. REAPER is the natural pick for an open-ish workflow (60-day free evaluation, $60 personal licence).
- **DAW Connect** — multi-DAW abstraction, 29 tools.
- **Epidemic Sound MCP** — music *discovery* rather than generation; queries the Epidemic Sound catalogue. Hosted, not local.
- **play-sound-mcp-server** — minimal "play this notification sound" server. macOS-only proof-of-concept; not relevant for production.

There's **no existing furnace-equivalent MCP** for engine-side audio (loading buffers, configuring AudioContext, scheduling playback). If furnace ships an editor backend with audio in scope, this is a natural new MCP service to design.

## Runtime — Web Audio API + WebGPU coexistence

For the engine side (runtime playback in `@furnace/core`):

- **Web Audio API** is the only realistic option for a browser-first engine. It's mature, supports spatial audio via `AudioPannerNode` (position, orientation, distance models, cone-based directionality), and exposes `AudioWorklet` for custom sample-rate DSP — the audio analogue of GPU compute shaders.
- **JS audio libraries** (Howler.js, Tone.js) wrap Web Audio with extra ergonomics. Probably too thick for a furnace consumer that wants direct control; raw Web Audio is fine and avoids dependency weight in core.
- **AudioWorklet + wasm** is the natural runtime DSP path. The Faust → wasm pipeline drops directly into an AudioWorklet. This parallels the engine's existing wasm-hot-path direction.

Spatial audio for 3D scenes:
- Native Web Audio `AudioPannerNode` is the baseline — basic HRTF, distance attenuation, cone directionality. Sufficient for most game audio.
- **Resonance Audio** (Google) — deprecated in 2023; don't adopt.
- **Steam Audio** (Valve) — high-quality room acoustics, occlusion, reverb. Available for web via wasm but heavy. Future option for advanced scenes.

## Audio formats for shipping

- **Voice / dialogue** — Opus (low bitrate, low latency, excellent quality at 32-64 kbps).
- **Music** — Ogg Vorbis (broadest browser support) or Opus (smaller, modern).
- **SFX** — WAV for one-shots where decode cost matters and bandwidth doesn't; Opus for everything else.
- All natively supported by `AudioContext.decodeAudioData` in the browser. No format conversion concerns at runtime.

## Furnace fit — what would land where

Mirrors the meshes/sprites split:

1. **Inside `@furnace/core` eventually:**
   - Audio asset loader (Ogg/Opus/WAV via `decodeAudioData`).
   - `AudioContext` lifecycle wrapper (parallels `gpu` module's device lifecycle).
   - Spatial audio source primitive (position, velocity for Doppler, orientation).
   - `AudioWorklet` integration for custom DSP nodes.
   - Possibly: Faust-compiled wasm DSP modules (reverb, dynamics, distortion) — the runtime-audio analogue of Manifold for runtime CSG.

2. **In `@furnace/tools` eventually:** `furnace bake audio` — wraps `ffmpeg` for format conversion, loudness normalisation (`ffmpeg-normalize`, EBU R128), atlas generation for grouped SFX.

3. **In the editor backend (fourth pillar):**
   - Orchestrate generation tools (MusicGen, AudioGen, Fish Speech) via subprocess + GPU resource management.
   - Voice library management: store cloned voice references per character, regenerate dialogue lines when text changes.
   - Spectrogram + waveform rendering for the editor UI (and for Claude-in-the-loop authoring).
   - Possibly: bridge to an external DAW via the Ableton/REAPER MCP servers — let the human do the final mix in a tool they already know.

## Connection to the AI-character direction

The runtime-TTS path is where authoring and runtime AI meet:

```
LLM planner (decides what NPC says)
        ↓ dialogue text
streaming TTS engine (Chatterbox-Turbo / Fish Speech / CosyVoice2)
        ↓ audio stream
Web Audio API (positional, spatial, attenuated)
        ↓ rendered audio
player's ears
```

The editor side preps the static parts (voice clones, baseline pitch/timing, character-specific TTS configuration); the runtime side does the dynamic generation. The two sides need a shared character-voice manifest — likely a JSON file produced by the editor backend, consumed by the runtime.

This is "a ways off" but worth a unified design when it lands.

## What's deliberately out of scope here

- **Real-time voice changers** (player → character voice transformation). RVC and similar models exist but this is a different problem.
- **Source separation** (extracting stems from existing music). Demucs, Spleeter. Not relevant for authoring assets.
- **Audio-to-MIDI transcription**. Useful for music tooling but not a furnace primary concern.
- **Adaptive / dynamic music systems** (FMOD-style stems, vertical re-mixing). Worth its own research file when adaptive music becomes a concrete goal.

## Sources

Verified in-session via WebSearch (2026-05-25):

- [AudioCraft / MusicGen overview](https://ai.meta.com/resources/models-and-libraries/audiocraft/)
- [AudioCraft on GitHub](https://github.com/facebookresearch/audiocraft)
- [Stable Audio 3.0](https://stability.ai/stable-audio)
- [Open-source AI music landscape 2026](https://vocalremover.easeus.com/ai-article/open-source-ai-music-generator.html)
- [Local TTS guide 2026 (Piper / Coqui / XTTS / F5 / Bark / StyleTTS 2 comparison)](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts)
- [Best open-source TTS 2026](https://findskill.ai/blog/best-open-source-tts-2026/)
- [Coqui XTTS-v2 on HuggingFace](https://huggingface.co/coqui/XTTS-v2)
- [VoXtream low-latency streaming TTS paper](https://arxiv.org/pdf/2509.15969)
- [RealtimeTTS integration library](https://github.com/KoljaB/RealtimeTTS)
- [AI SFX generation landscape](https://www.aimagicx.com/blog/ai-sound-effects-generation-foley-guide-2026)
- [EzAudio paper](https://arxiv.org/pdf/2409.10819)
- [Music/Audio MCP servers overview](https://chatforest.com/reviews/music-audio-production-mcp-servers/)
- [Ableton Live MCP server (ahujasid)](https://skywork.ai/skypage/en/ableton-live-mcp-server/1977972315192741888)
- [REAPER MCP server](https://skywork.ai/skypage/en/reaper-mcp-ai-agent-recording-studio/1981635348613099520)
- [Building an AI DAW with MCP](https://blog.jonaylor.com/building-a-simple-ai-daw-part-2-mcp-and-agents)
- [Epidemic Sound MCP server](https://www.epidemicsound.com/blog/mcp-server/)
- [Web Audio API spec](https://www.w3.org/TR/webaudio-1.1/)
- [Web audio spatialisation basics (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics)
- [Web Audio API for games (web.dev)](https://web.dev/articles/webaudio-games)

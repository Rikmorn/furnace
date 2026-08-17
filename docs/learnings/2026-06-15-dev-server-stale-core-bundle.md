# `bun --hot serve.ts` served a stale `@furnace/core` bundle (June 2026)

*The incident behind the dev-loop rule in `AGENTS.md` §Commands. That section carries the
standing rule; this file is only the narration of how we found it.*

## What we hit

After the Task 4 core fog change (the new `lit`-shader fog path in
`packages/core/src/shader/lighting.ts` + `frame/lights.ts`), the fog visual checkpoint showed
**zero fog on lit surfaces even at extreme density**. At the same time `bun test` — which runs
live `src` — passed, and source review was green. The change was correct.

## What was actually wrong

The dev loop was `bun --hot serve.ts`, and the server had been alive since *before* the core
change. On navigation it re-bundled the entry package's own files fresh, but served the
`@furnace/core` bundle it had captured at startup: the workspace symlink resolved at bundle
time, and that bundle was frozen when the server booted. The browser was running the pre-fog
`lit` shader.

The dungeon's own `main.ts` (fog color/density wiring) re-bundled fine on navigation, which
masked the problem — the consumer-side change looked applied, so only the engine-side change
was stale. The symptom, "density does nothing", pointed at the fog math rather than at the
build, and that misdirection is what cost the time.

## The lesson we took

That a visual result can contradict a green test run and a clean source review *because the
two execute different bytes* — and that the build is worth suspecting before the new code when
they disagree. Written up as a standing rule in `AGENTS.md` §Commands, since it is a caveat of
the dev-server commands rather than a deferred piece of work.

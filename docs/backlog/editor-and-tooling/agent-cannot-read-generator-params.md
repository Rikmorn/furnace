# An agent can name a generator but cannot read its params

Found at T4c Task 6, while writing the `generate` row's advertisement. The plan's premise
table said *"generator params already project as JSON Schema (`paramSchema` via
`toJsonSchema`, structured-clone-safe)"* and instructed Task 6 not to author a second
schema for them. The premise is true about the DATA and false about the REACH: nothing
hands that document to an agent.

## Context

`defineGenerator` (`packages/core/src/field/registry.ts`) reflects each generator's zod
params into a plain-JSON `paramSchema` and a `defaults` record — exactly the document an
agent would need. It lives on the `GeneratorDef` in core's registry, which is behind the
engine, which the Node-portable daemon may not import. The only reader is
`FieldHost.listGenerators()`, a method in the browser tab, and there is no relayed read
that calls it — so `generate {generatorId, params}` advertises `params` as a free-form
object because that is exactly what `dispatch` enforces, and an agent has no way to
learn a param NAME.

Task 6 shipped the two mitigations that were in its scope, and they make the gap
survivable rather than closed:

- **Every param has a default** (`defaultsOf`), and `field-mutation.ts`'s `generate`
  overlays the caller's half onto them — so `generate {generatorId, region}` with no
  params at all is a complete, working call. Composition works; TUNING does not.
- **`generatorById` now names the registered ids in its refusal** (a one-line inline fix
  in the same commit), so a wrong id teaches instead of stonewalling.
- A wrong param NAME or value is refused by core's `parseOrThrow` with the generator and
  the failing path in the message, so an agent that guesses can at least read why it was
  wrong — one guess per round trip.

## Why it was not fixed at Task 6

Closing it is a SEAM, not an advertisement: a relayed read (`FieldHost.listGenerators`
→ an answerer row → a daemon command) plus a TENTH tool, against a door whose ceiling is
ten and which spent nine. That is Task 3/4-shaped work — a wire contract, an answerer,
a schema and its pins — and Task 6 was the advertisement task. Filing it kept the
scope honest rather than growing the tranche's last code task by a seam.

## The decision it needs

1. **A tenth tool, `generator_list`** — spends the last budgeted slot on discovery.
   Cheap to describe, honest, and the shape every other read already has. The cost is
   that the slot is then gone, and the next verb has to argue against a full door.
2. **Fold it into `session_query` as a fourth `about` arm** (`{about: "generators"}`) —
   costs no tool slot and matches the "one parameterized read" trade `shared/wire.ts`
   already argues. The cost is that `session.query` is currently SPATIAL (its module is
   `field-query.ts`, its answers are geometry) and a registry catalogue is a different
   question wearing the same verb.
3. **Put the four param documents in the `generate` row's description** — rejected on
   sight and recorded so nobody re-proposes it: it is a hand-copy of a registry the
   daemon cannot import, in prose, with no pin that could catch the drift.

**(2) is cheaper than it looks and is the one to reach for first.** It spends no tool slot,
it needs no new daemon command and no new advertised row — one arm on an existing
discriminated union, one answerer branch calling `listGenerators()`, and the projection
follows automatically because the door reflects the schema `dispatch` runs. The honest cost is
conceptual rather than mechanical: `session.query` is SPATIAL today (its module is
`field-query.ts`, its answers are geometry) and a registry catalogue is a different question
wearing the same verb. (1) is the honester shape and costs the last budgeted slot. The
tie-breaker is whether a generator catalogue is a "query" in the sense that verb already
means — and if the gate walk shows this biting, take (2) and note the stretch rather than
spending the slot under time pressure.

## Trigger to revisit

- **The T4c gate walk**, which is the measurement: if the driving agent needed a param
  it could not name — or reached for one and guessed wrong — this is worth a slice. If
  it built its world on defaults alone, the gap is theoretical and can wait.

## Reference

- `packages/core/src/field/registry.ts` (`defineGenerator`, `defaultsOf`);
  `packages/editor/src/field-host/field-host.ts` (`listGenerators`, `FieldGeneratorInfo`);
  `packages/editor/src/daemon/session-handlers.ts` (the `generate` command's comment,
  which states this gap at the declaration);
  `docs/reference/editor-architecture.md` §27.4.

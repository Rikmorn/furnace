// The CHROME's half of the three WRITE verbs and the INTERRUPT — the answerer rows, on
// their own.
//
// HERE AND NOT IN `tests/chrome/`, for `session-capture.test.ts`'s reason exactly: none of
// these rows needs a shell or a DOM. Three read a ref and call one host verb; the fourth
// reads a ref and calls one function. `tests/chrome/session-state.test.tsx` mounts a real shell
// because what is under test there is which MIRRORS a projection reads — there are no
// mirrors here.
//
// WHAT IT PINS is the RELAY: that each row reaches the thing it is supposed to reach, hands
// over what it was given without reshaping it, and answers honestly when the seam behind it
// is not there. What each verb DOES is pinned where it lives — the mutation seam in
// `tests/field-host/mutation.test.ts`, the action funnel in `tests/actions.test.ts`, the
// daemon's schemas in `tests/handlers.test.ts`.
import { expect, test } from "bun:test";
import { ACTION_OK, type ActionResult } from "../src/action-registry/index.ts";
import type { FieldHost } from "../src/field-host/index.ts";
import type { ActionDispatch } from "../src/frontend/lib/session-answerers.ts";
import { createSessionAnswerers } from "../src/frontend/lib/session-answerers.ts";
import { AGENT_ORIGIN } from "../src/shared/wire.ts";

/** A host that records the two mutation calls and answers a fixed value each.
 *
 *  Boundary cast: these rows reach exactly two members of the facade, and a whole
 *  `FieldHost` here would be seventy stubs proving nothing about a relay. */
function stubHost(cancels = true): {
  host: FieldHost;
  applied: unknown[];
  generated: unknown[];
  /** The trailing `origin` each mutating call arrived with, in call order — the one thing
   *  this seam is the SOLE author of (`shared/wire.ts`'s `AGENT_ORIGIN`). */
  origins: unknown[];
  escapes: number;
} {
  const applied: unknown[] = [];
  const generated: unknown[] = [];
  const origins: unknown[] = [];
  let escapes = 0;
  const host = {
    applyOps: (ops: unknown, origin?: unknown) => {
      applied.push(ops);
      origins.push(origin);
      return ACTION_OK;
    },
    generate: (req: unknown, origin?: unknown) => {
      generated.push(req);
      origins.push(origin);
      return { ok: true as const, entityId: 11, generator: "hall" };
    },
    // The Esc stack's own boolean, which is what `session.interrupt` branches on: `true`
    // = the top rung was cancelled, `false` = nothing was standing.
    escape: () => {
      escapes++;
      return cancels;
    },
  } as unknown as FieldHost;
  return {
    host,
    applied,
    generated,
    origins,
    get escapes() {
      return escapes;
    },
  };
}

/** The three refs the factory takes, with only the ones a case cares about filled. */
function rows(over: {
  host?: FieldHost;
  dispatch?: ActionDispatch | null;
}): Record<string, (params: unknown) => unknown> {
  return createSessionAnswerers(
    { current: null },
    { current: over.host },
    { current: over.dispatch ?? null },
  );
}

const row = (
  answerers: Record<string, (params: unknown) => unknown>,
  name: string,
): ((params: unknown) => unknown) => {
  const handler = answerers[name];
  if (handler === undefined) throw new Error(`test: no "${name}" answerer`);
  return handler;
};

/** Narrow an answer to a refusal, failing loudly rather than casting past it. */
function refusal(answer: unknown): { message: string; because: string } {
  const r = answer as ActionResult;
  if (r.ok) throw new Error("expected a refusal, got ok");
  if (r.kind !== "refused") throw new Error(`expected refused, got ${r.kind}`);
  return { message: r.message, because: r.because };
}

// --- edit.apply -------------------------------------------------------------

test("edit.apply hands the ops to the host UNRESHAPED and returns its verdict", () => {
  const { host, applied } = stubHost();
  const ops = [
    {
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    },
  ];
  expect(row(rows({ host }), "edit.apply")({ ops })).toEqual({ ok: true });
  // THE SAME ARRAY BY IDENTITY, and `toBe` rather than `toEqual` is the whole assertion —
  // measured, not assumed. Written as `expect(applied).toEqual([ops])` this case stayed
  // GREEN while the row rebuilt every op (`req.ops.map((o) => ({ ...o }))`), because deep
  // equality cannot tell a passthrough from a faithful copy. A copy is harmless today and
  // is exactly where a field silently stops being forwarded tomorrow: the row would be a
  // second author of the op vocabulary between the schema and the engine, and both ends
  // would still typecheck.
  expect(applied.length).toBe(1);
  expect(applied[0]).toBe(ops);
});

test("edit.apply with no engine REFUSES — it does not throw, and it does not claim ok", () => {
  // THE OPPOSITE POSTURE FROM `viewport.capture`, decided by what an honest answer would be.
  // A read has none (there is no picture of a viewport that does not exist), so that row
  // throws. A WRITE has one, and it is the ordinary refusal the caller is already branching
  // on — throwing would cost it the CLASS, which is the half it can act on.
  const r = refusal(row(rows({}), "edit.apply")({ ops: [] }));
  expect(r.because).toBe("inert");
  expect(r.message).toContain("engine is not up");
});

// --- generate ---------------------------------------------------------------

test("generate passes the request straight through and returns the committed record", () => {
  const { host, generated } = stubHost();
  const req = {
    generatorId: "hall",
    region: { min: [0, 0, 0], max: [8, 5, 8] },
  };
  expect(row(rows({ host }), "generate")(req)).toEqual({
    ok: true,
    entityId: 11,
    generator: "hall",
  });
  // NO FIELD-BY-FIELD COPY at this seam, unlike `viewport.capture`'s row — the wire's
  // `GenerateRequest` and the host's are structurally one shape, so the whole object
  // travels and the compiler is what keeps them equal. This pins that nothing is dropped
  // on the way, which is the risk a passthrough carries in exchange.
  expect(generated).toEqual([req]);
});

test("generate with no engine REFUSES in the same words edit.apply does", () => {
  // ONE state, one sentence, one class — the two write rows share `noEngine` precisely so a
  // caller cannot conclude they mean different things.
  const a = refusal(row(rows({}), "edit.apply")({ ops: [] }));
  const g = refusal(row(rows({}), "generate")({ generatorId: "hall" }));
  expect(g.because).toBe("inert");
  expect(g.message).toBe(a.message);
});

// --- action.run -------------------------------------------------------------

test("action.run dispatches THROUGH the ref, id and input intact", async () => {
  const seen: { id: string; input: unknown }[] = [];
  const dispatch: ActionDispatch = (id, input) => {
    seen.push({ id, input });
    return Promise.resolve(ACTION_OK);
  };
  const answer = await row(
    rows({ dispatch }),
    "action.run",
  )({
    id: "world.saveAs",
    input: { name: "copy" },
  });
  expect(answer).toEqual({ ok: true });
  expect(seen).toEqual([{ id: "world.saveAs", input: { name: "copy" } }]);
});

test("action.run relays an ABSENT input as absent — the ctx-fallback half of the split", async () => {
  // "No input at all" is a legitimate call for all 39 verbs and the ONLY legal call for 33
  // of them: the chrome dispatches with nothing and each run falls back to what is
  // selected. A row that substituted `{}` would turn that into a caller that named an empty
  // object, which is a different request for the six that take one.
  const seen: unknown[] = [];
  const dispatch: ActionDispatch = (_id, input) => {
    seen.push(input);
    return Promise.resolve(ACTION_OK);
  };
  await row(rows({ dispatch }), "action.run")({ id: "edit.undo" });
  expect(seen).toEqual([undefined]);
});

test("action.run before the shell has rendered REFUSES, and says which absence it is", async () => {
  // A DIFFERENT absence from a missing engine — the shell has not committed a render, so
  // there is no ctx to dispatch against. Same class (`inert`: wait and it fixes itself),
  // deliberately different sentence, because an agent that cannot tell them apart cannot
  // tell what it is waiting FOR.
  const r = refusal(
    await row(rows({ dispatch: null }), "action.run")({ id: "edit.undo" }),
  );
  expect(r.because).toBe("inert");
  expect(r.message).toContain("finished rendering");
  const engine = refusal(row(rows({}), "edit.apply")({ ops: [] }));
  expect(r.message).not.toBe(engine.message);
});

// --- session.interrupt ------------------------------------------------------

test("session.interrupt drains ONE rung and answers ok", () => {
  const stub = stubHost();
  expect(row(rows({ host: stub.host }), "session.interrupt")({})).toEqual({
    ok: true,
  });
  // ONE call per verb, and the count is the assertion rather than a formality: the whole
  // scope of this verb is that it is the Esc KEY, and a row that drained the stack in a
  // loop would take away states the human put there with nothing in the payload warning
  // them. An agent with two things standing calls it twice.
  expect(stub.escapes).toBe(1);
});

test("session.interrupt with NOTHING standing refuses rather than claiming ok", () => {
  // The distinction an agent driving a sequence needs: a silent `ok` over a no-op reads as
  // "the session you asked me to close is closed" to a caller that never saw one open.
  // `inert` is the class by its own definition — the verb cannot act on what it has, and an
  // immediate retry gets the same word back.
  const r = refusal(
    row(rows({ host: stubHost(false).host }), "session.interrupt")({}),
  );
  expect(r.because).toBe("inert");
  expect(r.message).toContain("nothing to interrupt");
});

test("session.interrupt with no engine refuses in the write rows' own words", () => {
  // It is a WRITE for this purpose — it changes what the editor is doing — so it shares
  // `noEngine` with `edit.apply` and `generate` rather than throwing the way the reads do.
  const a = refusal(row(rows({}), "edit.apply")({ ops: [] }));
  const i = refusal(row(rows({}), "session.interrupt")({}));
  expect(i.because).toBe("inert");
  expect(i.message).toBe(a.message);
});

// --- the wire, cut ----------------------------------------------------------

test("SABOTAGE: with both seams unfilled, every brokered verb refuses and none throws", async () => {
  // THE NAMED SABOTAGE FOR THIS TASK, kept as a standing case rather than performed once by
  // hand. The two refs ARE the wire — `fieldHostRef` for the three host rows, `dispatchRef`
  // for the door — and this is what an agent meets if either is never filled: four typed
  // refusals and not one throw, so the failure lands as an answer rather than as a
  // `session-timeout` that says the tab was silent.
  //
  // The distinction is worth the case: a THROW here becomes `internal` at the MCP door,
  // which tells an agent the daemon is broken. A refusal tells it to wait. Those are
  // opposite instructions and the difference is one unfilled ref.
  const bare = rows({});
  const answers = [
    row(bare, "edit.apply")({ ops: [] }),
    row(bare, "generate")({ generatorId: "hall" }),
    await row(bare, "action.run")({ id: "edit.undo" }),
    row(bare, "session.interrupt")({}),
  ];
  for (const answer of answers) expect(refusal(answer).because).toBe("inert");
});

// --- the stamping seam (undo attribution) -----------------------------------
//
// THIS FILE IS WHERE `AGENT_ORIGIN` IS AUTHORED, and that is the whole of the trust
// argument. The daemon does not stamp it and the agent never declares it: `backchannel.ask`
// has exactly one producer (`daemon/session-handlers.ts`) and this registry is invoked only
// for a request that arrived on this tab's daemon feed, so everything reaching these rows is
// agent-initiated BY CONSTRUCTION. The chrome's own four daemon calls (`frontend/lib/api.ts`)
// are `generation.bake`, `project.get`, `session.answer` and `world.list` — none of the three
// mutating verbs — and every chrome surface dispatches locally through `dispatchRef` instead.
//
// So a case here is not "the row forwards a parameter it was given"; it is "the row INVENTS
// the right one". A row that forwarded `undefined` would type-check, pass every other case in
// this file, and silently leave every agent write reading as the human's.

test("edit.apply stamps AGENT_ORIGIN — the tab asserts authorship, the caller never claims it", () => {
  const { host, origins } = stubHost();
  // No `origin` anywhere in the request, and there is no field for one on `EditApplyRequest`
  // by design: a self-declared author is a claim, and this seam is the only place that fact
  // is knowable rather than asserted.
  row(
    rows({ host }),
    "edit.apply",
  )({ ops: [{ kind: "brush", effect: "dig" }] });
  expect(origins).toEqual([AGENT_ORIGIN]);
});

test("generate stamps AGENT_ORIGIN too — one tag for every write on this seam", () => {
  const { host, origins } = stubHost();
  row(rows({ host }), "generate")({ generatorId: "hall" });
  expect(origins).toEqual([AGENT_ORIGIN]);
});

test("action.run relays AGENT_ORIGIN as its THIRD argument, beside the id and the input", async () => {
  // The door's own stamping: a named verb's run reaches the host through the ctx, so the tag
  // travels as a dispatch argument the provider folds into `ActionCtx.origin` rather than as
  // anything on the wire.
  const seen: unknown[] = [];
  const dispatch: ActionDispatch = (_id, _input, opOrigin) => {
    seen.push(opOrigin);
    return Promise.resolve(ACTION_OK);
  };
  await row(rows({ dispatch }), "action.run")({ id: "edit.duplicate" });
  expect(seen).toEqual([AGENT_ORIGIN]);
});

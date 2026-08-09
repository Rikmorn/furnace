import { afterEach, expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type Backchannel,
  createBackchannel,
  DEFAULT_ASK_TIMEOUT_MS,
} from "../src/daemon/backchannel.ts";
import { createClaims } from "../src/daemon/claims.ts";
import { EditorError } from "../src/daemon/errors.ts";
import { createEventHub, type EventHub } from "../src/daemon/events.ts";
import { dispatch, type Handlers } from "../src/daemon/handlers.ts";
import { createSessionHandlers } from "../src/daemon/session-handlers.ts";
import type { SessionAnswer, SessionRequest } from "../src/shared/wire.ts";

// The relay, at the level where its RULES live — the `tests/claims.test.ts` posture, and
// for the same reason: every hub, claim table and handler map below is the REAL one, wired
// the way `startServer` wires them, so what is proved is that these modules compose rather
// than that a mock behaved. The connection is the only fake, because a socket is the one
// thing a headless case cannot conjure.
//
// The half only a live server can answer — that a `session.answer` POST over HTTP reaches
// this table at all — is asked once in `tests/server.test.ts`. The CHROME's half (a request
// frame arriving on an `EventSource` and coming back as a POST) is
// `tests/chrome/session-answer.test.tsx`. Three files, three questions, no overlap.

/** A structural stand-in for the request/response pair the hub holds. The third of its
 *  kind (`events.test.ts`, `claims.test.ts`) and deliberately a third copy rather than a
 *  shared helper — this one needs neither of the others' subjects (no per-runtime departure
 *  split, no header capture) and needs one thing neither has: reading a `session-request`
 *  frame back OFF the wire, which is how a test gets a requestId the way the chrome does. */
type FakeConnection = {
  chunks: string[];
  /** The client left. Both halves, as Node reports it; the hub latches it to one. */
  die(): void;
  req: IncomingMessage;
  res: ServerResponse;
};

function fakeConnection(): FakeConnection {
  const onClose: (() => void)[] = [];
  const fake: FakeConnection = {
    chunks: [],
    die: () => {
      for (const handler of [...onClose]) handler();
    },
    req: undefined as never,
    res: undefined as never,
  };
  // Boundary cast ×2: the hub calls writeHead/write/end/on("close") on the response and
  // on("close") alone on the request, and nothing else on either.
  fake.res = {
    writeHead() {
      return fake.res;
    },
    write(chunk: string) {
      fake.chunks.push(chunk);
      return true;
    },
    end() {
      // no-op: nothing to flush in a fake
    },
    on(event: string, handler: () => void) {
      if (event === "close") onClose.push(handler);
      return fake.res;
    },
  } as unknown as ServerResponse;
  fake.req = {
    on(event: string, handler: () => void) {
      if (event === "close") onClose.push(handler);
      return fake.req;
    },
  } as unknown as IncomingMessage;
  return fake;
}

/** Every `session-request` this connection has been sent, parsed off its own frames —
 *  i.e. exactly what the chrome's `EventSource` listener receives, read through the real
 *  wire format rather than handed over by the module under test. A test that took the
 *  requestId from anywhere else would not be pinning the correlation at all. */
function requestsTo(connection: FakeConnection): SessionRequest[] {
  return connection.chunks
    .filter((chunk) => chunk.startsWith("event: session-request"))
    .map((chunk) => {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      return JSON.parse((line ?? "").slice("data: ".length)) as SessionRequest;
    });
}

const open: EventHub[] = [];
afterEach(() => {
  for (const hub of open.splice(0)) hub.close();
});

/** A daemon's worth of session machinery, wired as `startServer` wires it — plus the
 *  command registry the answer comes back through, so the POST path is the real one. */
function daemon(): {
  hub: EventHub;
  claims: ReturnType<typeof createClaims>;
  backchannel: Backchannel;
  handlers: Handlers;
  /** A subscriber that has ALSO claimed a world — i.e. an editing session. */
  session(world: string | null): FakeConnection;
  /** A subscriber that has claimed nothing — a tab that is merely connected. */
  guest(): FakeConnection;
} {
  const hub = createEventHub();
  open.push(hub);
  const claims = createClaims();
  hub.onClose((connection) => claims.release(connection));
  const backchannel = createBackchannel(hub, claims);
  const handlers = createSessionHandlers({
    claims,
    connectionFor: (token) => hub.connectionFor(token),
    backchannel,
  });
  const guest = (): FakeConnection => {
    const connection = fakeConnection();
    hub.subscribe(connection.req, connection.res);
    return connection;
  };
  return {
    hub,
    claims,
    backchannel,
    handlers,
    guest,
    session(world) {
      const connection = guest();
      claims.claim(world, connection.res);
      return connection;
    },
  };
}

/** Answer a request the way the chrome does: through the command registry, with the
 *  daemon's own validator in the path. */
function answer(handlers: Handlers, body: SessionAnswer): Promise<unknown> {
  return dispatch(handlers, "session.answer", body);
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return err instanceof EditorError ? err.code : `not an EditorError: ${err}`;
  }
  return "did not reject";
}

// --- the round trip -----------------------------------------------------------

test("a question reaches the claimed session and its answer resolves the ask", async () => {
  const { backchannel, handlers, session } = daemon();
  const tab = session("cavern");

  const asked = backchannel.ask("session.ping", { hello: 1 });

  const [request] = requestsTo(tab);
  expect(request?.method).toBe("session.ping");
  expect(request?.params).toEqual({ hello: 1 });
  // The id is minted by the daemon and travels ONLY inside the frame — which is what makes
  // it usable as the answer's whole credential (`session-handlers.ts` argues that).
  expect(request?.requestId).toMatch(/./);

  expect(
    await answer(handlers, {
      requestId: request?.requestId ?? "",
      ok: true,
      payload: { echo: { hello: 1 } },
    }),
  ).toEqual({ delivered: true });
  expect(await asked).toEqual({ echo: { hello: 1 } });
});

test("two concurrent asks resolve to their OWN answers", async () => {
  // THE CORRELATION TABLE'S WHOLE REASON FOR EXISTING. One ask needs no table — a single
  // pending promise would do — so this is the case that says the id is load-bearing. The
  // two are answered in REVERSE order deliberately: an implementation that paired answers
  // with asks by arrival would pass a same-order case and fail this one, and arrival order
  // over a network is not something the daemon gets to assume.
  const { backchannel, handlers, session } = daemon();
  const tab = session("cavern");

  const first = backchannel.ask("session.ping", "first");
  const second = backchannel.ask("session.ping", "second");

  const [a, b] = requestsTo(tab);
  expect(a?.requestId).not.toBe(b?.requestId);

  await answer(handlers, {
    requestId: b?.requestId ?? "",
    ok: true,
    payload: "answer-to-second",
  });
  await answer(handlers, {
    requestId: a?.requestId ?? "",
    ok: true,
    payload: "answer-to-first",
  });

  expect(await first).toBe("answer-to-first");
  expect(await second).toBe("answer-to-second");
});

// --- the answers that are not answers -----------------------------------------

test("silence becomes a typed `session-timeout`, never a hang", async () => {
  const { backchannel, session } = daemon();
  session("cavern");
  // 20 ms rather than the real budget: what is under test is that the timer fires and what
  // it produces, and the budget itself is pinned as an inequality one case down.
  expect(await codeOf(backchannel.ask("session.ping", null, 20))).toBe(
    "session-timeout",
  );
});

test("the default budget sits inside the client timer that would otherwise expire first", () => {
  // The number is an argument, so the pin is the argument rather than the number. Claude
  // Code's per-request timer for an HTTP/SSE MCP server covers each call through to the
  // server's first response byte and is 60 s, and setting `timeout` / `MCP_TOOL_TIMEOUT`
  // can only RAISE it — a lower value does not shorten it (`code.claude.com/docs/en/mcp`,
  // read 2026-08-09). So 60 s is a floor no client configuration goes under, and a daemon
  // budget above it would mean the caller dying before the typed error it was written for
  // could reach it. Raising this constant past the floor is the edit this case exists to
  // stop.
  expect(DEFAULT_ASK_TIMEOUT_MS).toBeLessThan(60_000);
});

test("a handler that answers `undefined` round-trips — the key JSON drops is not malformed", async () => {
  // THE HOLE SPEC REVIEW FOUND, pinned through the REAL serializer rather than by a
  // hand-written body: `JSON.stringify` drops an undefined-valued key, so a handler that
  // answers `undefined` puts `{"requestId":…,"ok":true}` on the wire. Under a bare
  // `z.unknown()` that 400s ("expected nonoptional, received undefined", measured on zod
  // 4.4.3) — and the cost lands three hops away, because the chrome's POST failure was
  // silent and the asker waited out the whole budget to be told `session-timeout`. A
  // sentence about how FAST the session is, for a handler that answered instantly.
  //
  // The JSON round trip is what makes this a pin rather than a restatement of the schema:
  // nothing here decides to omit the key, the serializer does, exactly as it does in the
  // chrome.
  const { backchannel, handlers, session } = daemon();
  const tab = session("cavern");
  const asked = backchannel.ask("session.ping", null);
  const [request] = requestsTo(tab);

  const onTheWire = JSON.parse(
    JSON.stringify({
      requestId: request?.requestId ?? "",
      ok: true,
      payload: undefined,
    }),
  ) as SessionAnswer;
  expect(Object.hasOwn(onTheWire, "payload")).toBe(false);

  expect(await dispatch(handlers, "session.answer", onTheWire)).toEqual({
    delivered: true,
  });
  expect(await asked).toBeUndefined();
});

test("an explicit `null` payload stays distinct from an absent one", async () => {
  // `.optional()` widened the schema, so this states what it did NOT flatten: a handler
  // that returns `null` means something a handler that returns nothing does not, and the
  // relay preserves the difference rather than coercing on the way past.
  const { backchannel, handlers, session } = daemon();
  const tab = session("cavern");
  const asked = backchannel.ask("session.ping", null);

  await answer(handlers, {
    requestId: requestsTo(tab)[0]?.requestId ?? "",
    ok: true,
    payload: null,
  });
  expect(await asked).toBeNull();
});

test("params that cannot ride the wire reject TYPED, rather than throwing past the contract", async () => {
  // `emitTo` → `frameFor` → `JSON.stringify` raises SYNCHRONOUSLY on a cycle, and `ask`'s
  // contract promises one of THREE codes (`no-session`, `session-timeout`, `internal` — four
  // clauses in its `@throws`, but `internal` covers two of them, this being one; the number a
  // caller branches on is the codes, and "four" was the propagated slip, corrected at T4b
  // Task 7). Without the guard the raw `TypeError` escapes with
  // `code: undefined`, and the entry sits out its whole budget before the timer clears it —
  // not a leak, but ten seconds of a caller waiting for a frame that was never written.
  const { backchannel, session } = daemon();
  const tab = session("cavern");
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;

  expect(await codeOf(backchannel.ask("session.ping", cyclic))).toBe(
    "internal",
  );
  // Nothing was written to the session, and nothing is left pending: the next ask gets a
  // clean table and a real frame. Its rejection is CONSUMED rather than dropped — an
  // unhandled one bleeds into whichever case is running when Bun surfaces it.
  expect(requestsTo(tab)).toEqual([]);
  const next = backchannel.ask("session.ping", "fine", 20);
  expect(requestsTo(tab)).toHaveLength(1);
  expect(await codeOf(next)).toBe("session-timeout");
});

test("a session that cannot serve the method says so, and the ask fails typed", async () => {
  // The reachable route is version skew: the `bun run edit` loop restarts the daemon on
  // every source change while the tab keeps its bundle, so a daemon can know a method this
  // chrome has never heard of. Answered rather than ignored — an ignored one would time
  // out, which says "the session is slow" about a session that is fine.
  const { backchannel, handlers, session } = daemon();
  const tab = session("cavern");
  const asked = backchannel.ask("session.somethingNew", null);
  const [request] = requestsTo(tab);

  await answer(handlers, {
    requestId: request?.requestId ?? "",
    ok: false,
    error: 'no answerer for "session.somethingNew"',
  });

  expect(await codeOf(asked)).toBe("internal");
});

// --- who can be asked ---------------------------------------------------------

test("no claimed session → `no-session` at once, with nothing written to anyone", async () => {
  const { backchannel, guest } = daemon();
  // A CONNECTED tab is not a session. The claim is what makes one, and a subscriber that
  // never claimed is a guest — which is also what an MCP client is (`daemon/events.ts`).
  const bystander = guest();
  const before = bystander.chunks.length;

  expect(await codeOf(backchannel.ask("session.ping", null))).toBe(
    "no-session",
  );
  expect(bystander.chunks.length).toBe(before);
});

test("two claimed sessions have no single one to speak for — refused, not picked", async () => {
  // The table allows one claim per WORLD, so two tabs on two worlds are both legitimate and
  // this is a real state rather than a defensive branch. Picking one would give an agent a
  // read of a tab the human is not in, with nothing anywhere saying so.
  const { backchannel, session } = daemon();
  const a = session("cavern");
  const b = session("grotto");

  expect(await codeOf(backchannel.ask("session.ping", null))).toBe(
    "no-session",
  );
  expect(requestsTo(a)).toEqual([]);
  expect(requestsTo(b)).toEqual([]);
});

test("a request is ADDRESSED — a second subscriber never sees another session's question", async () => {
  // The negative half of the addressed emit. A broadcast would have N tabs answer one
  // question, N−1 of them about a session nobody asked about, and the first answer to
  // arrive would win — a read that is silently about the wrong tab.
  const { backchannel, handlers, session, guest } = daemon();
  const tab = session("cavern");
  const bystander = guest();

  const asked = backchannel.ask("session.ping", null);
  expect(requestsTo(tab)).toHaveLength(1);
  expect(requestsTo(bystander)).toEqual([]);

  await answer(handlers, {
    requestId: requestsTo(tab)[0]?.requestId ?? "",
    ok: true,
    payload: "ok",
  });
  expect(await asked).toBe("ok");
});

// --- the pending table's lifetime ---------------------------------------------

test("the session's departure rejects its pending asks AT ONCE, with `no-session`", async () => {
  // Not `session-timeout`, and not after ten seconds: the true answer is "the tab you were
  // reading closed", which is a different remedy from "it is slow, wait longer". The
  // rejection lands on the hub's close hook, which the backchannel registers for ITSELF —
  // cutting that registration is the sabotage this case reds on.
  const { backchannel, session } = daemon();
  const tab = session("cavern");
  const asked = backchannel.ask("session.ping", null);

  tab.die();

  expect(await codeOf(asked)).toBe("no-session");
});

test("a departure abandons only ITS OWN pending asks", async () => {
  // Two sessions cannot both be asked at once (the refusal above), so this reaches the
  // per-connection sweep the only way it can be reached: ask one, let a second claim
  // arrive, then kill the second. The first ask must be untouched — a sweep that cleared
  // the whole table on any departure would pass every other case in this file.
  const { backchannel, handlers, session } = daemon();
  const first = session("cavern");
  const asked = backchannel.ask("session.ping", null);
  const second = session("grotto");

  second.die();

  await answer(handlers, {
    requestId: requestsTo(first)[0]?.requestId ?? "",
    ok: true,
    payload: "still here",
  });
  expect(await asked).toBe("still here");
});

// --- an id is one-shot --------------------------------------------------------

test("a late answer settles nothing and is REPORTED as having settled nothing", async () => {
  // The routine race, not an attack: the chrome cannot know its ask has already timed out.
  // Reported rather than refused, because a 4xx here would manufacture a client-side
  // failure for a tab that did the right thing a moment late.
  const { backchannel, handlers, session } = daemon();
  const tab = session("cavern");
  const asked = backchannel.ask("session.ping", null, 20);
  const [request] = requestsTo(tab);
  expect(await codeOf(asked)).toBe("session-timeout");

  expect(
    await answer(handlers, {
      requestId: request?.requestId ?? "",
      ok: true,
      payload: "too late",
    }),
  ).toEqual({ delivered: false });
});

test("a SECOND answer cannot settle a second ask", async () => {
  // The constraint stated at `claim()`: an entry leaves the table before it is settled, so
  // a repeated id names nothing. Without that, a chrome that posted twice (a retry, a
  // double effect) would resolve whatever ask happened to be sitting under the same key.
  const { backchannel, handlers, session } = daemon();
  const tab = session("cavern");
  const first = backchannel.ask("session.ping", "one");
  const requestId = requestsTo(tab)[0]?.requestId ?? "";

  expect(await answer(handlers, { requestId, ok: true, payload: "A" })).toEqual(
    {
      delivered: true,
    },
  );
  expect(await first).toBe("A");

  const second = backchannel.ask("session.ping", "two", 20);
  expect(await answer(handlers, { requestId, ok: true, payload: "B" })).toEqual(
    { delivered: false },
  );
  expect(await codeOf(second)).toBe("session-timeout");
});

test("an invented requestId is accepted and delivers nothing", async () => {
  const { handlers } = daemon();
  expect(
    await answer(handlers, {
      requestId: "00000000-0000-4000-8000-000000000000",
      ok: true,
      payload: null,
    }),
  ).toEqual({ delivered: false });
});

// --- the command's own schema --------------------------------------------------

test("`session.answer` demands the discriminant, so a refusal cannot pose as a success", async () => {
  // `ok` is what the ask branches on, so an answer that omits it — or that carries an
  // `error` under `ok: true` — is a malformed REQUEST rather than a refusal to interpret.
  const { handlers } = daemon();
  const badness = [
    { requestId: "x", payload: 1 },
    { requestId: "x", ok: true, error: "mixed" },
    { requestId: "", ok: true, payload: 1 },
  ];
  for (const body of badness) {
    expect(
      await codeOf(dispatch(handlers, "session.answer", body)),
      JSON.stringify(body),
    ).toBe("invalid-input");
  }
});

test("with no event feed, `session.answer` says `no-session` rather than pretending", async () => {
  // The registry the four filesystem suites build. A daemon with no feed asked nobody
  // anything, so there is nothing an answer could settle — which is the true answer and
  // not a stub.
  const handlers = createSessionHandlers(undefined);
  expect(
    await codeOf(
      dispatch(handlers, "session.answer", {
        requestId: "x",
        ok: true,
        payload: null,
      }),
    ),
  ).toBe("no-session");
});

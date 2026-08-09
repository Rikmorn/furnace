import { afterEach, expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createClaims } from "../src/daemon/claims.ts";
import { createEventHub, type EventHub } from "../src/daemon/events.ts";

// The claim table and the hub that names its connections, at the level where the RULES
// live rather than at the HTTP edge. `tests/server.test.ts` asks the other question —
// does a real POST over a real socket reach any of this — and asks it once per shape;
// what is asked here is what the table DOES, where a case costs nothing and the
// orderings that are hard to provoke over a network are one function call apart.

/** A structural stand-in for the request/response pair the hub holds. A near-twin of the
 *  one in `events.test.ts` and deliberately a second copy rather than a shared helper:
 *  two is not three, and the shapes have already diverged — this one has to fire a
 *  departure on EITHER half on demand, which is a subject of its own below.
 *
 *  The two `die*` verbs are named for the runtimes rather than for the objects, because
 *  that is what the distinction turns out to be: `res.on("close")` fires 2–5 ms after a
 *  disconnect on Node 22 and NEVER on Bun 1.3.14 (measured at T4b Task 2, by raw socket
 *  destroy, `fetch` abort and reader cancel alike), and the editor's own `edit` scripts
 *  start this daemon on Bun. `subscribe` therefore watches both and latches once. */
type FakeConnection = {
  chunks: string[];
  /** The departure signal Node raises and Bun does not. */
  dieAsNodeDoes(): void;
  /** The departure signal BOTH raise — the one the live editor actually gets. */
  dieAsBunDoes(): void;
  /** Both, in the order Node fires them. */
  die(): void;
  req: IncomingMessage;
  res: ServerResponse;
};

function fakeConnection(): FakeConnection {
  const onRes: (() => void)[] = [];
  const onReq: (() => void)[] = [];
  const fire = (handlers: (() => void)[]) => {
    for (const handler of handlers) handler();
  };
  const fake: FakeConnection = {
    chunks: [],
    dieAsNodeDoes: () => fire(onRes),
    dieAsBunDoes: () => fire(onReq),
    die: () => {
      fire(onRes);
      fire(onReq);
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
      if (event === "close") onRes.push(handler);
      return fake.res;
    },
  } as unknown as ServerResponse;
  fake.req = {
    on(event: string, handler: () => void) {
      if (event === "close") onReq.push(handler);
      return fake.req;
    },
  } as unknown as IncomingMessage;
  return fake;
}

/** The token the hub minted for a connection, read off its first frame — i.e. exactly
 *  the way the chrome gets it, through the wire rather than through a back door. */
function tokenOf(connection: FakeConnection): string {
  const frame = connection.chunks.find((c) =>
    c.startsWith("event: session-token"),
  );
  if (!frame)
    throw new Error(`no session-token frame:\n${connection.chunks.join("")}`);
  const line = frame.split("\n").find((l) => l.startsWith("data: "));
  return (JSON.parse((line ?? "").slice("data: ".length)) as { token: string })
    .token;
}

/** A daemon's worth of session state: the hub and the claims table, wired the way
 *  `server.ts` wires them. Constructing it per case is also the restart pin — see the
 *  case that says so. */
/** Every hub a case built, torn down after it. The heartbeat is `unref`'d and every case
 *  here is synchronous, so nothing is broken by leaving one running — but several cases
 *  pin `chunks.length` across an operation, and one interleaved `: ping` would flip them.
 *  A pinned count is only worth what the quiet around it is worth. */
const open: EventHub[] = [];
afterEach(() => {
  for (const hub of open.splice(0)) hub.close();
});

function daemon(): {
  hub: EventHub;
  claims: ReturnType<typeof createClaims>;
  subscribe(): FakeConnection;
} {
  const hub = createEventHub();
  open.push(hub);
  const claims = createClaims();
  hub.onClose((connection) => claims.release(connection));
  claims.onDrop((connection, world) =>
    hub.emitTo(connection, { type: "claim-lost", world }),
  );
  return {
    hub,
    claims,
    subscribe() {
      const connection = fakeConnection();
      hub.subscribe(connection.req, connection.res);
      return connection;
    },
  };
}

// --- the table's own rules ----------------------------------------------------

test("one connection holds a world; a second is refused and changes nothing", () => {
  const { claims, subscribe } = daemon();
  const a = subscribe();
  const b = subscribe();

  expect(claims.claim("cavern", a.res)).toBe(true);
  expect(claims.claim("cavern", b.res)).toBe(false);
  // The refusal is not a partial write: the world is still A's afterwards, which is the
  // half a `delete`-then-`set` implementation would get wrong while still returning false.
  expect(claims.holder("cavern")).toBe(a.res);
});

test("a connection re-claiming its OWN world is granted, not refused", () => {
  const { claims, subscribe } = daemon();
  const a = subscribe();
  expect(claims.claim("cavern", a.res)).toBe(true);
  expect(claims.claim("cavern", a.res)).toBe(true);
  expect(claims.holder("cavern")).toBe(a.res);
});

test("the untitled session is a KEY, distinct from every named world", () => {
  // `null` is what the chrome calls a fresh session, and it is the commonest claim there
  // is — a user digs long before they name anything. Two tabs contend for it, which is
  // the policy's own answer: they cannot both be the session an agent drives.
  const { claims, subscribe } = daemon();
  const a = subscribe();
  const b = subscribe();

  expect(claims.claim(null, a.res)).toBe(true);
  expect(claims.claim(null, b.res)).toBe(false);
  // …and it collides with nothing on disk: B is free to take a named world.
  expect(claims.claim("cavern", b.res)).toBe(true);
  expect(claims.holder(null)).toBe(a.res);
  expect(claims.holder("cavern")).toBe(b.res);
});

test("a connection holds AT MOST ONE world — claiming a second releases the first", () => {
  // The reachable case: a tab that claimed the untitled scratch, then opened `cavern`,
  // then reconnected. Without this it would still be blocking itself out of a world it
  // abandoned, and nothing would ever clear the entry but the tab closing.
  const { claims, subscribe } = daemon();
  const a = subscribe();
  const b = subscribe();

  claims.claim(null, a.res);
  claims.claim("cavern", a.res);
  expect(claims.holder("cavern")).toBe(a.res);
  expect(claims.holder(null)).toBeUndefined();
  expect(claims.claim(null, b.res)).toBe(true);
});

// --- steal, and who is told ---------------------------------------------------

test("steal transfers the claim and tells ONLY the connection that lost it", () => {
  const { claims, subscribe } = daemon();
  const a = subscribe();
  const b = subscribe();
  claims.claim("cavern", a.res);
  const before = b.chunks.length;

  claims.steal("cavern", b.res);

  expect(claims.holder("cavern")).toBe(b.res);
  const lost = a.chunks.at(-1);
  expect(lost).toContain("event: claim-lost\n");
  expect(lost).toContain('data: {"type":"claim-lost","world":"cavern"}');
  // The winner hears nothing. A broadcast would blank the tab that just won.
  expect(b.chunks.length).toBe(before);
});

test("stealing an UNHELD world simply claims it, and notifies nobody", () => {
  // A steal follows a refusal by at least one human decision, and the holder can close
  // in that window. Refusing here would send the user back to a claim that now succeeds.
  const { claims, subscribe } = daemon();
  const a = subscribe();
  const before = a.chunks.length;
  claims.steal("cavern", a.res);
  expect(claims.holder("cavern")).toBe(a.res);
  expect(a.chunks.length).toBe(before);
});

test("stealing a world you already hold notifies nobody", () => {
  const { claims, subscribe } = daemon();
  const a = subscribe();
  claims.claim("cavern", a.res);
  const before = a.chunks.length;
  claims.steal("cavern", a.res);
  expect(claims.holder("cavern")).toBe(a.res);
  // Announcing this would tell a tab it lost a world it is still holding.
  expect(a.chunks.length).toBe(before);
});

// --- the lifetime: the close hook IS the claim's whole lifetime ----------------

test("the hub's close hook releases the claim — the daemon's ONE liveness signal", () => {
  const { claims, subscribe } = daemon();
  const a = subscribe();
  const b = subscribe();
  claims.claim("cavern", a.res);

  a.die();

  expect(claims.holder("cavern")).toBeUndefined();
  // …which is what makes the reconnect design work: nobody holds it, so the next tab
  // (or the same one, reconnected) claims and wins without a steal.
  expect(claims.claim("cavern", b.res)).toBe(true);
});

test("the RESPONSE's departure alone releases — the signal Node raises", () => {
  // The other half of the pair, and the one a future edit is most likely to delete by
  // reasoning "Bun never raises it anyway". It does not: `res.on("close")` is what Node 22
  // raises 2–5 ms after a client disconnects, and the daemon must run on plain Node ≥20
  // (`AGENTS.md`'s shipping contract) as well as under the `edit` scripts' Bun. Dropping
  // the `res` listener would leave every claim held forever on the runtime this daemon is
  // portable TO, and nothing else in the suite would notice.
  const { claims, subscribe } = daemon();
  const a = subscribe();
  claims.claim("cavern", a.res);

  a.dieAsNodeDoes();

  expect(claims.holder("cavern")).toBeUndefined();
});

test("the REQUEST's departure alone releases — the only signal Bun raises", () => {
  // The premise this whole design rides — "the claim dies with the SSE connection" —
  // was FALSE under the runtime the editor is started on until T4b Task 2. Measured:
  // `res.on("close")` fires 2–5 ms after a disconnect on Node 22 and never at all on
  // Bun 1.3.14 (raw socket destroy, `fetch` abort, reader cancel — all three), and both
  // `edit` scripts run this daemon on Bun. `req.on("close")` fires on both, within 2 ms,
  // and on neither while a client is still connected. So the departure a Bun daemon
  // actually observes gets its own case: without the `req` listener this reds, and the
  // whole claim mechanism is dead in the live editor while every other pin stays green.
  const { claims, subscribe } = daemon();
  const a = subscribe();
  claims.claim("cavern", a.res);

  a.dieAsBunDoes();

  expect(claims.holder("cavern")).toBeUndefined();
});

test("one departure is announced ONCE, though Node reports it on both halves", () => {
  // Watching both `req` and `res` means Node raises the departure twice, milliseconds
  // apart, so `onClose` states an exactly-once contract rather than leaving every
  // listener to defend itself. `claims.release` happens to be idempotent, which is why
  // this is asserted at the HUB: the next listener will be Task 3's pending-ask
  // rejector, where a second announcement settles an ask that is already settled.
  const { hub, subscribe } = daemon();
  let announced = 0;
  hub.onClose(() => {
    announced++;
  });
  const a = subscribe();

  a.die(); // both halves, as Node does

  expect(announced).toBe(1);
});

test("release is IDENTITY-CONDITIONAL: a late close cannot revoke a newer claim", () => {
  // THE ONE STRUCTURAL OUTPUT of the T4b Task 0 reconnect spike, pinned rather than
  // commented. Measured ordering: a new subscribe can arrive while the old connection is
  // still open, the old close landing 52 ms AFTER it. A release that deleted by world
  // name would then revoke the claim the reloading tab's OWN new connection had already
  // taken — and the tab would sit unclaimed while believing otherwise, a failure with no
  // symptom until an agent call answers `no-session`.
  const { claims, subscribe } = daemon();
  const old = subscribe();
  const fresh = subscribe();
  claims.claim("cavern", old.res);
  // The old connection is gone from the table before its socket notices.
  claims.steal("cavern", fresh.res);

  old.die();

  expect(claims.holder("cavern")).toBe(fresh.res);
});

test("a fresh hub/claims pair starts empty — nothing survives a restart", () => {
  // The reconciliation with "the daemon stays stateless", as a test: there is no store to
  // clear and no file to ignore, so a restart is a new pair and a new pair is empty.
  const first = daemon();
  const a = first.subscribe();
  first.claims.claim("cavern", a.res);
  expect(first.claims.holder("cavern")).toBe(a.res);

  const second = daemon();
  expect(second.claims.holder("cavern")).toBeUndefined();
  expect(second.claims.holder(null)).toBeUndefined();
});

// --- the hub's half: naming a connection ---------------------------------------

test("the token frame is the FIRST event a subscriber gets", () => {
  // It has to be: a claim cannot be asserted before the connection has a name, so a token
  // that arrived after any other frame would leave a window where the chrome is connected
  // and unable to say who it is.
  const { subscribe } = daemon();
  const a = subscribe();
  const events = a.chunks.filter((c) => c.startsWith("event: "));
  expect(events[0]).toContain("event: session-token\n");
  expect(tokenOf(a)).toMatch(/./);
});

test("a token names exactly one connection, and dies with it", () => {
  const { hub, subscribe } = daemon();
  const a = subscribe();
  const b = subscribe();
  const tokenA = tokenOf(a);

  expect(hub.connectionFor(tokenA)).toBe(a.res);
  expect(tokenOf(b)).not.toBe(tokenA);
  expect(hub.connectionFor("not-a-token")).toBeUndefined();

  a.die();
  // Resolution is a live-table lookup, so the name stops meaning anything the moment the
  // stream closes — which is what makes a leaked token worthless as well as harmless.
  expect(hub.connectionFor(tokenA)).toBeUndefined();
});

test("emitTo writes to the named connection only, and not to a closed one", () => {
  const { hub, subscribe } = daemon();
  const a = subscribe();
  const b = subscribe();
  const beforeB = b.chunks.length;

  hub.emitTo(a.res, { type: "claim-lost", world: null });
  expect(a.chunks.at(-1)).toContain('data: {"type":"claim-lost","world":null}');
  expect(b.chunks.length).toBe(beforeB);

  a.die();
  const afterDeath = a.chunks.length;
  hub.emitTo(a.res, { type: "claim-lost", world: null });
  expect(a.chunks.length).toBe(afterDeath);
});

import { expect, test } from "bun:test";
import { EditorError } from "../src/daemon/errors.ts";
import {
  assertLoopbackOrigin,
  isLoopbackOrigin,
} from "../src/daemon/origin.ts";

// The SPELLING table lives here rather than in `server.test.ts` because the question
// "which origins are loopback?" is a pure one — `errors.ts` is tested the same way. The
// wiring question ("does every route branch ask?") is a different one and stays over
// there, end-to-end, one case per branch. Splitting them is what lets this table grow
// without paying an HTTP server per row.

const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
  ["http://127.0.0.1:4500", "the daemon's own origin"],
  ["http://localhost:4500", "the other spelling of it a user may type"],
  ["http://localhost", "no port — the default one is still loopback"],
  ["HTTP://LOCALHOST:4500", "`URL` case-folds scheme and host for us"],
  ["http://[::1]:5173", "what a v6-bound local dev server presents"],
  [
    "http://[0:0:0:0:0:0:0:1]:4500",
    "the same address written long — canonicalized to [::1], which a literal table could not have caught",
  ],
  ["https://localhost:3000", "what a TLS local dev server presents"],
  ["https://127.0.0.1:8443", "…and by address"],
  ["https://[::1]:8443", "…and over v6"],
  // The integer spellings of 127.0.0.1. These ARE loopback and are admitted on purpose:
  // parsing normalizes them before the set is consulted. They are unreachable by the
  // attack regardless — an Origin carries the NAME a page was loaded from, never the
  // address it resolved to.
  ["http://2130706433", "decimal 127.0.0.1"],
  ["http://0177.0.0.1", "octal first octet"],
  ["http://0x7f.0.0.1", "hex first octet"],
];

const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ["http://evil.example", "the rebinding page's own name — the whole point"],
  [
    "http://127.0.0.1.evil.com",
    "a public host that merely STARTS with a loopback spelling; an includes() check admits it",
  ],
  ["http://localhost.evil.com", "the same trap on the other spelling"],
  [
    "http://not-localhost",
    "…and the same trap on the other side of the string",
  ],
  [
    "http://127.0.0.1@evil.com",
    "userinfo — the real host is evil.com, which is why the PARSED hostname is what is read",
  ],
  [
    "http://localhost.",
    "trailing-dot FQDN form: over-strict, harmless, and recorded so the next reader knows it was seen rather than missed",
  ],
  ["http://127.0.0.2", "loopback, but no local server presents it — clause 1"],
  ["http://[::2]", "not loopback at all"],
  ["null", "the opaque origin a sandboxed iframe or a file:// page sends"],
  ["", "an empty header value — present, and not a loopback origin"],
  [
    "http://a.example, http://b.example",
    "how Node 22 joins a duplicated Origin header: parses as nothing, refuses",
  ],
  ["chrome-extension://abcdef", "parses, but no local server serves it"],
  ["file:///Users/x", "…same, and its host is empty"],
  ["garbage", "does not parse — fail closed"],
];

test("isLoopbackOrigin admits every spelling a real local server presents", () => {
  for (const [origin, why] of ACCEPTED) {
    expect(isLoopbackOrigin(origin), `${origin} — ${why}`).toBe(true);
  }
});

test("isLoopbackOrigin refuses everything else, including the near misses", () => {
  for (const [origin, why] of REFUSED) {
    expect(isLoopbackOrigin(origin), `${origin} — ${why}`).toBe(false);
  }
});

test("assertLoopbackOrigin passes an ABSENT origin — this is not client auth", () => {
  // The clause that makes the check a rebinding defence rather than authentication:
  // curl, the CLI and a future MCP client over node:http send no Origin at all.
  expect(() => assertLoopbackOrigin(undefined)).not.toThrow();
});

test("assertLoopbackOrigin throws the typed code, not a bare Error", () => {
  // The CODE is the contract a client branches on; the status is the HTTP edge's
  // mapping of it (`errors.test.ts` owns that table).
  let caught: unknown;
  try {
    assertLoopbackOrigin("http://evil.example");
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(EditorError);
  expect((caught as EditorError).code).toBe("forbidden-origin");
  // The offending origin is named — the response is unreadable to the page that sent
  // it (no CORS headers), so this text exists for whoever is reading a daemon log.
  expect((caught as EditorError).message).toContain("http://evil.example");
});

test("assertLoopbackOrigin agrees with its predicate on every table row", () => {
  // Cheap, and it stops the assert and the predicate drifting apart the day one of
  // them grows a clause the other does not.
  for (const [origin] of ACCEPTED) {
    expect(() => assertLoopbackOrigin(origin)).not.toThrow();
  }
  for (const [origin] of REFUSED) {
    expect(() => assertLoopbackOrigin(origin)).toThrow(EditorError);
  }
});

import { EditorError } from "./errors.ts";

/** The spellings of "a page on this machine" that a real local server presents.
 *  `[::1]` is how WHATWG serializes every IPv6 loopback literal
 *  (`http://[0:0:0:0:0:0:0:1]` parses to it), so parsing — not string matching — is
 *  what makes the set complete. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** True when `origin` names a page served from this machine's loopback interface.
 *
 *  PARSED, never substring-matched: `http://127.0.0.1.evil.com` and
 *  `http://localhost.evil.com` are ordinary public hostnames that merely start with a
 *  loopback spelling, and an `includes()` check would admit both. Parsing also buys the
 *  canonicalization a table cannot enumerate — `URL` case-folds the host, collapses IPv6
 *  (`[0:0:0:0:0:0:0:1]` → `[::1]`), and normalizes the integer spellings of an IPv4
 *  address, so `http://2130706433`, `http://0177.0.0.1` and `http://0x7f.0.0.1` all
 *  arrive here as hostname `127.0.0.1` and are admitted. That is correct, not a leak:
 *  they ARE loopback, and the clause below is why no attacker can reach this code with
 *  one anyway.
 *
 *  **ONE AXIS DECIDES THE SET, and both of its clauses must hold.** (1) Could a real
 *  local caller PRESENT this spelling? (2) Is it unmintable by the attack being
 *  defended? The second clause is the security floor and it is absolute: an `Origin`
 *  derives from the NAME a page was loaded from, never from the address that name
 *  resolved to, so a rebinding attacker — who controls DNS and nothing else — can never
 *  mint any loopback NAME. Holding one requires already running code on this machine,
 *  which is strictly more than the attack this defends against. So clause 2 admits every
 *  loopback spelling, and clause 1 alone decides which are written down: `localhost` and
 *  `127.0.0.1` are the daemon's own two, `[::1]` is what a v6-bound local dev server
 *  presents, and `https:` is what a TLS one presents. The rest of `127.0.0.0/8` fails
 *  clause 1 — servers bind `127.0.0.1`, `localhost`, `::1` or `0.0.0.0`, not
 *  `127.0.0.2` — and a non-web scheme that parses at all (`chrome-extension:`, `file:`)
 *  fails it too, being an opaque or non-page origin no local server serves. Add a
 *  spelling the day something real presents it; nothing here is load-bearing for
 *  security, which is the point of stating the axis rather than the entries. */
export function isLoopbackOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // Unparseable, which includes the literal "null" a sandboxed iframe or a
    // file:// page sends. Fail closed — see assertLoopbackOrigin.
    return false;
  }
  const isWebScheme =
    parsed.protocol === "http:" || parsed.protocol === "https:";
  return isWebScheme && LOOPBACK_HOSTS.has(parsed.hostname);
}

/** DNS-rebinding defence for the whole route table: refuse any request that DECLARES a
 *  browser origin which is not this machine's. MCP names this pair — validate `Origin`,
 *  keep the loopback bind — a MUST for local HTTP servers
 *  (`docs/research/2026-08-08-t4-agent-editor-mcp-precedent.md`, ruling 9).
 *
 *  **The threat, precisely.** The daemon binds `127.0.0.1`, so no remote host reaches it
 *  directly. What still reaches it is a page the user merely visited: `evil.example`
 *  answers its own DNS with `127.0.0.1`, and the browser then issues requests to this
 *  port believing them same-origin. It attaches `Origin: http://evil.example` to them,
 *  and that header is the one thing the attacker's JavaScript cannot forge.
 *
 *  **Which is exactly why an ABSENT origin passes.** curl, the CLI and a future MCP
 *  client over `node:http` send none, and anything able to omit a header could also
 *  have omitted a wrong one — so this is NOT client authentication and must never be
 *  read as any. It closes one class (a browser tricked into speaking for a stranger)
 *  and no other. Authentication remains out of scope, as does the daemon's missing
 *  body-size cap, for the same single-user-loopback reason.
 *
 *  **Present-but-opaque refuses.** `Origin: null` — a sandboxed iframe, a `data:` page,
 *  a `file://` page — carries no provenance at all, and a sandbox attribute is one
 *  keystroke on the attacker's own page, so reading it as "absent" would hand back the
 *  bypass this function exists to remove. Anything that fails to parse refuses on the
 *  same rule: fail closed, since the only clients that lose are ones that were never
 *  supported.
 *
 *  **A duplicate `Origin` header resolves differently on the two runtimes**, measured
 *  2026-08-09 rather than assumed: Node 22 joins the repeats into
 *  `"http://a.example, http://b.example"`, which parses as nothing and therefore refuses;
 *  Bun 1.3.14 keeps the LAST value, which is then judged on its own. Recorded because a
 *  Node-portable file should not carry an unstated fork, not because it is reachable —
 *  `Origin` is a forbidden header name, so no page can set it even once, and a
 *  non-browser client bypasses the check by omission long before it needs two.
 *
 *  Nothing a human sees moves: the chrome is served BY the daemon and can only have
 *  been reached over loopback (that is what the bind guarantees), so its own fetches
 *  carry a loopback origin, and its `<script>`/`EventSource` GETs carry none.
 *
 *  @throws {@link EditorError} `forbidden-origin` when `origin` is present and is not a
 *    loopback web origin. The daemon's HTTP edge maps that code to 403; the throw is
 *    here rather than a boolean return so the refusal rides the one typed-envelope edge
 *    every other refusal in `route` already rides. */
export function assertLoopbackOrigin(origin: string | undefined): void {
  if (origin === undefined) return;
  if (isLoopbackOrigin(origin)) return;
  throw new EditorError(
    "forbidden-origin",
    `refusing a request from origin "${origin}": the editor daemon answers localhost pages only`,
  );
}

// packages/editor/tests/handlers.test.ts
//
// The DISPATCH contract, not any one command's behaviour: what `dispatch` does with a
// name it doesn't know and with input the command's schema rejects. The commands
// themselves are covered where they live — generation-bake.test.ts, field-load.test.ts,
// worlds.test.ts — each of which builds its own handlers map the same way.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DaemonEvent } from "../src/daemon/events.ts";
import {
  createHandlers,
  dispatch,
  type Handlers,
} from "../src/daemon/handlers.ts";

const MINI = join(import.meta.dir, "fixtures", "mini-project");
let root: string;
let handlers: Handlers;
const events: DaemonEvent[] = [];

beforeAll(() => {
  root = mkdtempSync(join(import.meta.dir, "fixtures", "tmp-dispatch-"));
  cpSync(MINI, root, { recursive: true });
  handlers = createHandlers({ root, emit: (e) => events.push(e) });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("project.get returns the served root", async () => {
  expect(await dispatch(handlers, "project.get", {})).toEqual({ root });
});

test("an unknown command name carries unknown-command", async () => {
  await expect(dispatch(handlers, "nope.zap", {})).rejects.toMatchObject({
    code: "unknown-command",
  });
});

test("input the command's schema rejects carries invalid-input", async () => {
  // Wrong TYPE for a declared field…
  await expect(
    dispatch(handlers, "field.load", { name: 7 }),
  ).rejects.toMatchObject({ code: "invalid-input" });
  // …and an UNDECLARED field, since every command's schema is a strictObject.
  await expect(
    dispatch(handlers, "project.get", { surprise: true }),
  ).rejects.toMatchObject({ code: "invalid-input" });
});

test("a registry built with NO session seam answers no-session, not a crash", async () => {
  // `HandlerContext.session` is optional and its docblock argues that absence degrades
  // honestly rather than needing a stub: a daemon with no event feed has no connections,
  // so there IS no session for anyone to be. Four suites build such a registry (this one,
  // `field-load`, `generation-bake`, `worlds`) and none of them issued a `session.*`
  // command, so nothing held the claim until this case.
  for (const [command, input] of [
    ["session.claim", { name: "cavern", token: "anything" }],
    ["session.steal", { name: null, token: "anything" }],
    ["session.release", { token: "anything" }],
    // `session.state` for a fourth reason of its own: there is no connection to ASK, so
    // the refusal comes before the backchannel rather than out of it.
    ["session.state", {}],
  ] as const) {
    // AWAITED. An un-awaited `.rejects` settles after the case has returned and asserts
    // nothing — the failure mode this file's own `unknown-command` case avoids one line up.
    await expect(dispatch(handlers, command, input)).rejects.toMatchObject({
      code: "no-session",
    });
  }
});

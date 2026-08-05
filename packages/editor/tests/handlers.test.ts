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

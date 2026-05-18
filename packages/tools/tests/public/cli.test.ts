import { expect, test } from "bun:test";
import {
  BINARY_RELATIVE_PATH,
  resolveCliCommand,
} from "../../src/public/cli.ts";

test("resolveCliCommand: 'native' with no flags returns a native command", () => {
  const cmd = resolveCliCommand(["native"]);
  expect(cmd.kind).toBe("native");
  expect(cmd.kind === "native" && cmd.rebuild).toBe(false);
});

test("resolveCliCommand: 'native --rebuild' sets rebuild=true", () => {
  const cmd = resolveCliCommand(["native", "--rebuild"]);
  expect(cmd.kind === "native" && cmd.rebuild).toBe(true);
});

test("resolveCliCommand: missing subcommand returns help", () => {
  const cmd = resolveCliCommand([]);
  expect(cmd.kind).toBe("help");
});

test("resolveCliCommand: unknown subcommand returns error", () => {
  const cmd = resolveCliCommand(["wat"]);
  expect(cmd.kind).toBe("error");
  expect(cmd.kind === "error" && cmd.message).toMatch(/unknown subcommand/i);
});

test("BINARY_RELATIVE_PATH points at workspace dist/native location", () => {
  expect(BINARY_RELATIVE_PATH).toContain("dist/native");
  expect(BINARY_RELATIVE_PATH).toContain("furnace-window");
});

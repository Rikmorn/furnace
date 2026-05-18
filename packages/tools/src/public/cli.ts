#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";

export type CliCommand =
  | { kind: "native"; rebuild: boolean }
  | { kind: "help" }
  | { kind: "error"; message: string };

export function resolveCliCommand(argv: string[]): CliCommand {
  const [sub, ...rest] = argv;
  if (sub === undefined) return { kind: "help" };

  if (sub === "native") {
    return { kind: "native", rebuild: rest.includes("--rebuild") };
  }

  return {
    kind: "error",
    message: `unknown subcommand '${sub}'. Try: furnace native [--rebuild]`,
  };
}

// Resolved relative to this file: packages/tools/src/public/cli.ts → dist/native/
export const BINARY_RELATIVE_PATH = resolve(
  import.meta.dir,
  "../../../../dist/native",
  process.platform === "win32" ? "furnace-window.exe" : "furnace-window",
);

const HELP = `furnace — workspace CLI

Usage:
  furnace native [--rebuild]   Launch the desktop runtime. --rebuild forces a fresh build first.

Environment:
  FURNACE_VERBOSE=1            Show diagnostic output from the launcher and its Bun child.
`;

async function runNative(rebuild: boolean): Promise<number> {
  if (rebuild || !existsSync(BINARY_RELATIVE_PATH)) {
    if (!rebuild) {
      console.error(
        `furnace: binary not found at ${BINARY_RELATIVE_PATH}, building first...`,
      );
    }
    const toolsRoot = resolve(import.meta.dir, "../..");
    await $`bun run build:native`.cwd(toolsRoot);
  }
  const result = await $`${BINARY_RELATIVE_PATH}`.nothrow();
  return result.exitCode;
}

async function main(): Promise<void> {
  const cmd = resolveCliCommand(process.argv.slice(2));
  switch (cmd.kind) {
    case "help":
      console.log(HELP);
      process.exit(0);
      break;
    case "native":
      process.exit(await runNative(cmd.rebuild));
      break;
    case "error":
      console.error(`furnace: ${cmd.message}`);
      console.error(HELP);
      process.exit(1);
      break;
  }
}

// Only run main() when invoked as a script (not when imported by tests).
if (import.meta.main) {
  await main();
}

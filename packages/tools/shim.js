#!/usr/bin/env node
// Tiny zero-dependency shim that finds and execs the furnace Rust binary.
// Phase 1: resolves to the in-repo cargo build output.
// Phase 5: extends to biome-style per-platform optionalDependencies.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const exe = process.platform === "win32" ? "furnace.exe" : "furnace";
const candidates = [
  resolve(here, exe),                                              // shipped: sibling of shim
  resolve(here, "crates/target/debug", exe),                       // in-repo dev
  resolve(here, "crates/target/release", exe),                     // in-repo release
];

const binary = candidates.find(existsSync);
if (!binary) {
  console.error(`furnace: binary not found. Looked in:\n  ${candidates.join("\n  ")}`);
  console.error(`Run \`cargo build --manifest-path packages/tools/crates/Cargo.toml\` first.`);
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));

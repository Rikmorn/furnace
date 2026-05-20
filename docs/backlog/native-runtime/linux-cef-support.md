# Linux / cef support

Native host is currently macOS-only (milestone 1 shipped macOS; Windows is its own backlog entry below). Linux deferred because `cef` (Chromium Embedded Framework) pulls a heavy Chromium runtime as a build dependency. Shallot uses `cef = 145` on Linux because GTK WebKit's WebGPU support is weak.

**Trigger to revisit:** A Linux user wants to run the native target, or a contributor offers to wire it up.

**Reference:** `packages/shallot/rust/window/Cargo.toml` in dylanebert/shallot — `[target.'cfg(target_os = "linux")'.dependencies]` block.

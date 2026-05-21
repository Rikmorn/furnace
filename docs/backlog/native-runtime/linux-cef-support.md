# Linux / cef support

Native host is currently macOS-only (milestone 1 shipped macOS; Windows is its own backlog entry below). Linux deferred because GTK WebKit's WebGPU support is weak — the workable path is `cef` (Chromium Embedded Framework), which pulls a heavy Chromium runtime as a build dependency.

**Trigger to revisit:** A Linux user wants to run the native target, or a contributor offers to wire it up.

**Reference:** see `docs/research/shallot.md` § "Native shell via Rust + wry/winit" for one working precedent (`cef = 145` under `[target.'cfg(target_os = "linux")'.dependencies]`).

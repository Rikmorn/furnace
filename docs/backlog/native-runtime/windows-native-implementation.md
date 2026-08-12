---
summary: no Windows native target — the wry runtime should cross-compile, but the build pipeline, templates, and platform builder are macOS-only
---

# Windows native implementation

Milestone 1 of `docs/reference/packaging-and-distribution.md` shipped macOS only; Windows was explicitly deferred. The runtime crate (`furnace-runtime`) is wry-based and should mostly cross-compile (wry uses WebView2 on Windows), but the build pipeline only knows `--platform=macos`. Concrete work: extend `Command::Build`/`Dev`/`Init` clap value_parser to accept `windows`, add a `WindowsBuilder` next to `MacosBuilder` (`packaging/<platform>/...` and corresponding `MSIX` or `.exe + manifest` equivalent of Info.plist), add `templates/windows/` mirroring `templates/macos/`, add `#![cfg_attr(windows, windows_subsystem = "windows")]` to the consumer `main.rs` template so the binary doesn't pop a console window on launch. Once shipping, the biome-pattern per-platform package migration (separate BACKLOG entry below) becomes load-bearing.

**Trigger to revisit:** First user/consumer ask for Windows, OR before public release.

**Reference:** Section on per-platform support in `docs/reference/packaging-and-distribution.md`. wry's `webview2-com` backend docs for any Win-specific gotchas.

# WebView `console.log` bridge to host stdout

Today `console.log`/`warn`/`error` calls from JS running inside the WKWebView don't reach the host process's stdout. The runtime enables `with_devtools(true)` and has an error-capture init script that turns *uncaught* errors into a red body overlay, but ordinary `console.log` is invisible unless you attach Safari Web Inspector (Develop menu → [machine] → app entry). Every plugin/feature verification step (e.g. confirming the Phase 4 wasm log line "demo-wasm: 2 + 3 = 5") currently requires Safari to be open. The plan's instruction to "check Console.app for the wasm log" was misleading — Console.app catches WKWebView errors/warnings via unified logging, not arbitrary `console.log` calls.

**Concrete shape:** Inject a JS init script (sibling of `ERROR_CAPTURE_SCRIPT` in `packages/tools/crates/furnace-runtime/src/lib.rs`) that wraps `console.{log,warn,error,info,debug}` to also call `window.ipc.postMessage(JSON.stringify({level, args}))`. Install an IPC handler in `WebViewBuilder::with_ipc_handler` (wry 0.55) that parses the message and `println!`s it as `[js {level}] {args}`. Keep the original `console.*` behaviour intact so Safari Web Inspector still works for richer inspection.

**Trigger to revisit:** Next time native-runtime work is in scope, OR when manual-verification friction during a phase becomes annoying enough to fix. Roughly 30 lines of Rust + JS; small follow-up.

**Reference:** Surfaced during Phase 4 (wasm plugin) manual verification, 2026-05-20. Wry's IPC handler docs: <https://docs.rs/wry/0.55/wry/struct.WebViewBuilder.html#method.with_ipc_handler>.

---
summary: the native binary's best-effort `Drop` can leak the Bun child on a Rust panic or SIGKILL — signal handling is incomplete
---

# Robust child-process cleanup on Rust panic

The native binary uses a best-effort `Drop` impl to kill the Bun child when the window closes. If Rust panics mid-frame or the OS kills the parent with SIGKILL, the child may leak. Also: spawning `bun` directly (not via `bun run`) gives us clean kill semantics, but signal handling is still incomplete.

**Trigger to revisit:** First time we see a leaked Bun process during dev.

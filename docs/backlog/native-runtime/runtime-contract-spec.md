---
summary: the JS ↔ native-shell runtime contract exists in principle only: method list, signatures, IPC protocol, error and async semantics all still need their own spec session
---

# Runtime Contract Spec

The native-shell distribution design (Section 5) introduces the Runtime Contract as the abstraction boundary between the JS engine / wasm plugin layer and any compliant native shell implementation. The spec establishes the contract exists, what it covers (filesystem, dialogs, window control, lifecycle, IPC, asset access), and its versioning principles — but the *exhaustive method list, signatures, IPC protocol, error semantics, and async behaviour* are deliberately deferred to a separate spec. This is one of the larger design surfaces in the project; it warrants its own session.

**Trigger to revisit:** When implementation of milestone 1 (end-to-end macOS) needs more contract methods than the bare minimum, OR when a second alternative runtime implementation is considered.

**Reference:** Section 5 of `docs/reference/packaging-and-distribution.md`.

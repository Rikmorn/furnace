# `@furnace/native` JS package — separate contract-mediated APIs from pure browser surface

The native-shell design (Section 5) introduces a runtime contract — a set of OS-bridge APIs (filesystem, dialogs, native window control, lifecycle) the runtime exposes to the JS layer. Putting these in `@furnace/core` would break its "pure browser-only, runs without any runtime" guarantee — anyone using core in a plain browser would import APIs that throw at runtime. Splitting them into a sibling `@furnace/native` npm package keeps core honest as a portable library; consumers opt in by importing `@furnace/native` only when they're inside a compliant runtime.

**Trigger to revisit:** First time a contract-mediated API gets implemented (likely `fs.readFile`). Decide whether to land it in core, `@furnace/native`, or somewhere else before more APIs follow the same pattern.

**Reference:** Section 5 of the native-shell distribution design (the runtime contract concept). The doc lives at `docs/reference/packaging-and-distribution.md` once written.

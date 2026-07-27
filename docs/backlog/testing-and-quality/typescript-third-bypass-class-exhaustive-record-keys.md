# typescript.md — a third documented compiler-bypass class? (`Object.keys` on an exhaustive `Record`)

**Context.** `.claude/rules/typescript.md` documents intentional compiler-bypass
classes (hot-path typed-array indexing being the worked example). F4's tranche B
surfaced a recurring third candidate: `Object.keys(...)` over an object literal
annotated with an exhaustive `Record<K, V>`, where the author KNOWS the key set is
closed but TS types the keys as `string`. The rules file's own stated test — "the
type system cannot track an invariant the runtime guarantees" — is satisfied
verbatim, but its worked examples are all external systems, so each executor
currently re-litigates the call (it happened at least twice in F4 reviews).

**Shape of the work.** A convention decision, not code: either add the class to
typescript.md with a worked example and the required justification comment, or
document why it stays case-by-case. Rules files are user-owned — this is
deliberately NOT an executor call (which is why it was filed rather than edited).

**Trigger to revisit:** the next time a review re-litigates this exact pattern, or
the next typescript.md touch for any reason.

**Reference:** `.claude/rules/typescript.md`; F4 tranche-B report §Open items
(local).

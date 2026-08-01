# `NotifySeverity` has no `warn` member — which is why a clean boot shows a red error

`notify-store.ts:14` declares:

```ts
export type NotifySeverity = "info" | "success" | "error";
```

Three members, and only one of them is non-cheerful. So anything the editor needs to say
that is neither good news nor neutral has exactly one channel, and it is the loudest one.

The visible consequence is the **red "1 unread error" badge on a clean boot of a project
with no agent profile**. `field-host.ts:4029` reports "walkability advisor idle — this
project installs no agent profile" through `reportToolError`, which lands as `error`,
which lights the status bar's ⚠ chip and puts a non-auto-fading toast on screen. Nothing
is wrong: the advisor is correctly idle because the project did not install a profile.
The editor's first impression is a red count for a non-event.

## This is narrower than "what should the severity taxonomy be"

Worth stating, because the existing framing treats it as an open design question and it is
not. The fix is **one union member**:

```ts
export type NotifySeverity = "info" | "success" | "warn" | "error";
```

…plus the three consequences that follow mechanically:

1. A `warn` styling token in the toast and the log row (amber; the palette already has
   one).
2. A decision on whether `warn` **auto-fades**. `error` deliberately does not; `info` and
   `success` do. A warning is closer to `info` here — the advisor-idle case wants to be
   readable and then gone.
3. The ⚠ chip's unread COUNT keeps counting `error` only, or the badge is back where it
   started. This is the load-bearing one: the whole point is that a warning does not
   demand attention the way an error does.

Then the advisor-idle report routes through it. `reportToolError` is a host-side seam
carrying a `string`, so the host needs either a severity argument or a second verb —
that is the one genuine design choice in the change, and it is small.

## Why it was not fixed in F4.5b

Out of scope for every task in the slice: it is a `notify-store` type change plus a host
seam shape plus a styling token, and F4.5b's brief was the interaction verbs. It surfaced
repeatedly during the slice as noise in test output ("field-host: walkability advisor idle"
prints in several suites) and once as a holistic-review finding.

## Trigger to revisit

**F4.5c**, or sooner if any second caller needs a non-error warning — at which point the
`error`-or-nothing choice starts being made twice.

## Reference

- `packages/editor/src/frontend/lib/notify-store.ts` — the union, and the auto-fade rule
  per severity.
- `packages/editor/src/viewport-host/field-host.ts` — the advisor-idle report and the
  `profileMissingReported` latch that makes it once-per-session.
- `packages/editor/src/frontend/components/shell/StatusBar.tsx` — the ⚠ chip's unread
  count, the surface that must NOT start counting warnings.

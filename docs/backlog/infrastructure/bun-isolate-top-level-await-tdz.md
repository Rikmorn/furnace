---
summary: bun test --isolate evaluates importers before an async module's top-level await settles, leaving const bindings in TDZ — two in-repo workarounds to revert when upstream fixes it
---

# `bun test --isolate` breaks top-level-await settlement — revert the workarounds on the Bun bump

**This is a Bun runtime defect, not a defect in our code.** Two test-suite workarounds exist
only because of it, and both should revert when it is fixed. A reader who meets either
workaround without this entry will conclude we wrote something wrong.

## The defect

ES modules guarantee that a module containing a top-level `await` is an *async module*: its
importers do not evaluate until its top-level await settles, and `await import(...)` does not
resolve until then either. Measured under bun 1.3.14 (2026-08-13), `bun test --isolate`
violates both halves. The importer runs early, so:

- **hoisted `function` declarations are already initialized** — `typeof mod.fn === "function"`
  is true, which is what makes the failure look like something else;
- **`const` / `let` bindings are in their temporal dead zone**, including a `const`-backed
  `export default`. Reading one throws `ReferenceError: Cannot access '<name>' before
  initialization`.

`--parallel` implies `--isolate` (`bun test --help`), so there is no flag-level escape.

### Minimal repro — three files, ready to file upstream

```ts
// async-mod.ts
export const settled = await Promise.resolve("settled");
export default settled;
export function hoisted(): string {
	return "hoisted";
}
```

```ts
// static.test.ts — the static-importer half
import { expect, test } from "bun:test";
import { hoisted, settled } from "./async-mod.ts";

test("static importer sees the async module's const binding", () => {
	expect(hoisted()).toBe("hoisted");
	expect(settled).toBe("settled");
});
```

```ts
// dynamic.test.ts — the await-import half
import { expect, test } from "bun:test";

test("await import() resolves only after the async module settles", async () => {
	const mod = await import("./async-mod.ts");
	expect(typeof mod.hoisted).toBe("function");
	expect(mod.default).toBe("settled");
});
```

Measured 2026-08-13, bun 1.3.14: `bun test <dir>` → 2 pass / 0 fail. `bun test --isolate
<dir>` → 0 pass / 2 fail, one `ReferenceError` per file (`'settled'`, then `'default'`). Note
which assertion survives in each: the `hoisted` line passes both times.

**Whether to file this at `oven-sh/bun` is the owner's call — the repro above is ready.**

## The two in-repo workaround sites

Both were landed by the `isolate-hardening` slice; each is commented at its site.

1. **`trySetup` in `packages/core/tests/_helpers/gpu-fixture.ts`** resolves `bun-webgpu`'s
   native library path itself (synchronously, via `createRequire(...).resolve`) and passes it
   as `setupGlobals({ libPath })`. Without it, `bun-webgpu`'s own loader reads a
   `const`-backed `default` off the async platform package `bun-webgpu-<platform>-<arch>`,
   gets the TDZ `ReferenceError`, swallows it in its internal `catch`, and `findLibrary`
   later throws **`bun-webgpu is not supported on the current platform: darwin-arm64`** — a
   message that is simply false on a machine where the library loads fine under the serial
   runner. The resolution must stay synchronous: another `await import` would reintroduce the
   async-module dependency it routes around, one level up.
2. **`packages/editor/tests/inspector/_harness.tsx`** pulls `@testing-library/react` in
   through a synchronous `createRequire` instead of a top-level `await import`. The deferral
   is load-bearing (happy-dom must register before testing-library's module body binds
   `screen` to `document.body`) but it does not need to be *asynchronous* — and as a
   top-level await it put every harness binding in TDZ for every importing file under
   `--isolate`. Context on the ordering constraint itself:
   [`bun-test-single-process-fragility.md`](../editor-and-tooling/bun-test-single-process-fragility.md).

## Trigger to revisit

A Bun upgrade. Re-run the repro above under `--isolate` on the new version; if it goes green,
both workarounds can revert to plain static/dynamic imports and this entry is deleted. Until
then the workarounds are the correct code and the comments at both sites say why.

## Reference

- `bun test --help` (the `--parallel` / `--isolate` relationship)
- [`bun-test-single-process-fragility.md`](../editor-and-tooling/bun-test-single-process-fragility.md)
  and [`mcp-sdk-construction-slows-the-process.md`](../editor-and-tooling/mcp-sdk-construction-slows-the-process.md)
  — the contamination-class records this defect is NOT one of

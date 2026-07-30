// The display formatters — pure, DOM-free, safe in bare tests/ (the palette-store
// precedent). `relTime` is exported from a component's neighbourhood for exactly this:
// the log palette's claim is that a timestamp never lies, and the boundaries are where
// that claim is actually made.
import { expect, test } from "bun:test";
import { relTime } from "../src/frontend/lib/humanize.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 1_000_000_000;

/** `ms` ago, read against a fixed NOW — no clock anywhere in these assertions. */
const ago = (ms: number): string => relTime(NOW - ms, NOW);

test("relTime names the coarsest unit that fits, on each boundary", () => {
  expect(ago(0)).toBe("just now");
  expect(ago(MINUTE - 1)).toBe("just now");
  // Each boundary lands on the NEXT unit's smallest value, so no window is skipped and
  // none is described twice.
  expect(ago(MINUTE)).toBe("1m ago");
  expect(ago(2 * MINUTE + 30_000)).toBe("2m ago"); // floors, never rounds up
  expect(ago(HOUR - 1)).toBe("59m ago");
  expect(ago(HOUR)).toBe("1h ago");
  expect(ago(DAY - 1)).toBe("23h ago");
  expect(ago(DAY)).toBe("1d ago");
  expect(ago(30 * DAY)).toBe("30d ago");
});

test("relTime reads a future timestamp as just now, not as negative time", () => {
  // Reachable without anything being broken: a system clock that steps backwards
  // between the push and the render. "in -1m" would look like a bug in the log.
  expect(relTime(NOW + 5 * MINUTE, NOW)).toBe("just now");
});

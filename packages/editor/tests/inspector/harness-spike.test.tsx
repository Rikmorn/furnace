import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
import { test, expect } from "bun:test";
// Dynamic import: static ESM imports are hoisted above GlobalRegistrator.register(),
// but @testing-library/react binds `screen` to `document.body` at module-evaluation
// time, so it must be imported AFTER registration runs.
const { render, screen } = await import("@testing-library/react");

test("happy-dom + testing-library render under bun test", () => {
  render(<button type="button">probe</button>);
  expect(screen.getByRole("button", { name: "probe" })).toBeDefined();
});

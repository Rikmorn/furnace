import { defineService } from "@furnace/core/registry";

// Fixture service: registration at import time IS the Branch-A proof — the
// consumer's own module runs inside the bundle the daemon builds from the
// project root (asserted by bundle.test.ts + bundle.gpu.test.ts).
defineService("fixtureService", { fn: () => "ok" });

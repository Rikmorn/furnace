// The registry module's package-private door. Nothing here is consumer
// surface — that is index.ts. Added at foundations T5 (2026-08-11) by the core
// surface classification audit: `resetServicesForTests` was documented "Tests
// only." while sitting unprefixed in the public index, which is exactly the
// boundary the `_`-internal convention draws (`core-modules.md` §conventions).

/**
 * Empty the module-global service registry. Its only caller is this module's
 * own suite (`registry/registry.test.ts`), whose `afterEach` clears the
 * process-global `services` singleton. That reset is DEFENSIVE, not currently
 * load-bearing: verified 2026-08-11 by deleting the call — the suite stayed
 * green, because each test registers a distinct name and the "unregistered"
 * case happens to run first. It earns its place as isolation against exactly
 * that ordering dependency, not because a test fails today.
 */
export { _resetServicesForTests } from "./registry.ts";

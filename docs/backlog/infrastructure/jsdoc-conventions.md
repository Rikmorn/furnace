# Establish JSDoc conventions for the engine public surface

The project has no JSDoc conventions today. Some public functions have JSDoc (`camera.projectToScreen` has a paragraph plus edge-case notes); most don't (`mesh.cube`, most of `transform/*`, much of `material/*`). There is no rule about when JSDoc is required, what it should cover, or whether tooling enforces it.

As `@furnace/core`'s API surface grows, the gap shows up two ways:

- Consumers reading IDE tooltips see inconsistent quality across modules — one function's hover gives a contract paragraph, the next gives only a type signature.
- Edge-case contracts (NaN propagation, throw-vs-no-op, allocation semantics, out-param mutation, CSS-px-vs-device-px) get added to JSDoc inconsistently — only when they happen to surface in code review.

## Decisions to make

- **Scope.** Just `@furnace/core` public surface (whatever is re-exported from each sub-path's `index.ts`), or also internal helpers? Test files exempt regardless.
- **Required content.** Minimum: one-line summary + signature. Optional: behaviour paragraph, throws, edge cases (NaN, behind-camera, divide-by-zero), out-param semantics, allocation budget, viewport-px-vs-device-px style gotchas.
- **Enforcement.** Lint rule (Biome's JSDoc plugin or an eslint plugin) vs. convention-only. The TypeScript compiler doesn't care. Convention-only is easier to start; lint-enforced is what keeps it from rotting.
- **Format.** `@param` / `@returns` (heavy, scaffold-heavy) vs. inline prose (terse, harder to grep). Existing JSDoc in core uses inline prose — likely keep that.

## Reference exemplars

The most-documented public function in core today: `packages/core/src/camera/project.ts` (`projectToScreen`). Read its JSDoc as the target style. The thinnest end of the spectrum: most of `packages/core/src/transform/*.ts` (math operations with no JSDoc at all, just signatures).

**Trigger to revisit:** Either a third API surface lands where the doc inconsistency causes review back-and-forth, OR `@furnace/core` is about to be opened to external consumers (where IDE-tooltip quality becomes a first impression). Decide what to enforce before that happens, not after.

**Reference:** `packages/core/src/camera/project.ts` for the target. `.claude/rules/clean-code.md` for the existing "don't write comments unless WHY is non-obvious" rule — note that JSDoc contracts are a different thing from inline comments and the rule shouldn't be read as banning them.

# Node CLI library survey — 2026-05-19

Survey of six Node CLI libraries to inform a future design decision for the
`@furnace/tools` `furnace` CLI. **This is a survey, not a recommendation** —
tradeoffs are surfaced; no winner is picked.

All data points labelled "Verified" were fetched live during the session
(2026-05-19) from GitHub API, the npm registry, the npm downloads API, and
README pages. Items labelled "General knowledge" are reasoned from training
data and not freshly verified.

## Comparison table

| Library | Latest release | Last commit | Stars | Open issues | Weekly downloads (npm)¹ | Install size² | Transitive pkgs² | Runtime deps | Node engine | Module type | Built-in TS types | Plugin model | Backing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **commander** v14.0.3 | 2026-01-31 | 2026-01-31 | 28,210 | 8 | 415M | 244K | 1 | 0 | `>=20` | dual (CJS main + ESM via `exports`) | basic; strong via `@commander-js/extra-typings` | none built in | TJ Holowaychuk + @shadowspawn; Tidelift sponsorship |
| **@oclif/core** v4.11.3 | 2026-05-15 | 2026-05-16 | 301³ | 23 | 7.7M | 4.8M | 38 | 18 | `>=18` | first-class | first-class (plugins are full citizens) | Salesforce |
| **cac** v7.0.0 | 2026-02-27 | 2026-05-05 | 3,070 | 35 | 37M | 56K | 1 | 0 | `>=20.19.0` | ESM-only | yes (TS source) | no formal model; you compose programmatically | EGOIST (community) |
| **citty** v0.2.2 | 2026-04-01 | 2026-04-01 | 1,244 | 52 | 17.8M | 56K | 1 | 0 | unspecified | ESM-only | first-class (`defineCommand`) | lazy subcommands + plugin hooks (`setup`/`cleanup`) | unjs collective (Nuxt-adjacent) |
| **yargs** v18.0.0 | 2025-05-27 | 2026-05-10 | 11,486 | 316 | 159M | 876K | 13 | 6 | `^20.19.0 \|\| ^22.12.0 \|\| >=23` | ESM (with `helpers`/`browser` subpaths) | community-maintained `@types/yargs` | none built in (composable via `.command`) | OpenJS Foundation |
| **clipanion** v4.0.0-rc.4 | (last release v18.0.0 reference n/a; latest publish: rc.4) | **2024-09-06** | 1,248 | 41 | 4.3M | 592K | 2 | 1 (`typanion`) | unspecified | dual | first-class (class + decorators) | extend via subclassing | Maël Nison (Yarn maintainer) |

¹ npm downloads API, week of 2026-05-12 → 2026-05-18.
² Measured by isolated `npm install <pkg>` in an empty project on 2026-05-19, `du -sh node_modules`, and `find node_modules -maxdepth 2 -name package.json | wc -l`.
³ oclif's GitHub presence is split across the `oclif/` org's many repos (`core`, `plugin-help`, `plugin-plugins`, etc.); the 301-star count is only for `oclif/core`. The original `oclif/oclif` umbrella repo has materially more stars (general knowledge).

### Maintainership signal at a glance

| Library | Commits in last 12 months (sampled)⁴ | Health verdict |
|---|---|---|
| commander | Steady; v14 cut Dec-2024, patches through Jan-2026; v15-alpha Feb-2026 | Thriving |
| @oclif/core | Dozens per month; 10+ releases since Mar-2026 | Thriving (and aggressive) |
| cac | Dormant 2022-2025, then revived Feb-2026 with v7.0.0 rewrite | Recently re-energised |
| citty | Steady through 2024-2026 after a gap; v0.2.x cadence ~monthly | Healthy (but pre-1.0) |
| yargs | Mostly v18.0.0 era; commits in 2026 are sporadic (Jan, Feb, May) | Maintained but quiet |
| clipanion | **No commits since 2024-09-06** (20 months) | Stagnating |

⁴ From `GET /repos/:owner/:repo/commits?per_page=30` sampled on 2026-05-19.

---

## commander

- **Repo:** https://github.com/tj/commander.js
- **npm:** https://www.npmjs.com/package/commander
- **Verified:** v14.0.3 (Jan 2026), 28.2k stars, 8 open issues, dual CJS/ESM, zero runtime deps, `engines.node >=20`. Tidelift-sponsored. v15.0.0-0 alpha cut Feb 2026.
- **Subcommand pattern** (verbatim from README):

  ```ts
  import { Command } from 'commander';
  const program = new Command();

  program
    .command('native')
    .description('launch desktop runtime')
    .option('--platform <platform>', 'macos|ios|android|win|linux')
    .action((options) => { /* ... */ });

  program
    .command('build')
    .description('build the project')
    .action(() => { /* ... */ });

  program.parse();
  ```

- **Type safety:** Out of the box, `.opts()` returns a loosely typed object. Strong inference requires the optional sibling package `@commander-js/extra-typings` (mentioned in README) — same API surface, drop-in import swap.
- **ESM/CJS:** Dual via `exports`. `main` is CJS; `import` resolves to `./esm.mjs`.
- **Extensibility:** No formal plugin model. A consumer would have to compose `Command` instances and call `program.addCommand(...)` from their own code — workable for a furnace plugin model but not a paved path.
- **Notable users (general knowledge):** Vue CLI, create-react-app (historically), npm itself, many widely-used tools. README doesn't curate a list.
- **Common complaints (general knowledge / issue tracker tone):** Weak TS inference without `extra-typings`; `--option=value` vs `--option value` parsing quirks; help output customisation requires writing a class.

## @oclif/core

- **Repo:** https://github.com/oclif/core
- **npm:** https://www.npmjs.com/package/@oclif/core
- **Verified:** v4.11.3 (May 2026), 23 open issues, ESM-only, `engines.node >=18`, **18 runtime deps**, total install ~4.8 MB with 38 packages. Description: "Built by Salesforce." Multiple sub-packages (`@oclif/plugin-help`, `@oclif/plugin-plugins`, etc.).
- **Subcommand pattern** (canonical: one file per command, exported as a class):

  ```ts
  // src/commands/native.ts
  import { Command, Flags } from '@oclif/core';

  export default class Native extends Command {
    static description = 'launch desktop runtime';
    static flags = {
      platform: Flags.string({
        options: ['macos', 'ios', 'android', 'win', 'linux'],
      }),
    };
    async run() {
      const { flags } = await this.parse(Native);
      // flags.platform is typed
    }
  }
  ```

  Subcommands are auto-discovered from `src/commands/**/*.ts` based on filesystem layout.

- **Type safety:** First-class. `Flags.string({...})` returns strongly-typed values; `this.parse(Native)` is fully inferred.
- **ESM/CJS:** ESM-only at v4.
- **Extensibility:** **The strongest plugin model of the group.** Plugins are themselves oclif packages declared in the host's `package.json` under `oclif.plugins`. The official `@oclif/plugin-plugins` package lets *end users* install plugins via `cli plugins:install foo`. This is exactly the shape Furnace would want if it ever wanted user-installable extensions.
- **Notable users (verified via Salesforce attribution + general knowledge):** Salesforce CLI (`sf`), Heroku CLI, Adobe I/O CLI, Twilio CLI, Netlify CLI (historically), AWS SAM (some commands).
- **Common complaints:** Heavyweight install (4.8 MB vs 56 KB for cac/citty); convention-heavy (files-as-commands); aimed at large enterprise CLIs, so it's overpowered for small tools; the breaking-change cadence between major versions has historically been painful (general knowledge).

## cac

- **Repo:** https://github.com/cacjs/cac
- **npm:** https://www.npmjs.com/package/cac
- **Verified:** v7.0.0 (Feb 2026, full rewrite — preceding stable was v6.7.14 in Aug 2022), 3.1k stars, zero runtime deps, 56K install, ESM-only, `engines.node >=20.19.0`. Cadence: dormant 2022-2025, dramatic burst of activity Feb-Apr 2026.
- **Subcommand pattern** (verbatim from README):

  ```js
  import cac from 'cac';
  const cli = cac();

  cli.command('native', 'launch desktop runtime')
    .option('--platform <platform>', 'macos|ios|android|win|linux')
    .action((options) => { /* options.platform */ });

  cli.command('build', 'build the project')
    .action(() => { /* ... */ });

  cli.help();
  cli.parse();
  ```

- **Type safety:** Written in TS; ships types. Inference on `options` is loose — `options.platform` is `any` in v6; v7 docs were not exhaustively verified in this session for inference improvements.
- **ESM/CJS:** ESM-only as of v7.
- **Extensibility:** No formal plugin model. You compose programmatically. Hard to expose third-party command extensions cleanly without inventing your own convention.
- **Notable users (verified from README):** Vite, Vitest, VuePress, tsdown, bili, Foy, Taze. Strong Vite-ecosystem footprint.
- **Common complaints:** The 3+ year dormancy before v7 spooked some users; type inference weaker than citty/oclif; v7 is fresh enough that real-world breakage data isn't in yet.

## citty

- **Repo:** https://github.com/unjs/citty
- **npm:** https://www.npmjs.com/package/citty
- **Verified:** v0.2.2 (Apr 2026, pre-1.0), 1.2k stars, zero runtime deps, 56K install, ESM-only, built on Node's native `util.parseArgs`. Owned by the **unjs** collective (the same org behind Nitro, ofetch, consola, unbuild). Verified: Nuxt CLI (`packages/nuxi/package.json`) lists `citty` as a dependency.
- **Subcommand pattern** (verbatim from README, adapted to furnace):

  ```ts
  import { defineCommand, runMain } from 'citty';

  const native = defineCommand({
    meta: { name: 'native', description: 'launch desktop runtime' },
    args: {
      platform: { type: 'string', description: 'macos|ios|android|win|linux' },
    },
    run({ args }) { /* args.platform: string */ },
  });

  const build = defineCommand({
    meta: { name: 'build' },
    run() { /* ... */ },
  });

  const main = defineCommand({
    meta: { name: 'furnace', version: '0.0.1' },
    subCommands: { native, build },
  });

  runMain(main);
  ```

- **Type safety:** First-class. `args.platform` is inferred from the `args` schema. Argument types include `positional`, `boolean`, `string`, `enum`.
- **ESM/CJS:** ESM-only.
- **Extensibility:** `subCommands` accepts "Resolvable" values — a value, Promise, function, or async function — enabling **lazy-loaded** subcommands and an ad-hoc plugin pattern. Native plugin hooks (`setup` / `cleanup`) exist but the model is lighter than oclif's.
- **Notable users (verified):** Nuxt CLI (`nuxi`); broadly the unjs ecosystem (Nitro, etc.) is on it.
- **Common complaints:** Pre-1.0 means surface area can still shift; 52 open issues against 1.2k stars is a higher issue-to-popularity ratio than commander/cac; smaller community than the established players.

## yargs

- **Repo:** https://github.com/yargs/yargs
- **npm:** https://www.npmjs.com/package/yargs
- **Verified:** v18.0.0 (May 2025), 11.5k stars, **316 open issues**, 6 runtime deps, 876K install footprint with 13 transitive packages, OpenJS Foundation member, supports modern Node only (`^20.19.0 || ^22.12.0 || >=23`).
- **Subcommand pattern** (verbatim from README):

  ```js
  import yargs from 'yargs';
  import { hideBin } from 'yargs/helpers';

  yargs(hideBin(process.argv))
    .command('native', 'launch desktop runtime', (y) =>
      y.option('platform', {
        choices: ['macos', 'ios', 'android', 'win', 'linux'] as const,
        type: 'string',
      })
    , (argv) => { /* argv.platform */ })
    .command('build', 'build the project', () => {}, () => { /* ... */ })
    .demandCommand()
    .parse();
  ```

- **Type safety:** Types live in DefinitelyTyped (`@types/yargs`), not in the package itself. Inference works but lags upstream changes — historically a source of friction.
- **ESM/CJS:** ESM main entry at v18; v17 still has CJS-friendly entries.
- **Extensibility:** No first-class plugin model, but `.command()` accepts modules with `command`/`describe`/`builder`/`handler` exports — a workable convention for third-party subcommand modules.
- **Notable users (general knowledge):** Webpack CLI, Jest (older versions), nyc, AWS Amplify CLI, lerna (historically). Long tail of established tooling.
- **Common complaints:** Very large open-issue backlog (316); commit cadence has slowed (a handful of clusters per year in 2025-2026); v18 dropped older Node support aggressively; `@types/yargs` drift; perceived API bloat — yargs offers many overlapping ways to declare the same thing.

## clipanion

- **Repo:** https://github.com/arcanis/clipanion
- **npm:** https://www.npmjs.com/package/clipanion
- **Verified:** Latest published v4.0.0-rc.4. **Last commit 2024-09-06** — 20 months of silence as of 2026-05-19. 1.2k stars, 41 open issues, no `engines` field, one runtime dep (`typanion`), 592K install footprint. Maintained primarily by Maël Nison (Yarn's lead maintainer).
- **Subcommand pattern** (verbatim from README):

  ```ts
  import { Command, Option, runExit } from 'clipanion';
  import * as t from 'typanion';

  class NativeCommand extends Command {
    static paths = [['native']];
    platform = Option.String('--platform', { validator: t.isOneOf([t.isLiteral('macos'), t.isLiteral('ios')]) });
    async execute() { /* this.platform is typed */ }
  }

  class BuildCommand extends Command {
    static paths = [['build']];
    async execute() { /* ... */ }
  }

  runExit([NativeCommand, BuildCommand]);
  ```

- **Type safety:** First-class via class fields + `Option.*` helpers, with optional runtime validators via `typanion`. Strongest "looks like a typed framework" feel of the set.
- **ESM/CJS:** Dual (`require` + `import` conditions). `engines` unspecified.
- **Extensibility:** Subclassing-based — you ship `Command` subclasses. Third-party command packages are straightforward (just export classes), but there's no installer/discovery layer.
- **Notable users (verified):** Yarn (Berry). That's the headline reference, and a strong one — Yarn's CLI is one of the more demanding in the ecosystem.
- **Common complaints:** **The biggest, most current concern is the project's apparent stall** — no commits in 20 months and v4 still tagged `rc.4`. If Yarn ever moves off it, maintainership signal vanishes. Decorator-style class fields feel exotic to some teams. Class-based approach is heavier ceremony than `defineCommand` / `cli.command()`.

---

## Cross-cutting observations

- **The "tiny ESM + zero-deps" tier** (`cac`, `citty`) installs ~56K and pulls one package. **The "framework" tier** (`@oclif/core`) installs ~5 MB and pulls 38. `commander` is the surprising middle ground: 244K, zero deps, but only one package on disk because of inlined helpers. For a CLI shipped as `bin` in a published npm package, the multi-megabyte difference matters for install-time cost more than runtime.
- **First-class TypeScript inference** is in `@oclif/core`, `citty`, and `clipanion` natively; `commander` requires a sibling package; `yargs` punts to DefinitelyTyped; `cac` is in between.
- **The only library with an end-user-installable plugin model out of the box is `@oclif/core`** (`@oclif/plugin-plugins`). Everything else can support third-party subcommands via convention, but the consumer has to invent the discovery/registration shape.
- **Stagnation risk** is concentrated in `clipanion` (no commits since Sept-2024; still on `rc.4`). `yargs` is the next-most-quiet relative to its weight class but is far from abandoned — releases continue, just less frequently. The unjs governance model around `citty` is a community signal worth weighing differently from one-maintainer projects.

All commit-cadence and release-date data points were fetched 2026-05-19 from
the GitHub API. Bundle-size figures were measured by clean `npm install` on
2026-05-19. Notable-users lists are a mix of verified-from-README and
general-knowledge — labelled inline where the distinction matters.

# Per-platform build organisation — survey of seven tools

Survey of how multi-platform build tools structure per-platform code. Goal: see the range of structural patterns and their tradeoffs, not pick a winner. Every claim below labelled either **[verified this session]** with a source link, or **[general knowledge]** where I'm reasoning from training data.

## Quick comparison — where does per-platform code live?

| Tool | Pattern | Per-platform unit | Dispatch |
|------|---------|-------------------|----------|
| React Native CLI | Sibling npm packages | `cli-platform-ios`, `cli-platform-android`, `cli-platform-apple` | Config-driven command aggregation (no hard imports in core) |
| Expo CLI | Sibling folders inside one package | `start/platforms/ios/`, `start/platforms/android/` with a `PlatformManager` | Manager class |
| EAS CLI | Sibling folders inside one package | `build/ios/`, `build/android/` | Orchestrator delegates |
| Tauri CLI | Module tree, `cfg(target_os)` + `mobile/{ios,android}/` | Files per platform sharing names (`build.rs`, `run.rs`) | `match` on `PackageType` + cfg attributes |
| Capacitor CLI | Sibling folders inside one package | `cli/src/ios/`, `cli/src/android/` (same 7 file names each) | Explicit `if/else if` chain in `tasks/build.ts` |
| electron-builder | Single package, per-platform classes + per-target files | `macPackager.ts`, `winPackager.ts`, `linuxPackager.ts`; `targets/*.ts` | Dynamic-import switch in `Packager.createHelper` + `targetFactory` |
| Flutter tool | Sibling folders in one Dart package | `lib/src/{ios,android,macos,windows,linux,web,darwin}` | Per-call-site delegation (no unified interface) |
| esbuild / swc / sharp | Per-platform npm sub-packages built by a matrix CI | `npm/@esbuild/<os>-<arch>/`; SWC matrix entries; sharp matrix entries | Postinstall picks the right sub-package at install time |

## Per tool

### React Native CLI — sibling packages, config-driven aggregation **[verified this session]**

`packages/` contains the platform separation as separate npm packages: `cli-platform-ios`, `cli-platform-android`, `cli-platform-apple`, `cli-config-apple`, `cli-config-android` ([tree](https://github.com/react-native-community/cli/tree/main/packages)).

Each platform package has its own `src/commands/` and `src/index.ts` ([cli-platform-ios/src](https://github.com/react-native-community/cli/tree/main/packages/cli-platform-ios/src), [cli-platform-android/src](https://github.com/react-native-community/cli/tree/main/packages/cli-platform-android/src)).

The core CLI (`packages/cli/src/index.ts`) does **not** import platform packages directly — commands are gathered from `projectCommands` and `config.commands` (loaded via `loadConfigAsync`), which lets platform packages register themselves through the project's `react-native.config.js` instead of being hard-wired in core ([source confirmed via fetch of `index.ts`](https://github.com/react-native-community/cli/blob/main/packages/cli/src/index.ts)). Adding a new platform = publish a new `cli-platform-x` package; users opt in by listing it.

### Expo CLI + EAS Build — sibling folders, manager class **[verified this session]**

Expo CLI's runtime side organises platforms under `packages/@expo/cli/src/start/platforms/` with `android/`, `ios/`, a `PlatformManager.ts`, plus shared helpers `AppIdResolver.ts`, `DeviceManager.ts`, `ExpoGoInstaller.ts` ([tree](https://github.com/expo/expo/tree/main/packages/%40expo/cli/src/start/platforms)).

EAS CLI's `packages/eas-cli/src/build/` has `ios/`, `android/`, `utils/`, plus orchestration files: `build.ts`, `configure.ts`, `context.ts`, `runBuildAndSubmit.ts` ([tree](https://github.com/expo/eas-cli/tree/main/packages/eas-cli/src/build)). Shared orchestration in the root, platform specifics in subfolders. EAS Build *itself* (the cloud service) compiles on per-platform VM images — that lives outside the OSS repo.

### Tauri CLI — `cfg(target_os)` + parallel mobile modules **[verified this session]**

`crates/tauri-cli/src/` has top-level `build.rs`, `bundle.rs`, `dev.rs`, plus a `mobile/` subtree ([tree](https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-cli/src)).

`mobile/ios/` and `mobile/android/` mirror each other almost file-for-file ([ios tree](https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-cli/src/mobile/ios), [android tree](https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-cli/src/mobile/android)):

```
mobile/ios/        mobile/android/
  build.rs           build.rs
  dev.rs             dev.rs
  run.rs             run.rs
  project.rs         project.rs
  xcode_script.rs    android_studio_script.rs
  mod.rs             mod.rs
```

Desktop dispatch lives in `tauri-bundler/src/bundle.rs`, which uses a `match` on `PackageType` with `#[cfg(target_os = "…")]` arms routing to `macos::dmg::bundle_project`, `windows::nsis::bundle_project`, `linux::debian::bundle_project`, etc. ([verified — see snippet below](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle.rs)):

```rust
match package_type {
  #[cfg(target_os = "macos")] PackageType::Dmg => macos::dmg::bundle_project(...),
  #[cfg(target_os = "windows")] PackageType::WindowsMsi => windows::msi::bundle_project(...),
  #[cfg(target_os = "linux")] PackageType::Deb => linux::debian::bundle_project(...),
  ...
}
```

So Tauri uses **two** patterns: convention-based parallel directories for mobile, and a cfg-gated central match for desktop bundling. The desktop CLI itself stays mostly platform-agnostic — bundle is the seam.

### Capacitor CLI — parallel folders, explicit if/else **[verified this session]**

`cli/src/ios/` and `cli/src/android/` contain **identical filenames**: `add.ts`, `build.ts`, `common.ts`, `doctor.ts`, `open.ts`, `run.ts`, `update.ts` ([ios](https://github.com/ionic-team/capacitor/tree/main/cli/src/ios), [android](https://github.com/ionic-team/capacitor/tree/main/cli/src/android)). Convention-based file naming.

Dispatch in `cli/src/tasks/build.ts` is an explicit chain ([source](https://github.com/ionic-team/capacitor/blob/main/cli/src/tasks/build.ts)):

```ts
import { buildAndroid } from '../android/build';
import { buildiOS } from '../ios/build';

if (platformName == config.ios.name) {
  await buildiOS(config, buildOptions);
} else if (platformName === config.android.name) {
  await buildAndroid(config, buildOptions);
} else if (platformName === config.web.name) {
  throw `Platform "${platformName}" is not available in the build command.`;
} else {
  throw `Platform "${platformName}" is not valid.`;
}
```

Adding a platform = create the parallel folder, add an `if` branch. The "mega-switch" pattern the furnace brief warns about — but small enough that it's manageable for 2-3 platforms.

### electron-builder — sibling classes + target factory **[verified this session]**

`packages/app-builder-lib/src/` keeps platform packagers as top-level files: `macPackager.ts`, `winPackager.ts`, `linuxPackager.ts` ([src tree](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src)). Each extends a generic base: `class MacPackager extends PlatformPackager<MacConfiguration>` ([source](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/macPackager.ts)).

Dispatch in `Packager.createHelper` uses **dynamic imports + switch + factory-override hook** ([source](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/packager.ts)):

```ts
if (this.options.platformPackagerFactory != null) {
  return this.options.platformPackagerFactory(this, platform)
}
switch (platform) {
  case Platform.MAC:     return new (await import("./macPackager")).MacPackager(this)
  case Platform.WINDOWS: return new (await import("./winPackager")).WinPackager(this)
  case Platform.LINUX:   return new (await import("./linuxPackager")).LinuxPackager(this)
  default: throw new Error(`Unknown platform: ${platform}`)
}
```

Two layers: **platform packagers** (mac/win/linux) and **target classes** under `targets/` (`AppxTarget`, `MsiTarget`, `FpmTarget`, `FlatpakTarget`, `pkg.ts`, `snap.ts`, `archive.ts`, `targetFactory.ts`, plus `appimage/` and `nsis/` subfolders — [targets tree](https://github.com/electron-userland/electron-builder/tree/master/packages/app-builder-lib/src/targets)).

`targetFactory.ts` is a **partial** registry — it caches built targets in a `nameToTarget` Map but the lookup logic itself remains an if/else chain ([source](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/targetFactory.ts)). Notable: there's an explicit `platformPackagerFactory` consumer hook that overrides the whole dispatch.

### Flutter tool — parallel folders, no shared interface **[verified this session, partial]**

`packages/flutter_tools/lib/src/` has per-platform folders: `android/`, `ios/`, `darwin/`, `macos/`, `windows/`, `linux/`, `web/` ([tree](https://github.com/flutter/flutter/tree/master/packages/flutter_tools/lib/src)). `darwin/` holds shared macOS/iOS code, distinct from the per-platform folders.

Inside `ios/`: `xcodeproj.dart`, `xcode_build_settings.dart`, `xcode_debug.dart`, `xcresult.dart`, `mac.dart` (the build orchestrator), `code_signing.dart`, `ios_deploy.dart`, `simulators.dart`, etc. ([tree](https://github.com/flutter/flutter/tree/master/packages/flutter_tools/lib/src/ios)).

`ios/mac.dart` exposes a top-level `buildXcodeProject(...)` function rather than implementing a shared interface ([verified](https://github.com/flutter/flutter/blob/master/packages/flutter_tools/lib/src/ios/mac.dart)). **[general knowledge]** other platforms have analogous entry points (`gradle.dart`, `windows/build_windows.dart`, etc.). Dispatch is per-call-site — the build command for each platform is its own command class that imports its platform's helpers directly.

### esbuild / swc / sharp — publish per-platform sub-packages from a CI matrix **[verified this session]**

**esbuild**: 28 sub-packages under `npm/@esbuild/` — `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linux-musl-*` (no, just `linux-arm` etc.), `win32-arm64`, `win32-x64`, `android-arm`, plus exotics like `aix-ppc64`, `linux-loong64`, `openharmony-arm64`, `wasi-preview1` ([tree](https://github.com/evanw/esbuild/tree/main/npm/@esbuild)).

Build dispatch is in the `Makefile` — `platform-all` fans out to per-platform targets that all call `platform-internal` with different `GOOS`/`GOARCH`/`NPMDIR`/`BINPATH` env vars ([source](https://github.com/evanw/esbuild/blob/main/Makefile)). The CI does *not* matrix this — `ci.yml`'s `esbuild-platforms` job runs `make platform-all` on a single `ubuntu-latest` runner ([verified](https://github.com/evanw/esbuild/blob/main/.github/workflows/ci.yml)) because Go cross-compiles cleanly.

**SWC**: 12-target matrix in `.github/workflows/publish-npm-package.yml` ([verified](https://github.com/swc-project/swc/blob/main/.github/workflows/publish-npm-package.yml)). Each matrix entry has `{ host: runner, target: rust-triple, docker?: image, build: script }`. Targets include `x86_64-apple-darwin`, `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`, `i686-pc-windows-msvc`, `x86_64-unknown-linux-{gnu,musl}`, `aarch64-unknown-linux-{gnu,musl}`, `armv7-unknown-linux-gnueabihf`, `powerpc64le`, `s390x`. Unlike esbuild, Rust cross-compilation is messy, so SWC uses real per-OS runners and Docker images.

**sharp**: `.github/workflows/npm.yml` matrices `ubuntu-24.04`/`macos-15-intel`/`windows-2022` against package managers and Node/Deno/Bun runtimes ([verified](https://github.com/lovell/sharp/blob/main/.github/workflows/npm.yml)) — but this is the **install/test** matrix, not the prebuild matrix. **[general knowledge]** sharp's actual native binaries are prebuilt separately (historically `prebuild-install`) and downloaded at install time.

In all three, the "per-platform code" is essentially **a build target in a script + a sub-package directory**. The runtime dispatch is OS detection in a small loader (`optionalDependencies` + a `require` based on `process.platform` + `process.arch`).

## Patterns observed

**Convention-based parallel directories** dominate when there are 2-3 platforms with similar but non-shareable code: Capacitor (`ios/`/`android/`, same 7 filenames), Tauri mobile (`mobile/ios/`/`mobile/android/`, same 6 filenames), Expo, EAS, Flutter. The convention itself documents the contract — "every platform has a `build.ts`/`build.rs`" — without a formal interface. Easy to read, no central registry, but no compiler check that a new platform implements the full set.

**Central dispatch is unavoidable somewhere.** Even tools that look "plugin-y" eventually have a place where `Platform.X → SomeXClass`. The variations:
- Capacitor: hand-written `if/else if` chain ([source](https://github.com/ionic-team/capacitor/blob/main/cli/src/tasks/build.ts)).
- electron-builder: switch + dynamic `import()` + factory-override hook ([source](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/packager.ts)).
- Tauri bundler: `match` with `#[cfg(target_os = …)]` arms ([source](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle.rs)).
- React Native CLI: pushes dispatch out of core entirely via the config system — platform packages register themselves through user config.

**Dissent on registries.** electron-builder's `targetFactory` is the closest to a real registry (a `Map<string, Target>`), but lookup is still hardcoded if/else. None of the tools surveyed uses a full "register at module load time" registry pattern; they all keep platform identity static.

**Plugin/extension hooks vary widely.** electron-builder exposes `platformPackagerFactory` as a public hook for consumers to override. React Native CLI lets community platform packages plug in through config. Capacitor, Tauri CLI desktop, Flutter — no public extension point for adding a new platform; you'd fork.

**For "prebuilt binary per platform" tools (esbuild/swc/sharp), structure ≠ source layout.** The interesting per-platform code is in the CI matrix + a small build script, not the application source. swc and esbuild diverge sharply: esbuild cross-compiles everything from Linux (Go); swc fans out across native runners (Rust). Sharp historically used `prebuild-install`.

**Elegant**: Tauri bundler's `#[cfg(target_os)] + match` keeps unavailable platforms uncompilable on the wrong host — type-system-enforced platform availability. React Native CLI's config-driven plugin model decouples core entirely. esbuild's table-driven Makefile makes adding a target a 3-line diff.

**Hard to maintain (visible signs)**: Capacitor's `if/else if` works at 2 platforms but doesn't scale. electron-builder's `targetFactory` mixes registry and conditional in a way that makes adding a target require edits in 2-3 files. Flutter's per-call-site delegation works at Google's headcount; the implicit contract between platform folders is invisible.

**Common conclusion across all seven**: there's no industry consensus on the "right" shape. The choice tracks **how many platforms × how independent the build pipelines are × whether consumers extend it**. Mobile-only tools (Capacitor) use the simplest pattern and accept the if/else; cross-everything tools (electron-builder, Flutter) invest in class hierarchies; binary-distribution tools (esbuild) push the problem into CI scripts and let `optionalDependencies` do runtime selection.

# Native shell distribution across JS/native-runtime ecosystems

Survey date: 2026-05-19. Scope: how six ecosystems get a native runtime onto a consumer's machine, where consumer customisation lives, and what maintainers do to add a new platform. Verified inline from each project's current docs; reasoning-from-general-knowledge labelled `[general-knowledge]` where used.

## Comparison table

| Ecosystem | What ships on `install` | Where consumer customises | Per-target binary built | Consumer commits native source? |
|---|---|---|---|---|
| RN community CLI (vanilla) | Source templates for `ios/` and `android/` generated at `init` | Edit `ios/`/`android/` directly + autolinking from npm deps | On consumer machine via Xcode/Gradle | Yes — `ios/` and `android/` are committed |
| Expo (managed + prebuild) | JS deps + config plugins; **no** native dirs by default | `app.json` + config plugins; `ios/`/`android/` are throwaway | Cloud (EAS) or local from regenerated native dirs | No — `ios/`/`android/` are `.gitignore`d by default |
| Tauri 2 | Rust crates (`tauri`, plugins) as Cargo deps; JS bindings via npm | `src-tauri/` Rust source + `tauri.conf.json` + plugins | On consumer machine via `tauri build` / `cargo` | Yes — `src-tauri/` is committed |
| Capacitor | JS plugin + `npx cap add ios|android` scaffolds native projects | Native projects directly (Xcode/Android Studio) + JS plugins | On consumer machine | Yes — `ios/`/`android/` are committed (per the team's current position) |
| Electron + electron-builder | Pre-built per-host Electron binary downloaded in `postinstall` | `package.json` `build` config + `main.js` (no native source) | electron-builder bundles app code + Electron binary into installer per target | No — consumer has no native source to commit |
| Flutter | Pre-built engine frameworks/AARs/dylibs + per-platform runner scaffold | Edit `ios/Runner`, `android/app`, `windows/runner` etc. + Dart plugins | On consumer machine via `flutter build` | Yes — runner dirs are committed |

## 1. React Native — community CLI (vanilla, no Expo)

**Verified from docs.** The main RN docs now actively recommend Expo and defer the vanilla path to a separate page ([reactnative.dev/docs/environment-setup](https://reactnative.dev/docs/environment-setup), [getting-started-without-a-framework](https://reactnative.dev/docs/getting-started-without-a-framework)). The CLI lives at [react-native-community/cli](https://github.com/react-native-community/cli).

`npx @react-native-community/cli init MyApp` generates `ios/` and `android/` source directories alongside `package.json` and `index.js`. Per a community-cli issue: *"the React Native Community CLI init command creates placeholders in package.json, index.json, android/, and ios/ directories"* (cited via search, [cli #1070](https://github.com/react-native-community/cli/issues/1070)). These dirs are owned by the consumer and committed to git. Native modules attach via **autolinking** — installing an npm package with native code causes Gradle/CocoaPods to discover and link it automatically.

**Adding a new platform (maintainer view) [general-knowledge]:** RN itself adds platforms by adding a new template directory plus a runtime + autolinking implementation. Out-of-tree (Windows, macOS, tvOS) lives in separate forks/packages that ship their own templates.

**Pain points [general-knowledge + community search]:** upgrades are notoriously painful precisely because consumers own and have likely edited `ios/` and `android/` — the Expo CNG docs cite this as *"the number one weakness"* of RN ([docs.expo.dev/workflow/continuous-native-generation](https://docs.expo.dev/workflow/continuous-native-generation/)).

## 2. Expo — prebuild, EAS Build, config plugins

**Verified from docs.** Expo's Continuous Native Generation (CNG) inverts the RN model. From [the CNG docs](https://docs.expo.dev/workflow/continuous-native-generation/): *"The android and ios directories are automatically added to .gitignore"* and *"short-lived native projects are generated only when needed, such as when debugging or building."* The consumer maintains *"only the definition of their customizations, rather than all of the native project code."*

Customisation flows through **config plugins** ([docs](https://docs.expo.dev/config-plugins/introduction/)): *"Using a config plugin, you can modify native projects created during the prebuild process in CNG projects."* Mods *"are only evaluated during the syncing phase of `npx expo prebuild`"* — they patch generated `Info.plist`, `AndroidManifest.xml`, icons, entitlements, etc.

**EAS Build** ([docs](https://docs.expo.dev/build/introduction/)) is *"a hosted Expo Application Services (EAS) service that builds app binaries…for your Expo and React Native projects."* Cloud builds by default (Linux for Android, macOS for iOS); `eas build --local` available.

**Adopting from bare RN** ([adopting-prebuild](https://docs.expo.dev/guides/adopting-prebuild/)): `npx expo prebuild --clean` *"will regenerate the android and ios directories based on the app config."*

**Tradeoffs:** consumers give up direct edits in exchange for safe upgrades. Anything you can't express via existing config plugins requires writing your own — non-trivial. Hybrid "I'll just edit `ios/` this once" approaches fight CNG.

## 3. Tauri 2

**Verified from docs.** Tauri's architecture is fundamentally different from RN/Expo: the consumer's app *is* a Rust binary. From [v2.tauri.app/distribute](https://v2.tauri.app/distribute/): *"Tauri builds your application directly from its CLI via the `build`, `android build` and `ios build` commands."* No prebuilt Tauri binary ships to the consumer — they install the `tauri` Rust crates from crates.io and the `@tauri-apps/cli` from npm, then compile locally. Per the architecture doc ([v2.tauri.app/concept/architecture](https://v2.tauri.app/concept/architecture/)): *"They do not ship a runtime since the final binary is compiled from Rust"* and *"The WebView libraries are not included in your final executable but dynamically linked at runtime."*

**Customisation** lives in `src-tauri/` (Rust source the consumer owns) plus `tauri.conf.json`. Window chrome, icons, bundle ids, app metadata — all declarative config baked at compile time by `tauri-codegen`.

**Plugins** ([develop/plugins](https://v2.tauri.app/develop/plugins/)) are *"a Cargo crate (Rust backend), an optional NPM package (JavaScript API bindings), optional Android library (Kotlin) and iOS Swift package for mobile."* Naming: `tauri-plugin-{name}` on crates.io, `@scope/plugin-{name}` on npm. Plugins ship as source (crates) and are compiled into the consumer's binary.

**Sidecar pattern** ([develop/sidecar](https://v2.tauri.app/develop/sidecar/)) is for *external* prebuilt executables you bundle alongside your app (e.g., a Python CLI): *"a binary with the same name and a `-$TARGET_TRIPLE` suffix must exist on the specified path"* — the maintainer ships e.g. `my-sidecar-aarch64-apple-darwin` and `my-sidecar-x86_64-unknown-linux-gnu`. Configured via `bundle.externalBin` in `tauri.conf.json`.

**Adding a new platform (maintainer view):** Tauri added mobile by adding `tauri::mobile`, `tauri ios`/`tauri android` subcommands, and platform-specific webview bindings. Consumers opt in via the CLI, no prebuilt redistribution.

**Tradeoffs:** consumer must have a working Rust toolchain. Cross-compiling is hard. Every consumer pays the compile cost. Upside: maximum flexibility, no opacity, no per-target binary distribution problem for the framework itself.

## 4. Capacitor

**Verified from docs + community.** Per the [workflow doc](https://capacitorjs.com/docs/basics/workflow): *"Opening the native project can give you full control over the native runtime of your application. You can create plugins, add custom native code, or compile your application for releasing."* `npx cap sync` *"copies over your already built web bundle to both your Android and iOS projects."*

`npx cap add ios|android` generates full native projects in the consumer's repo. Per [capacitor #2505](https://github.com/ionic-team/capacitor/issues/2505): *"At the moment Capacitor requires the native platforms (iOS, Android, etc.) code to be included into source control."* There is an open feature request to move toward a CNG-style model but it has not landed [general-knowledge from issue thread, verified 2026-05].

**Plugins** are dual JS + native modules (Swift/Kotlin), distributed as npm packages that ship native source. Autolinking-style integration via `cap sync`.

**Customisation:** consumer edits Xcode/Android Studio projects directly — same model as bare RN.

**Tradeoffs:** very flexible, native devs feel at home; upgrades require manual reconciliation, similar pain to bare RN. The `cap sync` boundary causes gitignore mishaps (e.g., [#5563](https://github.com/ionic-team/capacitor/issues/5563), [#4626](https://github.com/ionic-team/capacitor/issues/4626)) when generated files land inside committed dirs.

## 5. Electron + electron-builder

**Verified from docs.** Per [Electron's advanced installation guide](https://www.electronjs.org/docs/latest/tutorial/installation): *"During installation, the `electron` module will call out to `@electron/get` to download prebuilt binaries of Electron for your platform."* Cached at `~/Library/Caches/electron/` on macOS, `$LOCALAPPDATA/electron/Cache` on Windows, `~/.cache/electron/` on Linux. `ELECTRON_SKIP_BINARY_DOWNLOAD=1` opts out.

The consumer **has no native source** — they write JS (`main.js`, `preload.js`, renderer code). Window chrome is configured via the `BrowserWindow` JS API at runtime, not at build time.

**electron-builder** ([electron.build](https://www.electron.build/)) is *"a complete solution to package and build a ready for distribution Electron app for macOS, Windows and Linux."* Configuration lives in `package.json`'s `build` block — `appId`, icons, target formats (DMG, NSIS, MSI, AppImage, Snap, etc.). It *"downloads all required tools files on demand automatically,"* including the Electron binary for the target platform when cross-building.

**Adding a new platform:** done by Electron upstream by publishing prebuilt binaries for new (OS, arch) pairs to the releases server; consumers/builders pick them up via `@electron/get`. Pure infra change for the maintainer.

**Tradeoffs:** zero native source for consumers = simplest model + fastest install (just a binary download). But window chrome customisation is JS-only at runtime; deeper native customisation requires native modules (which then drag in the bare-RN-style pain via `node-gyp` or `prebuildify`). Binary opacity — what shipped is what Electron team built.

## 6. Flutter

**Verified from docs + general-knowledge.** Per the [platform-channels doc](https://docs.flutter.dev/platform-integration/platform-channels) and the `flutter create` behaviour: each platform has a "runner" directory the consumer owns and commits — `ios/Runner` (Swift/Obj-C), `android/app` (Kotlin/Java), `windows/runner` (C++), `linux/runner` (C), `macos/Runner`.

The actual **Flutter engine** ships as **prebuilt binaries** that the runner embeds [general-knowledge, consistent with Flutter SDK layout]: `Flutter.framework` (iOS), `flutter.jar`/`.aar` (Android), platform shared libs. These come from the Flutter SDK on the build machine, not from npm — `flutter pub get` resolves Dart deps, and `flutter build` orchestrates platform tooling to embed the engine.

**Customisation** happens at three layers: (1) Dart code, (2) the runner native code consumers can freely edit, (3) plugins (Dart + per-platform native code).

**Adding a new platform (maintainer view):** Flutter added desktop/web by shipping new engine binaries plus new runner templates and a new entry in `flutter create`. The work is engine-side; the consumer-side surface is "new runner dir + add it to git."

**Tradeoffs:** the hybrid "prebuilt engine + consumer-owned thin runner" gives both upgrade safety (engine changes don't touch your runner) and full customisation (runner is yours). The cost is per-platform runner sprawl — Flutter projects accumulate up to six platform subdirectories.

## Patterns observed across ecosystems

**Three archetypes for shipping the runtime:**
- **Binary-ship (Electron):** prebuilt per-host binary downloaded in `postinstall`; consumer has no native source at all. Simplest install, opaque, customisation is JS-only.
- **Source-ship-and-compile (Tauri, RN-vanilla, Capacitor):** runtime is source (Rust crates / RN core / Capacitor native libs); consumer compiles it on their machine. Most flexible, slowest, requires platform toolchains.
- **Hybrid generate-on-demand (Expo, Flutter — different flavours):** Expo regenerates the *whole* native project from config on each prebuild; Flutter ships a prebuilt engine binary that a consumer-owned thin runner embeds. Both decouple framework upgrades from consumer customisations, by different mechanisms.

**Where customisation lives — three patterns:**
- **Edit native source directly** (RN-vanilla, Capacitor, Flutter runner, Tauri's `src-tauri`): max flexibility, biggest upgrade tax.
- **Declarative config + plugin system** (Expo config plugins, Tauri `tauri.conf.json`, electron-builder `build` block): consumer expresses intent; tooling materialises native files. Cheap upgrades, but new requirements need new plugin/config surface.
- **Runtime JS APIs** (Electron `BrowserWindow`): no build-time customisation needed for the common case, because the binary is fully general.

**Per-target binary distribution by the framework itself is rare.** Electron is the clearest "framework ships its own prebuilt binaries to npm consumers" case (and it does so via `@electron/get` + postinstall, not via npm `optionalDependencies` — relevant nuance). Flutter ships engine binaries but they're delivered via the Flutter SDK, not per-app via npm. Tauri/RN/Capacitor compile-on-consumer instead. The `optionalDependencies` per-platform pattern (esbuild/swc/sharp) is dominant for **pure tooling** (compilers, image processors) but uncommon for **shell runtimes** in this corpus.

**Plugin systems are universal but architecturally split:** every ecosystem has one, but they divide cleanly into "plugins are source compiled into the app" (Tauri, Flutter, Capacitor, RN) vs "plugins are JS that drives a general-purpose runtime" (Electron). Expo's config plugins are a third species: they don't add functionality, they *patch* generated native files.

**Contested area: who owns the native dirs.** Bare RN and Capacitor say "you do, commit them." Expo says "nobody, regenerate them." Flutter splits the difference (engine = framework, runner = you). This is the loudest active debate ([capacitor #2505](https://github.com/ionic-team/capacitor/issues/2505), Expo CNG framing). The friction point is always upgrades vs customisation reach.

**Sidecar/external-binary patterns are an escape hatch, not a primary distribution model.** Tauri's `externalBin` exists for shipping arbitrary executables (Python CLIs, etc.) alongside an app; it requires `-$TARGET_TRIPLE` suffixed binaries the maintainer assembles per release. Electron's analogous concept is "extraResources." Neither uses npm `optionalDependencies` for this — both are file-path-based bundling at packaging time.

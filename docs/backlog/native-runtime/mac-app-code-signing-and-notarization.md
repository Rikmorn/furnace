# Mac app code signing & notarization

Mac builds today are signed only by cargo's linker auto ad-hoc stamp on the Mach-O. The `.app` bundle itself is missing `Contents/_CodeSignature/CodeResources`, so `spctl` rejects it as malformed ("no resources but signature indicates they must be present"). On the build machine the app runs fine because locally-created files don't carry `com.apple.quarantine`; on any other Mac the bundle picks up quarantine on transfer and Gatekeeper refuses to launch it, surfacing as `LSOpenURLsWithCompletionHandler() failed with error -10810` (`kLSUnknownErr`).

Current escape hatch for trusted hand-offs: recipient strips quarantine with `xattr -dr com.apple.quarantine <app>` and the ad-hoc-signed app launches. Verified working on Apple Silicon. Not a distribution model — only suitable for sending to people you trust enough to ask them to run a terminal command.

Two layers of work when we pick this up:

1. **Make the bundle structurally valid.** Wire `codesign --force --deep --sign - <app>` as a post-build step in `packages/tools/crates/furnace-cli/src/build/macos.rs`. Still ad-hoc, but the bundle gets a real `_CodeSignature/` and `spctl` stops complaining about malformation. Doesn't change the distribution story but removes a latent footgun.
2. **Real distribution path.** Developer ID Application cert ($99/yr Apple Developer Program) → `codesign --options runtime` with entitlements → `xcrun notarytool submit --wait` → `xcrun stapler staple`. After stapling, the app launches on any Mac without the recipient touching `xattr`.

**Trigger to revisit:** First external user beyond direct trusted hand-offs, OR cookbook becomes shareable as a Mac app (vs. web), OR first `furnace` consumer ships a real app and needs the signing chain documented.

**Reference:** `docs/reference/packaging-and-distribution.md` §6 (native shell distribution); `docs/research/2026-05-19-build-distribution/native-shell-distribution.md`.

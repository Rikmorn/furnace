//! Integration test for `furnace build --platform=macos`.
//!
//! Runs the CLI against the hello-world workspace member and asserts the .app
//! is produced with the expected structure. Requires the test runner to be on
//! macOS; skipped otherwise.

#![cfg(target_os = "macos")]

use std::process::Command;

#[test]
fn build_macos_produces_app() {
    // Resolve repo root from CARGO_MANIFEST_DIR (packages/tools/crates/furnace-cli).
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("repo root")
        .to_path_buf();
    let hello_world = repo_root.join("packages/hello-world");

    let status = Command::new("bun")
        .args(["run", "build:macos"])
        .current_dir(&hello_world)
        .status()
        .expect("failed to spawn bun");
    assert!(status.success(), "build:macos exited non-zero");

    let app = hello_world.join("dist/macos/hello-world.app");
    assert!(app.exists(), "{} missing", app.display());
    assert!(app.join("Contents/Info.plist").exists());
    assert!(app.join("Contents/MacOS/hello-world").exists());
}

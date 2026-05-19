//! Consumer entrypoint scaffolded by `furnace init` (manual in Phase 2).
//!
//! Boots furnace-runtime and points it at the web assets the CLI copied into
//! the .app bundle's `Contents/Resources/web/` during build.

use anyhow::{Context, Result};
use furnace_runtime::{run, AppConfig};
use std::path::PathBuf;

fn main() -> Result<()> {
    let assets_dir = resolve_assets_dir().context("failed to resolve assets dir")?;
    let mut config = AppConfig::new("furnace://localhost/index.html");
    config.title = "furnace".into();
    config.assets_dir = Some(assets_dir);
    run(config)
}

/// macOS .app layout: `Foo.app/Contents/MacOS/<exe>` → assets at `../Resources/web/`.
fn resolve_assets_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let assets = exe
        .parent()
        .context("exe has no parent")?
        .parent()
        .context("MacOS dir has no parent")?
        .join("Resources/web");
    if !assets.is_dir() {
        anyhow::bail!(
            "assets dir not found at {} — was the .app constructed correctly?",
            assets.display()
        );
    }
    Ok(assets)
}

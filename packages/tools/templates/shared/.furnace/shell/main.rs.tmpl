//! Consumer entrypoint scaffolded by `furnace init` (manual in Phase 2).
//!
//! Boots furnace-runtime and points it at the web assets the CLI copied into
//! the .app bundle's `Contents/Resources/web/` during build. Window options
//! come from `furnace_config.rs`, which the CLI generates from
//! `furnace.config.json` each build/dev run.

mod furnace_config;

use anyhow::{Context, Result};
use furnace_runtime::{run, AppConfig};
use std::path::PathBuf;

fn main() -> Result<()> {
    let mut config = match std::env::var("FURNACE_DEV_URL") {
        Ok(dev_url) => AppConfig::new(dev_url),
        Err(_) => {
            let assets_dir = resolve_assets_dir().context("failed to resolve assets dir")?;
            let mut c = AppConfig::new("furnace://localhost/index.html");
            c.assets_dir = Some(assets_dir);
            c
        }
    };
    config.title = furnace_config::WINDOW_TITLE.into();
    config.width = furnace_config::WINDOW_WIDTH;
    config.height = furnace_config::WINDOW_HEIGHT;
    config.fullscreen = furnace_config::WINDOW_FULLSCREEN;
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

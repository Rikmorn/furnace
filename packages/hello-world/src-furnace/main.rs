//! Consumer entrypoint scaffolded by `furnace init` (manual in Phase 2).
//!
//! Boots furnace-runtime, extracting the bundled web assets to the user's cache
//! dir at startup, then pointing the runtime at them via a custom protocol.

use anyhow::{Context, Result};
use furnace_runtime::{run, AppConfig};
use std::path::PathBuf;

const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.bin"));

fn main() -> Result<()> {
    let assets_dir = extract_payload().context("failed to extract bundled payload")?;
    let mut config = AppConfig::new("furnace://localhost/index.html");
    config.title = "furnace".into();
    config.assets_dir = Some(assets_dir);
    run(config)
}

fn extract_payload() -> Result<PathBuf> {
    let cache_dir = dirs::cache_dir()
        .context("no cache dir")?
        .join(env!("CARGO_PKG_NAME"))
        .join("payload");
    std::fs::create_dir_all(&cache_dir)?;
    let cursor = std::io::Cursor::new(PAYLOAD);
    let mut archive = tar::Archive::new(cursor);
    archive.unpack(&cache_dir)?;
    Ok(cache_dir)
}

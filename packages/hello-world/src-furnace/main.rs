//! Consumer entrypoint scaffolded by `furnace init` (manual in Phase 2).
//!
//! Boots furnace-runtime and points it at the bundled web assets extracted to
//! the user's cache dir at startup.

use anyhow::{Context, Result};
use furnace_runtime::{run, AppConfig};
use std::path::PathBuf;

const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.bin"));

fn main() -> Result<()> {
    let entry = extract_payload().context("failed to extract bundled payload")?;
    let url = format!("file://{}", entry.to_string_lossy());
    let mut config = AppConfig::new(url);
    config.title = "furnace".into();
    run(config)
}

fn extract_payload() -> Result<PathBuf> {
    // Cache dir: ~/Library/Caches/com.furnace.hello-world/payload/
    let cache_dir = dirs::cache_dir()
        .context("no cache dir")?
        .join(env!("CARGO_PKG_NAME"))
        .join("payload");
    std::fs::create_dir_all(&cache_dir)?;
    // Unpack: PAYLOAD is a tar archive (built by build.rs).
    let cursor = std::io::Cursor::new(PAYLOAD);
    let mut archive = tar::Archive::new(cursor);
    archive.unpack(&cache_dir)?;
    Ok(cache_dir.join("index.html"))
}

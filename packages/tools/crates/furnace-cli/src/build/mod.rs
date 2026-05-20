use crate::build::context::{BuildContext, BuiltArtifacts};
use crate::config::FurnaceConfig;
use anyhow::{bail, Result};
use std::path::PathBuf;
use std::process::{Command, Stdio};

pub mod context;
pub mod macos;

pub trait PlatformBuilder {
    fn target_triple(&self) -> &'static str;
    fn pre_flight(&self, ctx: &BuildContext) -> Result<()>;
    fn package(&self, ctx: &BuildContext, artifacts: &BuiltArtifacts) -> Result<PathBuf>;
}

pub fn dispatch(platform: &str) -> Result<Box<dyn PlatformBuilder>> {
    match platform {
        "macos" => Ok(Box::new(macos::MacosBuilder)),
        other => anyhow::bail!("unknown platform: {other}"),
    }
}

pub fn check_prereqs(config: &FurnaceConfig) -> Result<()> {
    if config.plugins.is_empty() {
        return Ok(());
    }
    let ok = Command::new("wasm-pack")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        bail!("wasm-pack not found on PATH — run `cargo install wasm-pack --locked`");
    }
    Ok(())
}

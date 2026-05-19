use crate::build::context::{BuildContext, BuiltArtifacts};
use anyhow::Result;
use std::path::PathBuf;

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

use crate::config::{FurnaceConfig, ProjectPaths};
use std::path::PathBuf;

pub struct BuildContext {
    pub config: FurnaceConfig,
    pub paths: ProjectPaths,
    /// Tmp dir where the JS bundle lands before being passed to cargo build.
    pub web_staging_dir: PathBuf,
}

pub struct BuiltArtifacts {
    pub binary: PathBuf,
}

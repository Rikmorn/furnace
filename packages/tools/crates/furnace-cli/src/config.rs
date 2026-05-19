//! Parses furnace.config.json. Schema is minimal in Phase 2; expands later.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Debug)]
pub struct FurnaceConfig {
    pub identity: Identity,
    pub source: String,
    #[serde(default = "default_entry")]
    pub entry: String,
    pub window: Window,
    #[serde(default)]
    pub plugins: Vec<String>,
}

#[derive(Deserialize, Debug)]
pub struct Identity {
    pub name: String,
    #[serde(rename = "bundleId")]
    pub bundle_id: String,
    pub version: String,
}

#[derive(Deserialize, Debug)]
pub struct Window {
    pub title: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub fullscreen: bool,
}

fn default_entry() -> String {
    "index.html".into()
}

impl FurnaceConfig {
    pub fn load_from(project_root: &Path) -> Result<Self> {
        let path = project_root.join("furnace.config.json");
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
    }
}

pub struct ProjectPaths {
    pub root: PathBuf,
    pub source_dir: PathBuf,
    pub src_furnace: PathBuf,
    pub platforms: PathBuf,
    pub dist: PathBuf,
}

impl ProjectPaths {
    pub fn resolve(root: &Path, config: &FurnaceConfig) -> Self {
        let root = root.to_path_buf();
        Self {
            source_dir: root.join(&config.source),
            src_furnace: root.join("src-furnace"),
            platforms: root.join("platforms"),
            dist: root.join("dist"),
            root,
        }
    }
}

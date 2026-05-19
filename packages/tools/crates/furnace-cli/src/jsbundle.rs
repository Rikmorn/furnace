//! Invokes `bun build` to produce the native-target JS bundle.

use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

pub struct BundleRequest<'a> {
    pub project_root: &'a Path,
    pub entry_html: &'a Path,
    pub out_dir: &'a Path,
    pub mode: BundleMode,
}

pub enum BundleMode {
    Prod,
    Dev,
}

pub fn bundle(req: BundleRequest<'_>) -> Result<()> {
    std::fs::create_dir_all(req.out_dir)?;
    let mut cmd = Command::new("bun");
    cmd.current_dir(req.project_root)
        .arg("build")
        .arg(req.entry_html)
        .arg("--outdir")
        .arg(req.out_dir);
    match req.mode {
        BundleMode::Prod => {
            cmd.args(["--minify", "--sourcemap=external"]);
        }
        BundleMode::Dev => {
            cmd.arg("--sourcemap=inline");
        }
    }
    let status = cmd.status().context("failed to invoke `bun build`")?;
    if !status.success() {
        bail!("bun build failed");
    }
    Ok(())
}

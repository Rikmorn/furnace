use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

pub struct WasmRequest<'a> {
    pub crate_path: &'a Path,
    pub out_dir: &'a Path,
    pub release: bool,
}

pub fn compile(req: WasmRequest<'_>) -> Result<()> {
    std::fs::create_dir_all(req.out_dir)?;
    let mut cmd = Command::new("wasm-pack");
    cmd.args(["build", "--target", "web", "--out-dir"])
        .arg(req.out_dir)
        .arg(req.crate_path);
    if !req.release {
        cmd.arg("--dev");
    }
    let status = cmd
        .status()
        .context("failed to invoke wasm-pack — is it installed?")?;
    if !status.success() {
        bail!("wasm-pack failed for {}", req.crate_path.display());
    }
    Ok(())
}

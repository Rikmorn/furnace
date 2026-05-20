use super::context::{BuildContext, BuiltArtifacts};
use super::PlatformBuilder;
use anyhow::{bail, Context, Result};
use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub struct MacosBuilder;

impl PlatformBuilder for MacosBuilder {
    fn target_triple(&self) -> &'static str {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    }

    fn pre_flight(&self, ctx: &BuildContext) -> Result<()> {
        if !ctx
            .paths
            .platforms_dir
            .join("macos")
            .join("Info.plist")
            .exists()
        {
            bail!(
                ".furnace/platforms/macos/Info.plist missing — run `furnace init --platform=macos`"
            );
        }
        if !ctx.paths.shell_dir.join("Cargo.toml").exists() {
            bail!(".furnace/shell/Cargo.toml missing — run `furnace init --platform=macos`");
        }
        Ok(())
    }

    fn package(&self, ctx: &BuildContext, artifacts: &BuiltArtifacts) -> Result<PathBuf> {
        let app_name = format!("{}.app", ctx.config.identity.name);
        let app_dir = ctx.paths.dist.join("macos").join(&app_name);
        if app_dir.exists() {
            fs::remove_dir_all(&app_dir)?;
        }
        let contents = app_dir.join("Contents");
        let macos_dir = contents.join("MacOS");
        let resources = contents.join("Resources");
        fs::create_dir_all(&macos_dir)?;
        fs::create_dir_all(&resources)?;

        let exe_name = &ctx.config.identity.name;
        fs::copy(&artifacts.binary, macos_dir.join(exe_name))?;

        let plist_template = fs::read_to_string(ctx.paths.platforms_dir.join("macos/Info.plist"))?;
        let plist = plist_template
            .replace("${IDENTITY_NAME}", &ctx.config.identity.name)
            .replace("${IDENTITY_BUNDLE_ID}", &ctx.config.identity.bundle_id)
            .replace("${IDENTITY_VERSION}", &ctx.config.identity.version);
        fs::write(contents.join("Info.plist"), plist)?;

        copy_dir_recursive(&ctx.web_staging_dir, &resources.join("web"))
            .context("copy web bundle into Contents/Resources/web")?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let bin = macos_dir.join(exe_name);
            let mut perms = fs::metadata(&bin)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&bin, perms)?;
        }

        Ok(app_dir)
    }
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let dst_entry = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_entry)?;
        } else {
            fs::copy(entry.path(), &dst_entry)?;
        }
    }
    Ok(())
}

pub fn cargo_build_debug(ctx: &BuildContext) -> Result<PathBuf> {
    let target = MacosBuilder.target_triple();
    let manifest = ctx.paths.shell_dir.join("Cargo.toml");
    // Pin the target dir explicitly so the build is predictable regardless of
    // any ambient .cargo/config.toml that might redirect target-dir.
    let target_dir = ctx.paths.shell_dir.join("target");
    let status = Command::new("cargo")
        .args(["build", "--target", target, "--manifest-path"])
        .arg(&manifest)
        .env("CARGO_TARGET_DIR", &target_dir)
        .status()
        .context("cargo build (debug) failed to start")?;
    if !status.success() {
        bail!("cargo build (debug) failed");
    }
    let binary = target_dir
        .join(target)
        .join("debug")
        .join(&ctx.config.identity.name);
    if !binary.exists() {
        bail!("expected debug binary at {} after build", binary.display());
    }
    Ok(binary)
}

pub fn cargo_build_release(ctx: &BuildContext) -> Result<PathBuf> {
    let target = MacosBuilder.target_triple();
    let manifest = ctx.paths.shell_dir.join("Cargo.toml");
    // Pin the target dir explicitly so the build is predictable regardless of
    // any ambient .cargo/config.toml that might redirect target-dir.
    let target_dir = ctx.paths.shell_dir.join("target");
    let status = Command::new("cargo")
        .args(["build", "--release", "--target", target, "--manifest-path"])
        .arg(&manifest)
        .env("CARGO_TARGET_DIR", &target_dir)
        .status()
        .context("cargo build failed to start")?;
    if !status.success() {
        bail!("cargo build (release) failed");
    }
    let binary = target_dir
        .join(target)
        .join("release")
        .join(&ctx.config.identity.name);
    if !binary.exists() {
        bail!("expected binary at {} after build", binary.display());
    }
    Ok(binary)
}

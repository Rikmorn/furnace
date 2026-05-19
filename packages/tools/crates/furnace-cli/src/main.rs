//! furnace — workspace CLI.
//!
//! Phase 1 surface: clap definitions for the milestone-1 command set. Commands
//! return `Err(unimplemented)` for now; later phases fill them in.

mod build;
mod config;
mod jsbundle;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "furnace", about = "Furnace engine CLI", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Production build for a platform target.
    Build {
        #[arg(long, value_parser = ["macos"])]
        platform: String,
    },
    /// Dev session with HMR.
    Dev {
        #[arg(long, value_parser = ["macos"])]
        platform: String,
    },
    /// Compile a Rust crate to wasm.
    Wasm { crate_path: std::path::PathBuf },
    /// Scaffold a new project (or add a platform to an existing one).
    Init {
        name: String,
        #[arg(long, value_parser = ["macos"])]
        platform: String,
    },
    /// Re-vendor the runtime source from the installed @furnace/tools.
    UpgradeRuntime,
    /// (Legacy bridge — retired in Phase 3.) Launch the old furnace-window crate.
    #[command(hide = true)]
    Native {
        #[arg(long)]
        rebuild: bool,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Build { platform } => run_build(&platform),
        Command::Dev { .. } => bail!("furnace dev is not yet implemented (Phase 3)"),
        Command::Wasm { .. } => bail!("furnace wasm is not yet implemented (Phase 4)"),
        Command::Init { .. } => bail!("furnace init is not yet implemented (Phase 5)"),
        Command::UpgradeRuntime => {
            bail!("furnace upgrade-runtime is not yet implemented (Phase 5)")
        }
        Command::Native { rebuild } => legacy_native(rebuild),
    }
}

fn run_build(platform: &str) -> Result<()> {
    use crate::build::context::{BuildContext, BuiltArtifacts};
    use crate::config::{FurnaceConfig, ProjectPaths};
    use crate::jsbundle::{bundle, BundleMode, BundleRequest};
    use anyhow::Context;

    let project_root = std::env::current_dir()?;
    let config = FurnaceConfig::load_from(&project_root)?;
    let paths = ProjectPaths::resolve(&project_root, &config);

    let builder = build::dispatch(platform)?;

    let staging = tempfile::tempdir().context("create tmp dir")?;
    let web_staging = staging.path().join("web");
    bundle(BundleRequest {
        project_root: &paths.root,
        entry_html: &paths.source_dir.join(&config.entry),
        out_dir: &web_staging,
        mode: BundleMode::Prod,
    })?;

    let platforms_dir = paths.platforms.join(platform);
    let ctx = BuildContext {
        config,
        paths,
        web_staging_dir: web_staging,
    };
    builder.pre_flight(&ctx)?;

    let binary = build::macos::cargo_build_release(&ctx)?;
    let artifacts = BuiltArtifacts {
        binary,
        app_metadata_dir: platforms_dir,
    };

    let app = builder.package(&ctx, &artifacts)?;
    println!("✓ {}", app.display());
    Ok(())
}

fn legacy_native(rebuild: bool) -> Result<()> {
    use anyhow::Context;
    use std::process::Command as Proc;
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let legacy_manifest = std::path::Path::new(manifest_dir)
        .join("../../native/Cargo.toml")
        .canonicalize()
        .context("failed to resolve legacy native crate path")?;
    let binary_path =
        std::path::Path::new(manifest_dir).join("../../../../dist/rust/release/furnace-window");
    if rebuild || !binary_path.exists() {
        let status = Proc::new("cargo")
            .args(["build", "--release", "--manifest-path"])
            .arg(&legacy_manifest)
            .status()
            .context("failed to invoke cargo for legacy native crate")?;
        if !status.success() {
            bail!("legacy native crate failed to build");
        }
    }
    let binary = binary_path
        .canonicalize()
        .context("legacy binary not found after build")?;
    let status = Proc::new(binary)
        .status()
        .context("legacy binary failed to launch")?;
    std::process::exit(status.code().unwrap_or(1));
}

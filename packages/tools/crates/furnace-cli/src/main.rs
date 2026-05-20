//! furnace — workspace CLI.
//!
//! Phase 1 surface: clap definitions for the milestone-1 command set. Commands
//! return `Err(unimplemented)` for now; later phases fill them in.

mod build;
mod config;
mod dev;
mod init;
mod jsbundle;
mod wasm;

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
    /// Scaffold the native-shell bits into the current directory.
    Init {
        #[arg(long, value_parser = ["macos"])]
        platform: String,
    },
    /// Re-vendor the runtime source from the installed @furnace/tools.
    UpgradeRuntime,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Build { platform } => run_build(&platform),
        Command::Dev { platform } => dev::run_dev(&platform),
        Command::Wasm { crate_path } => wasm::compile(wasm::WasmRequest {
            crate_path: &crate_path,
            out_dir: &crate_path.join("pkg"),
            release: false,
        }),
        Command::Init { platform } => init::run_init(&platform, &std::env::current_dir()?),
        Command::UpgradeRuntime => {
            bail!("furnace upgrade-runtime is not yet implemented (Phase 5)")
        }
    }
}

fn run_build(platform: &str) -> Result<()> {
    use crate::build::context::{BuildContext, BuiltArtifacts};
    use crate::config::{FurnaceConfig, ProjectPaths};
    use crate::jsbundle::{bundle, BundleMode, BundleRequest};
    use anyhow::Context;

    let project_root = std::env::current_dir()?;
    let config = FurnaceConfig::load_from(&project_root)?;
    build::check_prereqs(&config)?;
    let paths = ProjectPaths::resolve(&project_root, &config);

    for plugin_rel in &config.plugins {
        let crate_path = paths.root.join(plugin_rel);
        wasm::compile(wasm::WasmRequest {
            crate_path: &crate_path,
            out_dir: &crate_path.join("pkg"),
            release: true,
        })?;
    }

    let builder = build::dispatch(platform)?;

    let staging = tempfile::tempdir().context("create tmp dir")?;
    let web_staging = staging.path().join("web");
    bundle(BundleRequest {
        project_root: &paths.root,
        entry_html: &paths.source_dir.join(&config.entry),
        out_dir: &web_staging,
        mode: BundleMode::Prod,
    })?;

    let platforms_dir = paths.platforms_dir.join(platform);
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

//! furnace — workspace CLI.
//!
//! Phase 1 surface: clap definitions for the milestone-1 command set. Commands
//! return `Err(unimplemented)` for now; later phases fill them in.

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
    Wasm {
        crate_path: std::path::PathBuf,
    },
    /// Scaffold a new project (or add a platform to an existing one).
    Init {
        name: String,
        #[arg(long, value_parser = ["macos"])]
        platform: String,
    },
    /// Re-vendor the runtime source from the installed @furnace/tools.
    UpgradeRuntime,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Build { .. } => bail!("furnace build is not yet implemented (Phase 2)"),
        Command::Dev { .. } => bail!("furnace dev is not yet implemented (Phase 3)"),
        Command::Wasm { .. } => bail!("furnace wasm is not yet implemented (Phase 4)"),
        Command::Init { .. } => bail!("furnace init is not yet implemented (Phase 5)"),
        Command::UpgradeRuntime => bail!("furnace upgrade-runtime is not yet implemented (Phase 5)"),
    }
}

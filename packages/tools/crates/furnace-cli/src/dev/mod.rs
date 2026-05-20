//! `furnace dev --platform=<platform>` orchestrator.
//!
//! Spawns the consumer's configured dev server (HMR is the dev server's
//! concern — default config uses Bun's HTML-route serve, which ships full
//! module-level HMR), builds the consumer's debug native binary, and points
//! it at the dev server via FURNACE_DEV_URL. See design doc §Build pipeline.

use crate::build::context::BuildContext;
use crate::build::macos::cargo_build_debug;
use crate::config::{FurnaceConfig, ProjectPaths};
use anyhow::{bail, Context, Result};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const READINESS_TIMEOUT: Duration = Duration::from_secs(15);
const READINESS_POLL: Duration = Duration::from_millis(100);
const READINESS_CONNECT_TIMEOUT: Duration = Duration::from_millis(200);
const SUPERVISE_POLL: Duration = Duration::from_millis(200);

pub fn run_dev(platform: &str) -> Result<()> {
    if platform != "macos" {
        bail!("furnace dev only supports --platform=macos in milestone 1");
    }
    let project_root = std::env::current_dir()?;
    let config = FurnaceConfig::load_from(&project_root)?;
    let paths = ProjectPaths::resolve(&project_root, &config);
    let port = config.dev.port;

    let mut server = spawn_dev_server(&config.dev.serve_cmd, &paths.root)?;
    if let Err(e) = wait_for_port(port, READINESS_TIMEOUT) {
        let _ = server.kill();
        return Err(e);
    }

    let ctx = BuildContext {
        config,
        paths,
        web_staging_dir: std::path::PathBuf::new(),
    };
    let binary = match cargo_build_debug(&ctx) {
        Ok(b) => b,
        Err(e) => {
            let _ = server.kill();
            return Err(e);
        }
    };

    let dev_url = format!("http://localhost:{port}");
    let mut native = match Command::new(&binary)
        .env("FURNACE_DEV_URL", &dev_url)
        .spawn()
        .context("failed to spawn native binary")
    {
        Ok(n) => n,
        Err(e) => {
            let _ = server.kill();
            return Err(e);
        }
    };
    println!(
        "furnace dev: native pid {}, dev server pid {} → {dev_url}",
        native.id(),
        server.id()
    );

    supervise(&mut server, &mut native)
}

fn spawn_dev_server(serve_cmd: &str, cwd: &Path) -> Result<Child> {
    Command::new("sh")
        .args(["-c", serve_cmd])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .spawn()
        .with_context(|| format!("failed to spawn dev server: {serve_cmd}"))
}

fn wait_for_port(port: u16, timeout: Duration) -> Result<()> {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, READINESS_CONNECT_TIMEOUT).is_ok() {
            return Ok(());
        }
        thread::sleep(READINESS_POLL);
    }
    bail!("dev server didn't bind to 127.0.0.1:{port} within {timeout:?}")
}

fn supervise(server: &mut Child, native: &mut Child) -> Result<()> {
    loop {
        if let Some(status) = native.try_wait()? {
            let _ = server.kill();
            if !status.success() {
                bail!("native binary exited with {status}");
            }
            return Ok(());
        }
        if let Some(status) = server.try_wait()? {
            let _ = native.kill();
            bail!("dev server exited unexpectedly with {status}");
        }
        thread::sleep(SUPERVISE_POLL);
    }
}

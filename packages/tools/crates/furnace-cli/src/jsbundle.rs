//! Bundles the consumer's web app for native targets.
//!
//! Uses `Bun.build()` programmatically (via a generated tmp script) instead of
//! the `bun build` CLI, because plugins like bun-plugin-svelte need to be
//! registered programmatically — bunfig.toml's `[serve.static].plugins` only
//! applies to `bun serve`, not `bun build`. Without plugin support, `.svelte.ts`
//! files fail at runtime with Svelte's `rune_outside_svelte` error.

use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

pub struct BundleRequest<'a> {
    pub project_root: &'a Path,
    pub entry_html: &'a Path,
    pub out_dir: &'a Path,
}

pub fn bundle(req: BundleRequest<'_>) -> Result<()> {
    std::fs::create_dir_all(req.out_dir)?;

    let script_dir = tempfile::tempdir().context("create tmp script dir")?;
    let script_path = script_dir.path().join("bundle.mjs");

    let config = serde_json::json!({
        "entrypoints": [req.entry_html.to_string_lossy()],
        "outdir": req.out_dir.to_string_lossy(),
        "minify": true,
        "sourcemap": "external",
    });
    let config_json = serde_json::to_string(&config).context("serialize bundle config")?;

    let script = format!(
        r#"const config = {config_json};
const projectRoot = process.env.FURNACE_PROJECT_ROOT;
const plugins = [];
try {{
    const pluginPath = Bun.resolveSync("bun-plugin-svelte", projectRoot);
    const mod = await import(pluginPath);
    plugins.push(mod.SveltePlugin({{ development: false }}));
}} catch (e) {{
    const msg = String(e);
    if (!msg.includes("Cannot find") && !msg.includes("ModuleNotFound")) {{
        console.error("[furnace] svelte plugin discovery error:", e);
    }}
}}
config.plugins = plugins;
const result = await Bun.build(config);
if (!result.success) {{
    for (const m of result.logs) console.error(m);
    process.exit(1);
}}
"#
    );
    std::fs::write(&script_path, script).context("write bundle script")?;

    let status = Command::new("bun")
        .current_dir(req.project_root)
        .env("FURNACE_PROJECT_ROOT", req.project_root)
        .arg(&script_path)
        .status()
        .context("failed to invoke bun for bundle script")?;
    if !status.success() {
        bail!("bun bundle script failed");
    }
    Ok(())
}

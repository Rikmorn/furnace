//! `furnace init --platform=<platform>` — scaffolds the native-shell bits
//! into the current directory from `packages/tools/templates/`.
//!
//! Layout produced: furnace.config.json at the project root; .furnace/
//! contains shell/ (Rust glue + vendored runtime) and platforms/<platform>/
//! (Info.plist + entitlements). Consumer's own src/, package.json, etc.
//! are not touched.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

const TEMPLATE_VARS: [&str; 3] = ["${NAME}", "${BUNDLE_ID}", "${VERSION}"];

pub fn run_init(platform: &str, dest: &Path) -> Result<()> {
    let templates = templates_root()?;
    let shared = templates.join("shared");
    let platform_root = templates.join(platform);
    if !platform_root.exists() {
        bail!(
            "no templates for platform {platform} (looked in {})",
            platform_root.display()
        );
    }
    let furnace_dir = dest.join(".furnace");
    if furnace_dir.exists() {
        bail!(
            ".furnace/ already exists at {} — remove it to re-run init",
            furnace_dir.display()
        );
    }

    let name = dest
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "furnace-app".into());
    let bundle_id = format!("com.example.{}", name.replace('-', ""));
    let vars: Vec<(&str, String)> = vec![
        ("${NAME}", name.clone()),
        ("${BUNDLE_ID}", bundle_id),
        ("${VERSION}", "0.0.0".into()),
    ];

    write_tree(&shared, dest, &vars)?;
    write_tree(&platform_root, dest, &vars)?;

    println!("✓ initialised furnace at {}", dest.display());
    println!(
        "  app identity: {} (override in furnace.config.json before building)",
        name
    );
    Ok(())
}

fn templates_root() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("current_exe")?;
    let parent = exe.parent().context("exe has no parent")?;
    // Try a sequence of candidate paths:
    //  1. Shipped layout: <pkg>/furnace + <pkg>/templates  (sibling)
    //  2. In-repo dev: walk up from packages/tools/crates/target/{debug,release}/furnace
    //     to packages/tools/templates
    let candidates = [
        parent.join("templates"),
        parent.join("../../../templates"),
    ];
    for c in &candidates {
        if c.exists() {
            return c.canonicalize().context("canonicalize templates path");
        }
    }
    bail!(
        "could not locate furnace templates directory. Tried: {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn write_tree(src_root: &Path, dst_root: &Path, vars: &[(&str, String)]) -> Result<()> {
    for entry in walkdir::WalkDir::new(src_root) {
        let entry = entry.with_context(|| format!("walking {}", src_root.display()))?;
        if entry.file_type().is_dir() {
            continue;
        }
        let rel = entry.path().strip_prefix(src_root)?;
        let rel_str = rel.to_string_lossy();
        let dst_rel = rel_str.strip_suffix(".tmpl").unwrap_or(&rel_str);
        let dst = dst_root.join(dst_rel);

        // Special-case: .gitignore is merged line-by-line rather than overwritten,
        // so existing consumer-owned entries are preserved.
        if dst.file_name().and_then(|s| s.to_str()) == Some(".gitignore") {
            let text = read_template(entry.path(), vars)?;
            merge_gitignore(&dst, &text)?;
            continue;
        }

        // Skip files that already exist (preserves consumer customizations to
        // furnace.config.json, etc.). The .furnace/ guard in run_init prevents
        // partial collisions inside the tool-owned tree.
        if dst.exists() {
            continue;
        }
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if rel_str.ends_with(".tmpl") {
            let text = read_template(entry.path(), vars)?;
            std::fs::write(&dst, text).with_context(|| format!("writing {}", dst.display()))?;
        } else {
            std::fs::copy(entry.path(), &dst).with_context(|| {
                format!("copying {} to {}", entry.path().display(), dst.display())
            })?;
        }
    }
    Ok(())
}

fn read_template(path: &Path, vars: &[(&str, String)]) -> Result<String> {
    let mut text = std::fs::read_to_string(path)
        .with_context(|| format!("reading template {}", path.display()))?;
    for (k, v) in vars {
        text = text.replace(k, v);
    }
    // Verify no placeholder leaked through (catches typos in templates or
    // missing vars; cheap insurance).
    if TEMPLATE_VARS.iter().any(|v| text.contains(v)) {
        bail!(
            "template {} still contains unsubstituted ${{...}} placeholder",
            path.display()
        );
    }
    Ok(text)
}

fn merge_gitignore(dst: &Path, additions: &str) -> Result<()> {
    let existing = if dst.exists() {
        std::fs::read_to_string(dst).with_context(|| format!("reading {}", dst.display()))?
    } else {
        String::new()
    };
    let mut out = existing.clone();
    let existing_lines: std::collections::HashSet<&str> = existing.lines().collect();
    let mut appended_any = false;
    for line in additions.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        if !existing_lines.contains(trimmed) {
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(trimmed);
            out.push('\n');
            appended_any = true;
        }
    }
    if appended_any || !dst.exists() {
        std::fs::write(dst, out).with_context(|| format!("writing {}", dst.display()))?;
    }
    Ok(())
}

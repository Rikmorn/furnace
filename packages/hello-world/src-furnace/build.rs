//! Bundles staged web assets into payload.bin at build time.
//!
//! The CLI populates `<OUT_DIR>/web/` with the bundled web app before invoking
//! `cargo build`. This script tars that directory into `<OUT_DIR>/payload.bin`,
//! which main.rs includes via `include_bytes!`.

use std::env;
use std::fs::File;
use std::path::PathBuf;

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let web_dir = out_dir.join("web");
    let payload_path = out_dir.join("payload.bin");

    // If FURNACE_WEB_DIR is set (CLI-driven build), copy its contents into OUT_DIR/web/ first.
    if let Ok(furnace_web) = env::var("FURNACE_WEB_DIR") {
        let src = PathBuf::from(furnace_web);
        copy_dir_recursive(&src, &web_dir).expect("copy FURNACE_WEB_DIR into OUT_DIR/web/");
        println!("cargo:rerun-if-env-changed=FURNACE_WEB_DIR");
    }

    if !web_dir.exists() {
        // Empty stub during plain `cargo check` outside the CLI pipeline.
        File::create(&payload_path).expect("create empty payload");
        println!("cargo:warning=furnace: OUT_DIR/web/ missing — emitting empty payload (run via `furnace build`)");
        return;
    }

    let file = File::create(&payload_path).expect("create payload.bin");
    let mut builder = tar::Builder::new(file);
    builder
        .append_dir_all(".", &web_dir)
        .expect("tar append_dir_all");
    builder.finish().expect("tar finish");

    println!("cargo:rerun-if-changed={}", web_dir.display());
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dst_entry = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_entry)?;
        } else {
            std::fs::copy(entry.path(), dst_entry)?;
        }
    }
    Ok(())
}

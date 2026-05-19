use furnace_runtime::{run, AppConfig};

fn main() -> anyhow::Result<()> {
    let url = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "file:///tmp/furnace-phase1.html".into());
    run(AppConfig::new(url))
}

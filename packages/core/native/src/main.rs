#[cfg(target_os = "linux")]
compile_error!(
    "Linux native target is not yet supported. See .docs/BACKLOG.md (Native runtime > Linux / cef support)."
);

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};
use wry::{WebView, WebViewBuilder};

const EXAMPLE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../hello-world");
const PORT_DEADLINE_SECS: u64 = 5;

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct App {
    url: String,
    window: Option<Window>,
    _webview: Option<WebView>,
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("furnace")
            .with_inner_size(LogicalSize::new(1280.0, 720.0));
        let window = event_loop
            .create_window(attrs)
            .expect("failed to create window");
        let webview = WebViewBuilder::new()
            .with_url(&self.url)
            .build(&window)
            .expect("failed to create webview");
        self.window = Some(window);
        self._webview = Some(webview);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if matches!(event, WindowEvent::CloseRequested) {
            event_loop.exit();
        }
    }
}

fn spawn_bun_dev() -> Child {
    // Note: no `--hot`. Hot reload + `port: 0` could pick a different port on each
    // re-execution, leaving the webview pointing at a dead address. The browser
    // path uses `--hot` directly; the native window simply restarts when needed.
    Command::new("bun")
        .current_dir(EXAMPLE_DIR)
        .args(["serve.ts"])
        .stdout(Stdio::piped())
        .spawn()
        .expect("failed to spawn `bun serve.ts`. Is bun installed and on PATH?")
}

fn read_port(child: &mut Child) -> Option<u16> {
    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + Duration::from_secs(PORT_DEADLINE_SECS);
    while Instant::now() < deadline {
        let remaining = deadline - Instant::now();
        match rx.recv_timeout(remaining) {
            Ok(line) => {
                if let Some(rest) = line.strip_prefix("PORT=") {
                    if let Ok(p) = rest.trim().parse::<u16>() {
                        return Some(p);
                    }
                }
            }
            Err(_) => return None,
        }
    }
    None
}

fn main() {
    let mut child = spawn_bun_dev();
    let port = match read_port(&mut child) {
        Some(p) => p,
        None => {
            eprintln!(
                "Bun dev server failed to print PORT=<n> within {PORT_DEADLINE_SECS}s. Check `bun run --cwd packages/core dev` works standalone."
            );
            let _ = child.kill();
            let _ = child.wait();
            std::process::exit(1);
        }
    };
    println!("furnace-window: connected to bun on port {port}");

    let url = format!("http://127.0.0.1:{port}");
    let _guard = ChildGuard(child);

    let event_loop = EventLoop::new().expect("failed to create event loop");
    let mut app = App {
        url,
        window: None,
        _webview: None,
    };
    event_loop.run_app(&mut app).expect("event loop failure");
}

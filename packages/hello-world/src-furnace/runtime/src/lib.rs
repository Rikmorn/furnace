//! furnace-runtime — the native shell that consumers vendor into their apps.
//!
//! Phase 1 surface: open a wry window pointing at a URL.
//! Phase 2 addition: optional assets_dir — when set, the runtime registers a
//! `furnace://` custom protocol that serves bundled assets from disk. Loading
//! via file:// is blocked from fetching sibling files in WKWebView; custom
//! protocols are the Tauri-style fix and align with the Runtime Contract's
//! asset-access category.

use anyhow::{Context, Result};
use std::path::PathBuf;
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};
use wry::{WebView, WebViewBuilder};

pub struct AppConfig {
    pub title: String,
    pub width: f64,
    pub height: f64,
    /// If `assets_dir` is None, this URL is loaded directly (e.g., for examples).
    /// If `assets_dir` is Some, this is ignored — the runtime loads
    /// `furnace://localhost/index.html`.
    pub url: String,
    /// When set, the runtime registers a `furnace://` custom protocol that
    /// serves files from this directory. Use this for bundled-asset apps where
    /// file:// would be blocked by WKWebView's sibling-fetch restrictions.
    pub assets_dir: Option<PathBuf>,
}

impl AppConfig {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            title: "furnace".into(),
            width: 1280.0,
            height: 720.0,
            url: url.into(),
            assets_dir: None,
        }
    }
}

struct AppState {
    config: AppConfig,
    window: Option<Window>,
    _webview: Option<WebView>,
}

impl ApplicationHandler for AppState {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title(&self.config.title)
            .with_inner_size(LogicalSize::new(self.config.width, self.config.height));
        let window = event_loop
            .create_window(attrs)
            .expect("failed to create window");

        let mut builder = WebViewBuilder::new().with_devtools(true);

        if let Some(assets_dir) = self.config.assets_dir.clone() {
            builder = builder
                .with_custom_protocol("furnace".into(), move |_webview_id, request| {
                    serve_asset(&assets_dir, request)
                })
                .with_url("furnace://localhost/index.html");
        } else {
            builder = builder.with_url(&self.config.url);
        }

        let webview = builder.build(&window).expect("failed to create webview");
        self.window = Some(window);
        self._webview = Some(webview);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if matches!(event, WindowEvent::CloseRequested) {
            event_loop.exit();
        }
    }
}

fn serve_asset(
    assets_dir: &std::path::Path,
    request: wry::http::Request<Vec<u8>>,
) -> wry::http::Response<std::borrow::Cow<'static, [u8]>> {
    use std::borrow::Cow;
    use wry::http::{Response, StatusCode};

    // URL shape: furnace://localhost/path/to/file
    let path = request.uri().path().trim_start_matches('/');
    let file_path = if path.is_empty() {
        assets_dir.join("index.html")
    } else {
        assets_dir.join(path)
    };
    match std::fs::read(&file_path) {
        Ok(bytes) => {
            let mime = mime_for(&file_path);
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime)
                .body(Cow::Owned(bytes))
                .unwrap()
        }
        Err(_) => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Borrowed(&b"not found"[..]))
            .unwrap(),
    }
}

fn mime_for(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("map") => "application/json; charset=utf-8",
        Some("wgsl") => "text/plain; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        _ => "application/octet-stream",
    }
}

pub fn run(config: AppConfig) -> Result<()> {
    let event_loop = EventLoop::new().context("failed to create event loop")?;
    let mut state = AppState {
        config,
        window: None,
        _webview: None,
    };
    event_loop
        .run_app(&mut state)
        .context("event loop failure")?;
    Ok(())
}

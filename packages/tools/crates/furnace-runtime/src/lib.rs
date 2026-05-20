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
    window::{Fullscreen, Window, WindowId},
};
use wry::{
    dpi::{LogicalPosition, PhysicalSize, Position, Size},
    Rect, WebView, WebViewBuilder,
};

const ERROR_CAPTURE_SCRIPT: &str = r#"
(function() {
  function showError(label, detail) {
    try {
      if (document.body) {
        document.body.style.color = '#f88';
        document.body.style.background = '#0d0d12';
        document.body.style.fontFamily = 'ui-monospace, monospace';
        document.body.style.padding = '20px';
        document.body.style.whiteSpace = 'pre-wrap';
        document.body.innerText = '[furnace JS error] ' + label + '\n' + detail;
      }
    } catch (_) {}
    console.error('[furnace JS error]', label, detail);
  }
  window.addEventListener('error', function(e) {
    var src = e.filename || '(unknown source)';
    showError('uncaught error: ' + e.message, src + ':' + e.lineno + ':' + e.colno);
  });
  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason && (e.reason.stack || e.reason.message || String(e.reason));
    showError('unhandled promise rejection', reason || String(e.reason));
  });
})();
"#;

pub struct AppConfig {
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub fullscreen: bool,
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
            fullscreen: false,
            url: url.into(),
            assets_dir: None,
        }
    }
}

struct AppState {
    config: AppConfig,
    window: Option<Window>,
    webview: Option<WebView>,
}

impl ApplicationHandler for AppState {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let mut attrs = Window::default_attributes()
            .with_title(&self.config.title)
            .with_inner_size(LogicalSize::new(self.config.width, self.config.height));
        if self.config.fullscreen {
            attrs = attrs.with_fullscreen(Some(Fullscreen::Borderless(None)));
        }
        let window = event_loop
            .create_window(attrs)
            .expect("failed to create window");

        let mut builder = WebViewBuilder::new()
            .with_devtools(true)
            .with_initialization_script(ERROR_CAPTURE_SCRIPT);

        if let Some(assets_dir) = self.config.assets_dir.clone() {
            builder = builder
                .with_custom_protocol("furnace".into(), move |_webview_id, request| {
                    serve_asset(&assets_dir, request)
                })
                .with_url("furnace://localhost/index.html");
        } else {
            builder = builder.with_url(&self.config.url);
        }

        // `build_as_child` adds the WKWebView as a subview of winit's content
        // view instead of replacing it via setContentView. Critical on macOS:
        // winit's WindowDelegate::view() unsafely casts whatever content view
        // is set back to WinitView, so wry's setContentView swap (the default
        // `build()` path) leaves the delegate holding a wrong-class view that
        // aborts on resign-key. Pattern lifted from Shallot's window backend.
        let size = window.inner_size();
        let webview = builder
            .with_bounds(Rect {
                position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                size: Size::Physical(PhysicalSize::new(size.width.max(1), size.height.max(1))),
            })
            .build_as_child(&window)
            .expect("failed to create webview");

        self.window = Some(window);
        self.webview = Some(webview);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::Resized(size) => {
                if let Some(webview) = &self.webview {
                    let _ = webview.set_bounds(Rect {
                        position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
                        size: Size::Physical(PhysicalSize::new(size.width, size.height)),
                    });
                }
            }
            WindowEvent::CloseRequested => event_loop.exit(),
            _ => {}
        }
    }
}

fn serve_asset(
    assets_dir: &std::path::Path,
    request: wry::http::Request<Vec<u8>>,
) -> wry::http::Response<std::borrow::Cow<'static, [u8]>> {
    use std::borrow::Cow;
    use wry::http::{Response, StatusCode};

    let uri = request.uri();
    // URL shape: furnace://localhost/path/to/file
    let path = uri.path().trim_start_matches('/');
    let file_path = if path.is_empty() {
        assets_dir.join("index.html")
    } else {
        assets_dir.join(path)
    };
    let verbose = std::env::var("FURNACE_VERBOSE").is_ok();
    if verbose {
        eprintln!(
            "[furnace] protocol request: uri={} -> file={}",
            uri,
            file_path.display()
        );
    }
    match std::fs::read(&file_path) {
        Ok(bytes) => {
            let mime = mime_for(&file_path);
            if verbose {
                eprintln!("[furnace]   OK: {} bytes, mime={}", bytes.len(), mime);
            }
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime)
                .header("Access-Control-Allow-Origin", "*")
                .body(Cow::Owned(bytes))
                .unwrap()
        }
        Err(e) => {
            if verbose {
                eprintln!("[furnace]   NOT FOUND: {}", e);
            }
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Cow::Borrowed(&b"not found"[..]))
                .unwrap()
        }
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
    let mut builder = EventLoop::builder();
    // Force `Regular` activation policy on macOS. Without it, a binary launched
    // outside an `.app` bundle (e.g. directly via `furnace dev`) is treated as
    // an agent process by AppKit; the resign-key delegation then hits an
    // uninitialized stub view inside winit and aborts. A bundled `.app` (the
    // prod path) sets this via Info.plist; calling it here is a no-op for the
    // bundled case and the fix for the raw-binary case.
    #[cfg(target_os = "macos")]
    {
        use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
        builder.with_activation_policy(ActivationPolicy::Regular);
    }
    let event_loop = builder.build().context("failed to create event loop")?;
    let mut state = AppState {
        config,
        window: None,
        webview: None,
    };
    event_loop
        .run_app(&mut state)
        .context("event loop failure")?;
    Ok(())
}

//! furnace-runtime — the native shell that consumers vendor into their apps.
//!
//! Phase 1 surface: open a wry window pointing at a URL. Subsequent phases
//! add the Runtime Contract methods (filesystem, IPC, HMR channel).

use anyhow::{Context, Result};
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
    pub url: String,
}

impl AppConfig {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            title: "furnace".into(),
            width: 1280.0,
            height: 720.0,
            url: url.into(),
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
        let webview = WebViewBuilder::new()
            .with_url(&self.config.url)
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

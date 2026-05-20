# iOS / Android native implementation

Spec lists iOS and Android as long-term targets but explicitly gates them on WebGPU-in-WebView maturity. iOS Safari WebGPU support is partial and behind a feature flag in current shipping releases; Android WebView (Chromium-based) is further along but still needs validation. Each platform also needs its own runtime backend (UIView/UIViewController orchestration on iOS; native View + Activity lifecycle on Android), which is more invasive than the cross-platform-wry pattern macOS/Windows share.

**Trigger to revisit:** WebGPU-in-WebView ships GA on at least one of the two platforms, OR a consumer with mobile reach as a hard requirement.

**Reference:** Caniuse WebGPU status tracker; Section on platform targets in the native-shell distribution design spec.

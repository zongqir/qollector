#[cfg(target_os = "linux")]
#[path = "native_linux.rs"]
mod native_linux;
#[cfg(target_os = "macos")]
#[path = "native_macos.rs"]
mod native_macos;
#[cfg(target_os = "windows")]
#[path = "native_windows.rs"]
mod native_windows;

use super::{provider::OcrProvider, OcrError, OcrResult};
use async_trait::async_trait;

pub struct NativeOcr {
    #[cfg(target_os = "windows")]
    inner: native_windows::WindowsNativeOcr,
    #[cfg(target_os = "macos")]
    inner: native_macos::MacNativeOcr,
    #[cfg(target_os = "linux")]
    inner: native_linux::LinuxNativeOcr,
}

impl NativeOcr {
    pub fn new() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            inner: native_windows::WindowsNativeOcr::new(),
            #[cfg(target_os = "macos")]
            inner: native_macos::MacNativeOcr::new(),
            #[cfg(target_os = "linux")]
            inner: native_linux::LinuxNativeOcr::new(),
        }
    }
}

#[async_trait]
impl OcrProvider for NativeOcr {
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        self.inner.recognize(image_path).await
    }

    async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError> {
        self.inner.recognize_bytes(image_data).await
    }

    fn provider_name(&self) -> &str {
        self.inner.provider_name()
    }

    async fn is_available(&self) -> bool {
        self.inner.is_available().await
    }
}

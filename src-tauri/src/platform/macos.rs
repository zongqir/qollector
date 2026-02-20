use super::clipboard_trait::{ClipboardCallback, ClipboardError, PlatformClipboard};
use crate::core::models::{ClipboardContent, WindowMetadata};
use async_trait::async_trait;
use cocoa::appkit::{NSFilenamesPboardType, NSPasteboard};
use cocoa::base::{id, nil, NO};
use cocoa::foundation::{NSArray, NSAutoreleasePool, NSString, NSURL};
use std::borrow::Cow;
use std::ffi::CStr;
use std::io::Cursor;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const CLIPBOARD_POLL_INTERVAL_MS: u64 = 120;
const ERROR_LOG_INTERVAL_SECS: u64 = 5;

pub struct MacosClipboard {
    listener_started: Arc<AtomicBool>,
    suppressed_fingerprint: Arc<Mutex<Option<String>>>,
}

impl MacosClipboard {
    pub fn new() -> Result<Self, ClipboardError> {
        Ok(Self {
            listener_started: Arc::new(AtomicBool::new(false)),
            suppressed_fingerprint: Arc::new(Mutex::new(None)),
        })
    }

    fn fingerprint(content: &ClipboardContent) -> String {
        match content {
            ClipboardContent::Text { plain, .. } => {
                format!("text:{}", blake3::hash(plain.as_bytes()).to_hex())
            }
            ClipboardContent::Image(data) => {
                format!("image:{}", blake3::hash(data).to_hex())
            }
            ClipboardContent::File(paths) => {
                format!("file:{}", blake3::hash(paths.as_bytes()).to_hex())
            }
        }
    }

    fn get_content_sync() -> Result<ClipboardContent, ClipboardError> {
        if let Ok(file_paths) = Self::get_native_file_paths() {
            if !file_paths.is_empty() {
                return Ok(ClipboardContent::File(file_paths.join("\n")));
            }
        }

        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| ClipboardError::AccessError(format!("Failed to open clipboard: {}", e)))?;

        if let Ok(text) = clipboard.get_text() {
            return Ok(ClipboardContent::Text {
                plain: text,
                raw_formats: None,
            });
        }

        if let Ok(image) = clipboard.get_image() {
            return Ok(ClipboardContent::Image(Self::image_to_png(image)?));
        }

        Err(ClipboardError::UnsupportedType)
    }

    fn get_native_file_paths() -> Result<Vec<String>, ClipboardError> {
        unsafe {
            let autorelease_pool = NSAutoreleasePool::new(nil);
            let pasteboard = NSPasteboard::generalPasteboard(nil);
            if pasteboard == nil {
                autorelease_pool.drain();
                return Err(ClipboardError::AccessError(
                    "Failed to access general pasteboard".to_string(),
                ));
            }

            let property_list = pasteboard.propertyListForType(NSFilenamesPboardType);
            if property_list == nil {
                autorelease_pool.drain();
                return Ok(Vec::new());
            }

            let count = property_list.count();
            let mut paths = Vec::with_capacity(count as usize);
            for index in 0..count {
                let ns_path: id = property_list.objectAtIndex(index);
                if let Some(path) = Self::nsstring_to_string(ns_path) {
                    let trimmed = path.trim();
                    if !trimmed.is_empty() {
                        paths.push(trimmed.to_string());
                    }
                }
            }

            autorelease_pool.drain();
            Ok(paths)
        }
    }

    fn set_native_file_paths(paths_payload: &str) -> Result<(), ClipboardError> {
        let paths: Vec<&str> = paths_payload
            .lines()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect();

        if paths.is_empty() {
            return Err(ClipboardError::UnsupportedType);
        }

        unsafe {
            let autorelease_pool = NSAutoreleasePool::new(nil);
            let pasteboard = NSPasteboard::generalPasteboard(nil);
            if pasteboard == nil {
                autorelease_pool.drain();
                return Err(ClipboardError::AccessError(
                    "Failed to access general pasteboard".to_string(),
                ));
            }

            let mut file_urls: Vec<id> = Vec::with_capacity(paths.len());
            for path in &paths {
                if !Path::new(path).exists() {
                    continue;
                }

                let ns_path = NSString::alloc(nil).init_str(path);
                let url = NSURL::fileURLWithPath_(nil, ns_path);
                if url != nil {
                    file_urls.push(url);
                }
            }

            if file_urls.is_empty() {
                autorelease_pool.drain();
                return Err(ClipboardError::UnsupportedType);
            }

            pasteboard.clearContents();
            let urls_array = NSArray::arrayWithObjects(nil, &file_urls);
            let write_result = pasteboard.writeObjects(urls_array);
            autorelease_pool.drain();

            if write_result == NO {
                return Err(ClipboardError::AccessError(
                    "Failed to write file URLs to pasteboard".to_string(),
                ));
            }

            Ok(())
        }
    }

    fn nsstring_to_string(value: id) -> Option<String> {
        if value == nil {
            return None;
        }

        unsafe {
            let utf8_ptr = value.UTF8String();
            if utf8_ptr.is_null() {
                return None;
            }

            Some(CStr::from_ptr(utf8_ptr).to_string_lossy().into_owned())
        }
    }

    fn image_to_png(image: arboard::ImageData<'_>) -> Result<Vec<u8>, ClipboardError> {
        let width = u32::try_from(image.width).map_err(|_| {
            ClipboardError::PlatformError("Clipboard image width overflow".to_string())
        })?;
        let height = u32::try_from(image.height).map_err(|_| {
            ClipboardError::PlatformError("Clipboard image height overflow".to_string())
        })?;
        let rgba = image::RgbaImage::from_raw(width, height, image.bytes.into_owned()).ok_or_else(
            || ClipboardError::PlatformError("Clipboard image buffer is invalid".to_string()),
        )?;

        let mut cursor = Cursor::new(Vec::<u8>::new());
        image::DynamicImage::ImageRgba8(rgba)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| {
                ClipboardError::PlatformError(format!("Failed to encode clipboard image: {}", e))
            })?;
        Ok(cursor.into_inner())
    }

    fn set_content_sync(content: ClipboardContent) -> Result<(), ClipboardError> {
        match content {
            ClipboardContent::Text { plain, .. } => {
                let mut clipboard = arboard::Clipboard::new().map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to open clipboard: {}", e))
                })?;
                clipboard.set_text(plain).map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to set clipboard text: {}", e))
                })?;
            }
            ClipboardContent::Image(data) => {
                let mut clipboard = arboard::Clipboard::new().map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to open clipboard: {}", e))
                })?;
                let decoded = image::load_from_memory(&data).map_err(|e| {
                    ClipboardError::PlatformError(format!("Failed to decode image bytes: {}", e))
                })?;
                let rgba = decoded.to_rgba8();
                let (width, height) = rgba.dimensions();
                let image = arboard::ImageData {
                    width: width as usize,
                    height: height as usize,
                    bytes: Cow::Owned(rgba.into_raw()),
                };
                clipboard.set_image(image).map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to set clipboard image: {}", e))
                })?;
            }
            ClipboardContent::File(paths) => {
                if Self::set_native_file_paths(&paths).is_err() {
                    let mut clipboard = arboard::Clipboard::new().map_err(|e| {
                        ClipboardError::AccessError(format!("Failed to open clipboard: {}", e))
                    })?;
                    clipboard.set_text(paths).map_err(|e| {
                        ClipboardError::AccessError(format!(
                            "Failed to set clipboard file paths: {}",
                            e
                        ))
                    })?;
                }
            }
        }

        Ok(())
    }

    fn get_active_window_info_static() -> WindowMetadata {
        WindowMetadata {
            source_app: "Unknown".to_string(),
            window_title: String::new(),
            source_url: None,
            is_self: false,
        }
    }
}

#[async_trait]
impl PlatformClipboard for MacosClipboard {
    fn register_listener(&self, callback: ClipboardCallback) -> Result<(), ClipboardError> {
        if self.listener_started.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let suppressed_fingerprint = self.suppressed_fingerprint.clone();

        std::thread::spawn(move || {
            let mut last_fingerprint: Option<String> = None;
            let mut last_error_log = Instant::now() - Duration::from_secs(ERROR_LOG_INTERVAL_SECS);

            loop {
                std::thread::sleep(Duration::from_millis(CLIPBOARD_POLL_INTERVAL_MS));

                match Self::get_content_sync() {
                    Ok(content) => {
                        let fingerprint = Self::fingerprint(&content);
                        if last_fingerprint.as_deref() == Some(fingerprint.as_str()) {
                            continue;
                        }
                        last_fingerprint = Some(fingerprint.clone());

                        let should_skip = if let Ok(mut guard) = suppressed_fingerprint.lock() {
                            if guard.as_deref() == Some(fingerprint.as_str()) {
                                *guard = None;
                                true
                            } else {
                                false
                            }
                        } else {
                            false
                        };

                        if should_skip {
                            continue;
                        }

                        let metadata = Self::get_active_window_info_static();
                        let fut = callback(content, metadata);
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = fut.await {
                                eprintln!("[Clipboard:macOS] callback failed: {}", error);
                            }
                        });
                    }
                    Err(ClipboardError::UnsupportedType) => {}
                    Err(error) => {
                        if last_error_log.elapsed() >= Duration::from_secs(ERROR_LOG_INTERVAL_SECS)
                        {
                            eprintln!("[Clipboard:macOS] poll failed: {}", error);
                            last_error_log = Instant::now();
                        }
                    }
                }
            }
        });

        Ok(())
    }

    async fn get_content(&self) -> Result<ClipboardContent, ClipboardError> {
        Self::get_content_sync()
    }

    async fn set_content(&self, content: ClipboardContent) -> Result<(), ClipboardError> {
        let fingerprint = Self::fingerprint(&content);
        Self::set_content_sync(content)?;

        if let Ok(mut guard) = self.suppressed_fingerprint.lock() {
            *guard = Some(fingerprint);
        }

        Ok(())
    }

    fn get_active_window_info(&self) -> Result<WindowMetadata, ClipboardError> {
        Ok(Self::get_active_window_info_static())
    }

    async fn clear(&self) -> Result<(), ClipboardError> {
        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| ClipboardError::AccessError(format!("Failed to open clipboard: {}", e)))?;
        clipboard
            .set_text(String::new())
            .map_err(|e| ClipboardError::AccessError(format!("Failed to clear clipboard: {}", e)))
    }
}

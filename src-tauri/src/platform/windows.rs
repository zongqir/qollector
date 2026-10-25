#[cfg(target_os = "windows")]
pub mod windows {
    use crate::core::models::{ClipboardContent, WindowMetadata};
    use crate::platform::clipboard_trait::*;
    use async_trait::async_trait;
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::sync::LazyLock;
    use windows::core::w;
    use windows::Win32::Foundation::*;
    use windows::Win32::System::DataExchange::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    /// 友好应用名缓存：key = exe 路径, value = 友好名称
    static APP_NAME_CACHE: LazyLock<Mutex<HashMap<String, String>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    const CLIPBOARD_POLL_INTERVAL_MS: u64 = 30;
    const CLIPBOARD_READ_RETRIES: usize = 6;
    const CLIPBOARD_READ_RETRY_DELAY_MS: u64 = 25;
    const INTERNAL_SEQUENCE_CAPTURE_RETRIES: usize = 20;
    const INTERNAL_SEQUENCE_CAPTURE_DELAY_MS: u64 = 5;

    // Wrapper to make HWND Send
    #[derive(Clone, Copy)]
    struct SendHwnd(HWND);
    unsafe impl Send for SendHwnd {}
    unsafe impl Sync for SendHwnd {}

    pub struct WindowsClipboard {
        hwnd: SendHwnd,
        last_sequence: Arc<Mutex<u32>>,
        skip_sequence: Arc<AtomicU32>,
    }

    unsafe impl Send for WindowsClipboard {}
    unsafe impl Sync for WindowsClipboard {}

    impl WindowsClipboard {
        pub fn new() -> Result<Self, ClipboardError> {
            let (tx, rx) = mpsc::channel();

            // Create window in a dedicated thread
            std::thread::spawn(move || {
                unsafe {
                    let hwnd = CreateWindowExW(
                        WINDOW_EX_STYLE(0),
                        w!("STATIC"),
                        w!("Qollect Clipboard Listener"),
                        WS_OVERLAPPEDWINDOW,
                        0,
                        0,
                        0,
                        0,
                        None,
                        None,
                        None,
                        None,
                    );

                    if let Ok(hwnd) = hwnd {
                        if !hwnd.is_invalid() {
                            // Send as usize to make it Send-safe
                            let _ = tx.send(Ok(hwnd.0 as usize));

                            // Keep thread alive with message loop
                            let mut msg = MSG::default();
                            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                                let _ = TranslateMessage(&msg);
                                DispatchMessageW(&msg);
                            }
                        } else {
                            let _ = tx.send(Err("Invalid window handle".to_string()));
                        }
                    } else {
                        let _ = tx.send(Err("Failed to create window".to_string()));
                    }
                }
            });

            let hwnd_ptr = rx
                .recv()
                .map_err(|e| {
                    ClipboardError::PlatformError(format!("Failed to receive window handle: {}", e))
                })?
                .map_err(|e| ClipboardError::PlatformError(e))?;

            let hwnd = HWND(hwnd_ptr as *mut _);

            Ok(Self {
                hwnd: SendHwnd(hwnd),
                last_sequence: Arc::new(Mutex::new(0)),
                skip_sequence: Arc::new(AtomicU32::new(0)),
            })
        }

        fn get_clipboard_content_with_retry(
            max_retries: usize,
            retry_delay_ms: u64,
        ) -> Result<ClipboardContent, ClipboardError> {
            let retries = max_retries.max(1);
            let mut last_error: Option<ClipboardError> = None;

            for attempt in 0..retries {
                match Self::get_clipboard_content_sync() {
                    Ok(content) => return Ok(content),
                    Err(error) => {
                        last_error = Some(error);
                        if attempt + 1 < retries {
                            std::thread::sleep(std::time::Duration::from_millis(retry_delay_ms));
                        }
                    }
                }
            }

            Err(last_error.unwrap_or_else(|| {
                ClipboardError::AccessError("Failed to read clipboard content".to_string())
            }))
        }

        fn mark_internal_sequence_for_skip(&self, sequence_before: u32) {
            let mut observed_sequence = 0u32;
            for _ in 0..INTERNAL_SEQUENCE_CAPTURE_RETRIES {
                let current = unsafe { GetClipboardSequenceNumber() };
                if current != 0 && current != sequence_before {
                    observed_sequence = current;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(
                    INTERNAL_SEQUENCE_CAPTURE_DELAY_MS,
                ));
            }

            self.skip_sequence
                .store(observed_sequence, Ordering::SeqCst);
            if observed_sequence != 0 {
                println!(
                    "Marked internal clipboard sequence for skip: {}",
                    observed_sequence
                );
            }
        }
    }

    #[async_trait]
    impl PlatformClipboard for WindowsClipboard {
        fn register_listener(&self, callback: ClipboardCallback) -> Result<(), ClipboardError> {
            unsafe {
                AddClipboardFormatListener(self.hwnd.0).map_err(|e| {
                    ClipboardError::PlatformError(format!(
                        "Failed to register clipboard listener: {}",
                        e
                    ))
                })?;
            }

            println!("[Clipboard] listener registered");

            let last_sequence = self.last_sequence.clone();
            let skip_sequence = self.skip_sequence.clone();

            // Create a tokio runtime for callbacks
            let rt = tokio::runtime::Runtime::new().unwrap();

            // Poll clipboard changes
            std::thread::spawn(move || {
                println!("Clipboard polling started...");
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(
                        CLIPBOARD_POLL_INTERVAL_MS,
                    ));

                    unsafe {
                        let sequence = GetClipboardSequenceNumber();
                        let mut last = last_sequence.lock();

                        if *last == 0 {
                            *last = sequence;
                            continue;
                        }

                        if sequence == *last {
                            continue;
                        }

                        let pending_skip_sequence = skip_sequence.load(Ordering::SeqCst);
                        if pending_skip_sequence == u32::MAX
                            || (pending_skip_sequence != 0 && sequence == pending_skip_sequence)
                        {
                            *last = sequence;
                            skip_sequence.store(0, Ordering::SeqCst);
                            println!(
                                "Skipping self-triggered clipboard change (sequence: {})",
                                sequence
                            );
                            continue;
                        }
                        drop(last);

                        println!("Clipboard change detected (sequence: {})", sequence);

                        // Capture window info immediately in polling thread
                        let metadata = Self::get_active_window_info_static();

                        match Self::get_clipboard_content_with_retry(
                            CLIPBOARD_READ_RETRIES,
                            CLIPBOARD_READ_RETRY_DELAY_MS,
                        ) {
                            Ok(content) => {
                                let mut last = last_sequence.lock();
                                *last = sequence;
                                drop(last);

                                // Spawn async callback so polling thread is not blocked
                                let fut = callback(content, metadata);
                                rt.spawn(async move {
                                    if let Err(e) = fut.await {
                                        eprintln!("Callback error: {:?}", e);
                                    }
                                });
                            }
                            Err(ClipboardError::UnsupportedType) => {
                                let mut last = last_sequence.lock();
                                *last = sequence;
                                println!(
                                    "Ignoring unsupported clipboard content (sequence: {})",
                                    sequence
                                );
                            }
                            Err(error) => {
                                let mut last = last_sequence.lock();
                                *last = sequence;
                                eprintln!(
                                    "Failed to get clipboard content (sequence={}): {}",
                                    sequence, error
                                );
                            }
                        }
                    }
                }
            });

            Ok(())
        }

        async fn get_content(&self) -> Result<ClipboardContent, ClipboardError> {
            Self::get_clipboard_content_sync()
        }

        async fn set_content(&self, content: ClipboardContent) -> Result<(), ClipboardError> {
            let sequence_before = unsafe { GetClipboardSequenceNumber() };
            // Mark "pending internal write" first, then narrow down to exact sequence.
            self.skip_sequence.store(u32::MAX, Ordering::SeqCst);

            // Use block_in_place to run synchronously, avoid cross-thread clipboard issues
            let write_result = tokio::task::block_in_place(|| {
                match content {
                    ClipboardContent::Text { plain, raw_formats } => {
                        if let Some(ref formats) = raw_formats {
                            if !formats.is_empty() {
                                println!("[Paste] Restoring {} rich format(s)", formats.len());
                                return Self::set_multi_format_text(&plain, formats);
                            }
                        }
                        println!("[Paste] Plain text only (no rich formats)");
                        // Fallback: plain text only via arboard
                        use arboard::Clipboard;
                        let mut clipboard = Clipboard::new()
                            .map_err(|e| ClipboardError::AccessError(e.to_string()))?;
                        clipboard
                            .set_text(plain)
                            .map_err(|e| ClipboardError::AccessError(e.to_string()))?;
                    }
                    ClipboardContent::Image(data) => {
                        use arboard::Clipboard;
                        let mut clipboard = Clipboard::new()
                            .map_err(|e| ClipboardError::AccessError(e.to_string()))?;
                        let img = image::load_from_memory(&data)
                            .map_err(|e| ClipboardError::PlatformError(e.to_string()))?;
                        clipboard
                            .set_image(arboard::ImageData {
                                width: img.width() as usize,
                                height: img.height() as usize,
                                bytes: img.to_rgba8().into_raw().into(),
                            })
                            .map_err(|e| ClipboardError::AccessError(e.to_string()))?;
                    }
                    ClipboardContent::File(paths_str) => {
                        let paths: Vec<String> = paths_str.lines().map(|s| s.to_string()).collect();
                        Self::set_file_paths(&paths)?;
                    }
                }
                Ok(())
            });

            if let Err(error) = write_result {
                self.skip_sequence.store(0, Ordering::SeqCst);
                return Err(error);
            }

            self.mark_internal_sequence_for_skip(sequence_before);
            Ok(())
        }

        fn get_active_window_info(&self) -> Result<WindowMetadata, ClipboardError> {
            Ok(Self::get_active_window_info_static())
        }

        async fn clear(&self) -> Result<(), ClipboardError> {
            unsafe {
                OpenClipboard(self.hwnd.0).map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to open clipboard: {}", e))
                })?;
                EmptyClipboard().map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to empty clipboard: {}", e))
                })?;
                CloseClipboard().map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to close clipboard: {}", e))
                })?;
            }
            Ok(())
        }
    }

    impl WindowsClipboard {
        fn get_clipboard_content_sync() -> Result<ClipboardContent, ClipboardError> {
            use arboard::Clipboard;

            // Try to get file paths first (CF_HDROP format)
            match Self::get_file_paths() {
                Ok(files) if !files.is_empty() => {
                    println!("Detected {} file(s) in clipboard", files.len());
                    return Ok(ClipboardContent::File(files.join("\n")));
                }
                Ok(_) => {
                    // Empty file list, continue to check other formats
                }
                Err(e) => {
                    // Not a file or error, continue to check other formats
                    println!("File detection: {:?}", e);
                }
            }

            let mut clipboard =
                Clipboard::new().map_err(|e| ClipboardError::AccessError(e.to_string()))?;

            if let Ok(text) = clipboard.get_text() {
                // If text is purely whitespace or empty, check if an image is present first
                // to prevent blank text payloads from overshadowing image clipboards.
                if text.trim().is_empty() {
                    if let Ok(img) = clipboard.get_image() {
                        if let Some(rgba) = image::RgbaImage::from_raw(
                            img.width as u32,
                            img.height as u32,
                            img.bytes.to_vec(),
                        ) {
                            let mut buffer = Vec::new();
                            use image::codecs::png::PngEncoder;
                            let encoder = PngEncoder::new(&mut buffer);
                            if rgba.write_with_encoder(encoder).is_ok() {
                                return Ok(ClipboardContent::Image(buffer));
                            }
                        }
                    }
                }

                // Drop arboard before opening clipboard again for rich formats
                drop(clipboard);
                // Try to read rich text formats (HTML, RTF) via Win32 API
                let raw_formats = Self::read_rich_formats();
                // Filter out trivial HTML that is just code-editor syntax highlighting
                let raw_formats = Self::filter_trivial_rich_formats(raw_formats, &text);
                return Ok(ClipboardContent::Text {
                    plain: text,
                    raw_formats: if raw_formats.is_empty() {
                        None
                    } else {
                        Some(raw_formats)
                    },
                });
            }

            if let Ok(img) = clipboard.get_image() {
                let rgba = image::RgbaImage::from_raw(
                    img.width as u32,
                    img.height as u32,
                    img.bytes.to_vec(),
                )
                .ok_or(ClipboardError::PlatformError(
                    "Invalid image data".to_string(),
                ))?;

                let mut buffer = Vec::new();
                use image::codecs::png::PngEncoder;
                let encoder = PngEncoder::new(&mut buffer);
                rgba.write_with_encoder(encoder)
                    .map_err(|e| ClipboardError::PlatformError(e.to_string()))?;

                return Ok(ClipboardContent::Image(buffer));
            }

            Err(ClipboardError::UnsupportedType)
        }

        /// Read rich text formats (HTML Format, Rich Text Format) from the clipboard.
        fn read_rich_formats() -> Vec<(String, Vec<u8>)> {
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;
            use windows::Win32::System::Memory::*;

            let format_names = ["HTML Format", "Rich Text Format"];
            let mut results = Vec::new();

            unsafe {
                if OpenClipboard(None).is_err() {
                    println!("[RichFormat] Failed to open clipboard");
                    return results;
                }

                for name in &format_names {
                    let wide: Vec<u16> = OsStr::new(name).encode_wide().chain(Some(0)).collect();
                    let fmt = RegisterClipboardFormatW(windows::core::PCWSTR(wide.as_ptr()));
                    if fmt == 0 {
                        continue;
                    }

                    if let Ok(handle) = GetClipboardData(fmt) {
                        if !handle.is_invalid() {
                            let hglobal = HGLOBAL(handle.0);
                            let ptr = GlobalLock(hglobal);
                            if !ptr.is_null() {
                                let size = GlobalSize(hglobal);
                                if size > 0 {
                                    let slice = std::slice::from_raw_parts(ptr as *const u8, size);
                                    println!("[RichFormat] Read '{}': {} bytes", name, size);
                                    results.push((name.to_string(), slice.to_vec()));
                                }
                                let _ = GlobalUnlock(hglobal);
                            }
                        }
                    }
                }

                let _ = CloseClipboard();
            }

            results
        }

        /// Keep rich formats only when they carry semantic information that plain text cannot represent.
        fn filter_trivial_rich_formats(
            formats: Vec<(String, Vec<u8>)>,
            plain_text: &str,
        ) -> Vec<(String, Vec<u8>)> {
            let html_data = formats
                .iter()
                .find(|(name, _)| name == "HTML Format")
                .map(|(_, data)| data.as_slice());
            let rtf_data = formats
                .iter()
                .find(|(name, _)| name == "Rich Text Format")
                .map(|(_, data)| data.as_slice());

            let has_semantic_delta = if let Some(html) = html_data {
                Self::is_semantic_html(html, plain_text)
            } else if let Some(rtf) = rtf_data {
                Self::is_semantic_rtf(rtf, plain_text)
            } else {
                false
            };

            if has_semantic_delta {
                return formats;
            }

            println!("[RichFormat] Rich formats have no semantic delta, removing HTML/RTF");
            formats
                .into_iter()
                .filter(|(name, _)| name != "HTML Format" && name != "Rich Text Format")
                .collect()
        }

        fn is_semantic_html(data: &[u8], plain_text: &str) -> bool {
            let html = match Self::decode_html_format_payload(data) {
                Some(v) => v,
                None => return true,
            };
            let lower = html.to_ascii_lowercase();

            if Self::has_meaningful_links(&lower, plain_text) {
                return true;
            }

            let semantic_markers = [
                "<table",
                "<img",
                "<ul",
                "<ol",
                "<li",
                "<blockquote",
                "<pre",
                "<code",
                "<h1",
                "<h2",
                "<h3",
                "<h4",
                "<h5",
                "<h6",
                "<iframe",
                "<video",
                "<audio",
                "<svg",
                "<math",
                "<figure",
                "<picture",
                "<hr",
                // Rich text formatting (Word, Google Docs, etc.)
                "font-family:",
                "font-size:",
                "font-weight:",
                "class=\"mso",
            ];
            if semantic_markers.iter().any(|m| lower.contains(m)) {
                return true;
            }

            let extracted_text = Self::extract_text_from_html(&html);
            let normalized_plain = Self::normalize_for_rich_compare(plain_text);
            let normalized_html = Self::normalize_for_rich_compare(&extracted_text);

            if normalized_plain.is_empty() || normalized_html.is_empty() {
                return true;
            }

            normalized_plain != normalized_html
        }

        fn decode_html_format_payload(data: &[u8]) -> Option<String> {
            let end = data.iter().position(|&b| b == 0).unwrap_or(data.len());
            let payload = std::str::from_utf8(&data[..end]).ok()?.to_string();
            let lower = payload.to_ascii_lowercase();

            if let (Some(start), Some(end)) = (
                Self::parse_cf_html_offset(&lower, "startfragment"),
                Self::parse_cf_html_offset(&lower, "endfragment"),
            ) {
                if let Some(fragment) = Self::slice_payload_by_offset(&payload, start, end) {
                    return Some(fragment);
                }
            }

            if let (Some(start), Some(end)) = (
                Self::parse_cf_html_offset(&lower, "starthtml"),
                Self::parse_cf_html_offset(&lower, "endhtml"),
            ) {
                if let Some(fragment) = Self::slice_payload_by_offset(&payload, start, end) {
                    return Some(fragment);
                }
            }

            if let Some(fragment_start) = lower.find("<!--startfragment-->") {
                let content_start = fragment_start + "<!--startfragment-->".len();
                let content_end = lower.find("<!--endfragment-->").unwrap_or(payload.len());
                if content_end > content_start {
                    return Some(payload[content_start..content_end].to_string());
                }
            }

            let html_start = lower
                .find("<html")
                .or_else(|| lower.find("<body"))
                .or_else(|| lower.find("<div"))
                .or_else(|| lower.find("<p"));

            if let Some(idx) = html_start {
                return Some(payload[idx..].to_string());
            }

            Some(payload)
        }

        fn parse_cf_html_offset(payload_lower: &str, key_lower: &str) -> Option<usize> {
            let marker = format!("{}:", key_lower);
            let pos = payload_lower.find(&marker)?;
            let rest = payload_lower[pos + marker.len()..].trim_start();
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() {
                return None;
            }
            digits.parse::<usize>().ok()
        }

        fn slice_payload_by_offset(payload: &str, start: usize, end: usize) -> Option<String> {
            if start >= end || end > payload.len() {
                return None;
            }
            if !payload.is_char_boundary(start) || !payload.is_char_boundary(end) {
                return None;
            }
            Some(payload[start..end].to_string())
        }

        fn has_meaningful_links(html_lower: &str, plain_text: &str) -> bool {
            let normalized_plain = Self::normalize_for_rich_compare(plain_text);
            let mut cursor = 0usize;

            while let Some(rel_start) = html_lower[cursor..].find("<a") {
                let start = cursor + rel_start;
                let Some(rel_tag_end) = html_lower[start..].find('>') else {
                    return true;
                };
                let open_end = start + rel_tag_end;
                let open_tag = &html_lower[start..=open_end];
                let content_start = open_end + 1;

                let Some(rel_close) = html_lower[content_start..].find("</a>") else {
                    return true;
                };
                let close_start = content_start + rel_close;
                let inner_html = &html_lower[content_start..close_start];

                if let Some(href) = Self::extract_href_from_anchor_tag(open_tag) {
                    let normalized_href = Self::normalize_for_rich_compare(&href);
                    if !normalized_href.is_empty() {
                        let visible_text = Self::extract_text_from_html(inner_html);
                        let normalized_visible = Self::normalize_for_rich_compare(&visible_text);

                        if normalized_visible.is_empty() {
                            return true;
                        }
                        if normalized_visible != normalized_href {
                            let plain_has_both = normalized_plain.contains(&normalized_visible)
                                && normalized_plain.contains(&normalized_href);
                            if !plain_has_both {
                                return true;
                            }
                        }
                        if !normalized_plain.contains(&normalized_visible) {
                            return true;
                        }
                    }
                }

                cursor = close_start + "</a>".len();
            }

            false
        }

        fn extract_href_from_anchor_tag(tag_lower: &str) -> Option<String> {
            let href_pos = tag_lower.find("href")?;
            let rest = &tag_lower[href_pos + 4..];
            let eq_pos = rest.find('=')?;
            let value = rest[eq_pos + 1..].trim_start();
            if value.is_empty() {
                return None;
            }

            if let Some(stripped) = value.strip_prefix('"') {
                let end = stripped.find('"')?;
                return Some(Self::decode_basic_html_entities(&stripped[..end]));
            }

            if let Some(stripped) = value.strip_prefix('\'') {
                let end = stripped.find('\'')?;
                return Some(Self::decode_basic_html_entities(&stripped[..end]));
            }

            let end = value
                .find(|ch: char| ch.is_whitespace() || ch == '>')
                .unwrap_or(value.len());
            Some(Self::decode_basic_html_entities(&value[..end]))
        }

        fn extract_text_from_html(html: &str) -> String {
            let mut normalized = html.replace("\r\n", "\n").replace('\r', "\n");
            normalized = normalized.to_ascii_lowercase();

            for marker in [
                "<br>",
                "<br/>",
                "<br />",
                "</p>",
                "</div>",
                "</li>",
                "</tr>",
                "</h1>",
                "</h2>",
                "</h3>",
                "</h4>",
                "</h5>",
                "</h6>",
                "</blockquote>",
                "</pre>",
            ] {
                normalized = normalized.replace(marker, "\n");
            }

            normalized = Self::strip_tag_block(normalized, "script");
            normalized = Self::strip_tag_block(normalized, "style");

            let mut plain = String::with_capacity(normalized.len());
            let mut in_tag = false;
            for ch in normalized.chars() {
                match ch {
                    '<' => in_tag = true,
                    '>' => in_tag = false,
                    _ if !in_tag => plain.push(ch),
                    _ => {}
                }
            }

            Self::decode_basic_html_entities(&plain)
        }

        fn strip_tag_block(mut input: String, tag: &str) -> String {
            let open = format!("<{}", tag);
            let close = format!("</{}>", tag);

            loop {
                let Some(start) = input.find(&open) else {
                    break;
                };
                let Some(relative_end) = input[start..].find(&close) else {
                    input.replace_range(start.., "");
                    break;
                };
                let end = start + relative_end + close.len();
                input.replace_range(start..end, "");
            }

            input
        }

        fn decode_basic_html_entities(input: &str) -> String {
            input
                .replace("&nbsp;", " ")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'")
        }

        fn normalize_for_rich_compare(input: &str) -> String {
            let mut output = String::with_capacity(input.len());
            let mut previous_was_space = false;

            for ch in input.replace("\r\n", "\n").replace('\r', "\n").chars() {
                let mapped = if ch.is_whitespace() {
                    ' '
                } else {
                    ch.to_ascii_lowercase()
                };

                if mapped == ' ' {
                    if !previous_was_space {
                        output.push(' ');
                    }
                    previous_was_space = true;
                } else {
                    output.push(mapped);
                    previous_was_space = false;
                }
            }

            output.trim().to_string()
        }

        fn is_semantic_rtf(data: &[u8], plain_text: &str) -> bool {
            let rtf = String::from_utf8_lossy(data).to_string();
            let lower = rtf.to_ascii_lowercase();

            // Semantic controls in RTF: link fields, images, objects, list metadata.
            let semantic_markers = [
                "\\field",
                "\\pict",
                "\\object",
                "\\listtable",
                "\\listoverride",
                "\\footnote",
                "\\annotation",
                "\\xe ",
                "\\tc ",
                // Rich text formatting (Word, etc.)
                "\\fonttbl",
                "\\colortbl",
            ];
            if semantic_markers.iter().any(|m| lower.contains(m)) {
                return true;
            }

            let extracted_text = Self::extract_text_from_rtf(&rtf);
            let normalized_plain = Self::normalize_for_rich_compare(plain_text);
            let normalized_rtf = Self::normalize_for_rich_compare(&extracted_text);

            if normalized_plain.is_empty() || normalized_rtf.is_empty() {
                return true;
            }

            normalized_plain != normalized_rtf
        }

        fn extract_text_from_rtf(rtf: &str) -> String {
            let bytes = rtf.as_bytes();
            let mut i = 0usize;
            let mut out = String::with_capacity(rtf.len());

            while i < bytes.len() {
                match bytes[i] {
                    b'{' | b'}' => {
                        i += 1;
                    }
                    b'\\' => {
                        i += 1;
                        if i >= bytes.len() {
                            break;
                        }

                        match bytes[i] {
                            b'\\' | b'{' | b'}' => {
                                out.push(bytes[i] as char);
                                i += 1;
                            }
                            b'\'' => {
                                if i + 2 < bytes.len() {
                                    if let (Some(h1), Some(h2)) = (
                                        Self::hex_value(bytes[i + 1]),
                                        Self::hex_value(bytes[i + 2]),
                                    ) {
                                        out.push((h1 * 16 + h2) as char);
                                        i += 3;
                                        continue;
                                    }
                                }
                                i += 1;
                            }
                            b if (b as char).is_ascii_alphabetic() => {
                                let word_start = i;
                                while i < bytes.len() && (bytes[i] as char).is_ascii_alphabetic() {
                                    i += 1;
                                }
                                let word = std::str::from_utf8(&bytes[word_start..i]).unwrap_or("");

                                // Optional numeric argument.
                                if i < bytes.len()
                                    && (bytes[i] == b'-' || (bytes[i] as char).is_ascii_digit())
                                {
                                    i += 1;
                                    while i < bytes.len() && (bytes[i] as char).is_ascii_digit() {
                                        i += 1;
                                    }
                                }
                                if i < bytes.len() && bytes[i] == b' ' {
                                    i += 1;
                                }

                                if word == "par" || word == "line" {
                                    out.push('\n');
                                } else if word == "tab" {
                                    out.push('\t');
                                }
                            }
                            _ => {
                                i += 1;
                            }
                        }
                    }
                    b'\r' | b'\n' => {
                        out.push('\n');
                        i += 1;
                    }
                    b => {
                        out.push(b as char);
                        i += 1;
                    }
                }
            }

            out
        }

        fn hex_value(b: u8) -> Option<u8> {
            match b {
                b'0'..=b'9' => Some(b - b'0'),
                b'a'..=b'f' => Some(10 + (b - b'a')),
                b'A'..=b'F' => Some(10 + (b - b'A')),
                _ => None,
            }
        }

        /// Write plain text + rich formats to the clipboard via Win32 API.
        fn set_multi_format_text(
            plain: &str,
            formats: &[(String, Vec<u8>)],
        ) -> Result<(), ClipboardError> {
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;
            use windows::Win32::System::Memory::*;

            unsafe {
                OpenClipboard(None).map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to open clipboard: {}", e))
                })?;
                let _ = EmptyClipboard();

                // 1) Set CF_UNICODETEXT (13)
                {
                    let wide: Vec<u16> = plain.encode_utf16().chain(Some(0)).collect();
                    let byte_len = wide.len() * 2;
                    if let Ok(hmem) = GlobalAlloc(GMEM_MOVEABLE, byte_len) {
                        let ptr = GlobalLock(hmem);
                        if !ptr.is_null() {
                            std::ptr::copy_nonoverlapping(
                                wide.as_ptr() as *const u8,
                                ptr as *mut u8,
                                byte_len,
                            );
                            let _ = GlobalUnlock(hmem);
                            let handle = HANDLE(hmem.0 as isize as *mut _);
                            let _ = SetClipboardData(13, handle); // CF_UNICODETEXT = 13
                        }
                    }
                }

                // 2) Set each rich format
                for (name, data) in formats {
                    let wide_name: Vec<u16> =
                        OsStr::new(name).encode_wide().chain(Some(0)).collect();
                    let fmt = RegisterClipboardFormatW(windows::core::PCWSTR(wide_name.as_ptr()));
                    if fmt == 0 {
                        continue;
                    }

                    if let Ok(hmem) = GlobalAlloc(GMEM_MOVEABLE, data.len()) {
                        let ptr = GlobalLock(hmem);
                        if !ptr.is_null() {
                            std::ptr::copy_nonoverlapping(
                                data.as_ptr(),
                                ptr as *mut u8,
                                data.len(),
                            );
                            let _ = GlobalUnlock(hmem);
                            let handle = HANDLE(hmem.0 as isize as *mut _);
                            let _ = SetClipboardData(fmt, handle);
                        }
                    }
                }

                let _ = CloseClipboard();
            }

            Ok(())
        }

        fn get_file_paths() -> Result<Vec<String>, ClipboardError> {
            use std::ffi::OsString;
            use std::os::windows::ffi::OsStringExt;
            use windows::Win32::System::Memory::*;

            unsafe {
                OpenClipboard(None).map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to open clipboard: {}", e))
                })?;

                // CF_HDROP format (15)
                let hdrop_result = GetClipboardData(15);

                if hdrop_result.is_err() {
                    let _ = CloseClipboard();
                    return Err(ClipboardError::UnsupportedType);
                }

                let hdrop = hdrop_result.unwrap();
                if hdrop.is_invalid() {
                    let _ = CloseClipboard();
                    return Err(ClipboardError::UnsupportedType);
                }

                // Convert HANDLE to HGLOBAL
                let hglobal = HGLOBAL(hdrop.0);
                let hdrop_ptr = GlobalLock(hglobal);
                if hdrop_ptr.is_null() {
                    let _ = CloseClipboard();
                    return Err(ClipboardError::AccessError(
                        "Failed to lock memory".to_string(),
                    ));
                }

                // Get file count
                let file_count = windows::Win32::UI::Shell::DragQueryFileW(
                    windows::Win32::UI::Shell::HDROP(hdrop_ptr),
                    0xFFFFFFFF,
                    None,
                );

                let mut files = Vec::new();
                for i in 0..file_count {
                    let mut buffer = vec![0u16; 260];
                    let len = windows::Win32::UI::Shell::DragQueryFileW(
                        windows::Win32::UI::Shell::HDROP(hdrop_ptr),
                        i,
                        Some(&mut buffer),
                    );

                    if len > 0 {
                        let path = OsString::from_wide(&buffer[..len as usize])
                            .to_string_lossy()
                            .to_string();
                        files.push(path);
                    }
                }

                let _ = GlobalUnlock(hglobal);
                let _ = CloseClipboard();

                Ok(files)
            }
        }

        fn set_file_paths(paths: &[String]) -> Result<(), ClipboardError> {
            use std::ffi::OsStr;
            use std::os::windows::ffi::OsStrExt;
            use windows::Win32::System::Memory::*;

            unsafe {
                OpenClipboard(None).map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to open clipboard: {}", e))
                })?;

                let _ = EmptyClipboard();

                // Calculate size needed for DROPFILES structure + file paths
                let mut total_size = std::mem::size_of::<windows::Win32::UI::Shell::DROPFILES>();
                for path in paths {
                    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
                    total_size += wide.len() * 2;
                }
                total_size += 2; // Final null terminator

                let hmem = GlobalAlloc(GMEM_MOVEABLE, total_size).map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to allocate memory: {}", e))
                })?;

                let ptr = GlobalLock(hmem);
                if ptr.is_null() {
                    let _ = GlobalFree(hmem);
                    let _ = CloseClipboard();
                    return Err(ClipboardError::AccessError(
                        "Failed to lock memory".to_string(),
                    ));
                }

                // Write DROPFILES structure
                let dropfiles = ptr as *mut windows::Win32::UI::Shell::DROPFILES;
                (*dropfiles).pFiles =
                    std::mem::size_of::<windows::Win32::UI::Shell::DROPFILES>() as u32;
                (*dropfiles).pt.x = 0;
                (*dropfiles).pt.y = 0;
                (*dropfiles).fNC = false.into();
                (*dropfiles).fWide = true.into();

                // Write file paths
                let mut offset = std::mem::size_of::<windows::Win32::UI::Shell::DROPFILES>();
                for path in paths {
                    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
                    let dest = (ptr as usize + offset) as *mut u16;
                    std::ptr::copy_nonoverlapping(wide.as_ptr(), dest, wide.len());
                    offset += wide.len() * 2;
                }

                // Final null terminator
                let final_null = (ptr as usize + offset) as *mut u16;
                *final_null = 0;

                let _ = GlobalUnlock(hmem);

                // Set clipboard data (CF_HDROP = 15)
                // HGLOBAL can be used directly as HANDLE
                let handle = HANDLE(hmem.0 as isize as *mut _);
                SetClipboardData(15, handle).map_err(|e| {
                    ClipboardError::AccessError(format!("Failed to set clipboard data: {}", e))
                })?;

                let _ = CloseClipboard();

                Ok(())
            }
        }

        fn get_process_name(process_id: u32) -> Result<String, ClipboardError> {
            use windows::core::PWSTR;
            use windows::Win32::System::Threading::*;

            unsafe {
                let handle = OpenProcess(
                    PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                    false,
                    process_id,
                )
                .map_err(|e| ClipboardError::PlatformError(e.to_string()))?;

                let mut name = vec![0u16; 260];
                let mut size = name.len() as u32;
                let pwstr = PWSTR(name.as_mut_ptr());

                match QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, pwstr, &mut size) {
                    Ok(_) => {
                        let _ = CloseHandle(handle);
                        let path = String::from_utf16_lossy(&name[..size as usize]);
                        Ok(path)
                    }
                    Err(_) => {
                        let _ = CloseHandle(handle);
                        Ok("Unknown".to_string())
                    }
                }
            }
        }

        /// 获取前台窗口信息（静态方法，可在轮询线程中调用）
        fn get_active_window_info_static() -> WindowMetadata {
            unsafe {
                let hwnd = GetForegroundWindow();
                if hwnd.is_invalid() {
                    return WindowMetadata {
                        source_app: "Unknown".to_string(),
                        window_title: "".to_string(),
                        source_url: None,
                        is_self: false,
                    };
                }

                let mut title = vec![0u16; 256];
                let len = GetWindowTextW(hwnd, &mut title);
                let window_title = String::from_utf16_lossy(&title[..len as usize]);

                let mut process_id = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut process_id));

                // Check if this is our own process
                let current_pid = std::process::id();
                let is_self = process_id == current_pid;

                let exe_path =
                    Self::get_process_name(process_id).unwrap_or_else(|_| "Unknown".to_string());

                let source_app = Self::get_friendly_app_name(&exe_path, &window_title);

                WindowMetadata {
                    source_app,
                    window_title,
                    source_url: None,
                    is_self,
                }
            }
        }

        /// 获取友好应用名（带缓存）
        /// 优先级：ProductName (exe版本信息) → 窗口标题提取 → 进程文件名
        fn get_friendly_app_name(exe_path: &str, window_title: &str) -> String {
            if exe_path == "Unknown" || exe_path.is_empty() {
                return "Unknown".to_string();
            }

            // check cache
            {
                let cache = APP_NAME_CACHE.lock();
                if let Some(name) = cache.get(exe_path) {
                    return name.clone();
                }
            }

            // priority 1: ProductName from exe version info
            if let Some(product_name) = Self::get_product_name_from_exe(exe_path) {
                if !product_name.is_empty() {
                    APP_NAME_CACHE
                        .lock()
                        .insert(exe_path.to_string(), product_name.clone());
                    return product_name;
                }
            }

            // priority 2: extract app name from window title (after last " - ")
            if let Some(pos) = window_title.rfind(" - ") {
                let candidate = window_title[pos + 3..].trim();
                if !candidate.is_empty() && candidate.len() < 50 {
                    let name = candidate.to_string();
                    APP_NAME_CACHE
                        .lock()
                        .insert(exe_path.to_string(), name.clone());
                    return name;
                }
            }

            // priority 3: fallback to process filename
            let file_name = std::path::Path::new(exe_path)
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();

            APP_NAME_CACHE
                .lock()
                .insert(exe_path.to_string(), file_name.clone());
            file_name
        }

        /// 从 exe 文件的版本信息中读取 ProductName
        fn get_product_name_from_exe(exe_path: &str) -> Option<String> {
            use windows::core::PCWSTR;
            use windows::Win32::Storage::FileSystem::*;

            unsafe {
                let wide_path: Vec<u16> =
                    exe_path.encode_utf16().chain(std::iter::once(0)).collect();
                let path_pcwstr = PCWSTR(wide_path.as_ptr());

                // 获取版本信息大小
                let size = GetFileVersionInfoSizeW(path_pcwstr, None);
                if size == 0 {
                    return None;
                }

                // 分配缓冲区并获取版本信息
                let mut buffer = vec![0u8; size as usize];
                if GetFileVersionInfoW(path_pcwstr, 0, size, buffer.as_mut_ptr() as *mut _).is_err()
                {
                    return None;
                }

                // 尝试多个代码页
                let code_pages = [
                    "040904b0", // US English, Unicode
                    "040904E4", // US English, Multilingual
                    "080404b0", // Chinese Simplified, Unicode
                ];

                for code_page in &code_pages {
                    let query = format!("\\StringFileInfo\\{}\\ProductName\0", code_page);
                    let wide_query: Vec<u16> = query.encode_utf16().collect();
                    let query_pcwstr = PCWSTR(wide_query.as_ptr());

                    let mut value_ptr: *mut std::ffi::c_void = std::ptr::null_mut();
                    let mut value_len: u32 = 0;

                    if VerQueryValueW(
                        buffer.as_ptr() as *const _,
                        query_pcwstr,
                        &mut value_ptr,
                        &mut value_len,
                    )
                    .as_bool()
                        && value_len > 0
                        && !value_ptr.is_null()
                    {
                        let slice =
                            std::slice::from_raw_parts(value_ptr as *const u16, value_len as usize);
                        // 去掉末尾的 null
                        let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
                        let name = String::from_utf16_lossy(&slice[..end]).trim().to_string();
                        if !name.is_empty() {
                            return Some(name);
                        }
                    }
                }

                None
            }
        }
    }
}

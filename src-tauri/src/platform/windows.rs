#[cfg(target_os = "windows")]
pub mod windows {
    use crate::core::models::{ClipboardContent, WindowMetadata};
    use crate::platform::clipboard_trait::*;
    use async_trait::async_trait;
    use once_cell::sync::Lazy;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use windows::core::w;
    use windows::Win32::Foundation::*;
    use windows::Win32::System::DataExchange::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    /// 友好应用名缓存：key = exe 路径, value = 友好名称
    static APP_NAME_CACHE: Lazy<Mutex<HashMap<String, String>>> =
        Lazy::new(|| Mutex::new(HashMap::new()));

    // Wrapper to make HWND Send
    #[derive(Clone, Copy)]
    struct SendHwnd(HWND);
    unsafe impl Send for SendHwnd {}
    unsafe impl Sync for SendHwnd {}

    pub struct WindowsClipboard {
        hwnd: SendHwnd,
        last_sequence: Arc<Mutex<u32>>,
        skip_next: Arc<AtomicBool>,
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
                        w!("ClipBox Clipboard Listener"),
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
                skip_next: Arc::new(AtomicBool::new(false)),
            })
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

            println!("Clipboard listener registered successfully");

            let last_sequence = self.last_sequence.clone();
            let skip_next = self.skip_next.clone();

            // Create a tokio runtime for callbacks
            let rt = tokio::runtime::Runtime::new().unwrap();

            // Poll clipboard changes
            std::thread::spawn(move || {
                println!("Clipboard polling started...");
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(300));

                    unsafe {
                        let sequence = GetClipboardSequenceNumber();
                        let mut last = last_sequence.lock().unwrap();

                        if sequence != *last && *last != 0 {
                            *last = sequence;
                            drop(last);

                            // Skip if this change was triggered by our own set_content
                            if skip_next.swap(false, Ordering::SeqCst) {
                                println!(
                                    "Skipping self-triggered clipboard change (sequence: {})",
                                    sequence
                                );
                                continue;
                            }

                            println!("Clipboard change detected (sequence: {})", sequence);

                            // Capture window info immediately in polling thread
                            let metadata = Self::get_active_window_info_static();

                            if let Ok(content) = Self::get_clipboard_content_sync() {
                                // Spawn async callback so polling thread is not blocked
                                let fut = callback(content, metadata);
                                rt.spawn(async move {
                                    if let Err(e) = fut.await {
                                        eprintln!("Callback error: {:?}", e);
                                    }
                                });
                            } else {
                                println!("Failed to get clipboard content");
                            }
                        } else if *last == 0 {
                            *last = sequence;
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
            // Mark to skip the next clipboard change detection
            self.skip_next.store(true, Ordering::SeqCst);

            // Use block_in_place to run synchronously, avoid cross-thread clipboard issues
            tokio::task::block_in_place(|| {
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
            })
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
                    let fmt = RegisterClipboardFormatW(
                        windows::core::PCWSTR(wide.as_ptr()),
                    );
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
                                    let slice = std::slice::from_raw_parts(
                                        ptr as *const u8,
                                        size,
                                    );
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

        /// Filter out trivial rich formats that are just code-editor syntax highlighting.
        /// Editors like VS Code, IntelliJ, Sublime Text attach HTML Format and RTF
        /// for syntax coloring, but this is not meaningful rich text.
        fn filter_trivial_rich_formats(
            formats: Vec<(String, Vec<u8>)>,
            _plain_text: &str,
        ) -> Vec<(String, Vec<u8>)> {
            // Check if HTML Format is trivial editor output
            let html_is_trivial = formats
                .iter()
                .any(|(name, data)| name == "HTML Format" && Self::is_editor_html(data));

            if !html_is_trivial {
                return formats;
            }

            // If HTML is trivial editor output, filter out both HTML and RTF
            // (they come from the same copy source)
            println!("[RichFormat] Detected editor syntax highlighting, removing rich formats");
            formats
                .into_iter()
                .filter(|(name, _)| name != "HTML Format" && name != "Rich Text Format")
                .collect()
        }

        /// Check if HTML Format clipboard data is just code-editor syntax highlighting.
        fn is_editor_html(data: &[u8]) -> bool {
            let end = data.iter().position(|&b| b == 0).unwrap_or(data.len());
            let html = match std::str::from_utf8(&data[..end]) {
                Ok(s) => s,
                Err(_) => return false,
            };

            let lower = html.to_lowercase();

            // Structural elements that indicate real rich text
            let rich_tags = [
                "<table",
                "<img",
                "<h1", "<h2", "<h3", "<h4", "<h5", "<h6",
                "<ul>", "<ol>", "<li>",
                "<blockquote",
                "<hr",
                "<iframe",
                "<video", "<audio",
                "<figure", "<picture", "<svg",
            ];

            for tag in &rich_tags {
                if lower.contains(tag) {
                    return false;
                }
            }

            // Links with href indicate real rich content
            if lower.contains("<a ") && lower.contains("href") {
                return false;
            }

            // Monospace font is a strong signal of code editor output
            let monospace_indicators = [
                "consolas", "courier", "monospace", "menlo", "monaco",
                "source code pro", "fira code", "jetbrains mono", "cascadia",
                "sf mono", "ubuntu mono", "droid sans mono", "liberation mono",
                "roboto mono", "iosevka",
            ];

            monospace_indicators.iter().any(|f| lower.contains(f))
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
                    let fmt = RegisterClipboardFormatW(
                        windows::core::PCWSTR(wide_name.as_ptr()),
                    );
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

            // 检查缓存
            if let Ok(cache) = APP_NAME_CACHE.lock() {
                if let Some(name) = cache.get(exe_path) {
                    return name.clone();
                }
            }

            // 优先级1：从 exe 版本信息读取 ProductName
            if let Some(product_name) = Self::get_product_name_from_exe(exe_path) {
                if !product_name.is_empty() {
                    if let Ok(mut cache) = APP_NAME_CACHE.lock() {
                        cache.insert(exe_path.to_string(), product_name.clone());
                    }
                    return product_name;
                }
            }

            // 优先级2：从窗口标题提取应用名（取最后一个 " - " 后的部分）
            if let Some(pos) = window_title.rfind(" - ") {
                let candidate = window_title[pos + 3..].trim();
                if !candidate.is_empty() && candidate.len() < 50 {
                    let name = candidate.to_string();
                    if let Ok(mut cache) = APP_NAME_CACHE.lock() {
                        cache.insert(exe_path.to_string(), name.clone());
                    }
                    return name;
                }
            }

            // 优先级3：进程文件名兜底
            let file_name = std::path::Path::new(exe_path)
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();

            if let Ok(mut cache) = APP_NAME_CACHE.lock() {
                cache.insert(exe_path.to_string(), file_name.clone());
            }
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

#[cfg(target_os = "windows")]
pub mod windows {
    use crate::platform::clipboard_trait::*;
    use crate::core::models::{ClipboardContent, WindowMetadata};
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};
    use windows::Win32::Foundation::*;
    use windows::Win32::System::DataExchange::*;
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::core::w;
    use std::sync::mpsc;

    // Wrapper to make HWND Send
    #[derive(Clone, Copy)]
    struct SendHwnd(HWND);
    unsafe impl Send for SendHwnd {}
    unsafe impl Sync for SendHwnd {}

    pub struct WindowsClipboard {
        hwnd: SendHwnd,
        last_sequence: Arc<Mutex<u32>>,
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
                        0, 0, 0, 0,
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

            let hwnd_ptr = rx.recv()
                .map_err(|e| ClipboardError::PlatformError(format!("Failed to receive window handle: {}", e)))?
                .map_err(|e| ClipboardError::PlatformError(e))?;

            let hwnd = unsafe { HWND(hwnd_ptr as *mut _) };

            Ok(Self {
                hwnd: SendHwnd(hwnd),
                last_sequence: Arc::new(Mutex::new(0)),
            })
        }
    }

    #[async_trait]
    impl PlatformClipboard for WindowsClipboard {
        fn register_listener(&self, callback: ClipboardCallback) -> Result<(), ClipboardError> {
            unsafe {
                AddClipboardFormatListener(self.hwnd.0)
                    .map_err(|e| ClipboardError::PlatformError(format!("Failed to register clipboard listener: {}", e)))?;
            }

            println!("Clipboard listener registered successfully");

            let last_sequence = self.last_sequence.clone();

            // Create a tokio runtime for callbacks
            let rt = tokio::runtime::Runtime::new().unwrap();

            // Poll clipboard changes
            std::thread::spawn(move || {
                println!("Clipboard polling started...");
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));

                    unsafe {
                        let sequence = GetClipboardSequenceNumber();
                        let mut last = last_sequence.lock().unwrap();

                        if sequence != *last && *last != 0 {
                            *last = sequence;
                            drop(last);

                            println!("Clipboard change detected (sequence: {})", sequence);

                            if let Ok(content) = Self::get_clipboard_content_sync() {
                                rt.block_on(async {
                                    if let Err(e) = callback(content).await {
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
            use arboard::Clipboard;
            let mut clipboard = Clipboard::new()
                .map_err(|e| ClipboardError::AccessError(e.to_string()))?;

            match content {
                ClipboardContent::Text(text) => {
                    clipboard.set_text(text)
                        .map_err(|e| ClipboardError::AccessError(e.to_string()))?;
                }
                ClipboardContent::Image(data) => {
                    let img = image::load_from_memory(&data)
                        .map_err(|e| ClipboardError::PlatformError(e.to_string()))?;
                    clipboard.set_image(arboard::ImageData {
                        width: img.width() as usize,
                        height: img.height() as usize,
                        bytes: img.to_rgba8().into_raw().into(),
                    })
                    .map_err(|e| ClipboardError::AccessError(e.to_string()))?;
                }
                _ => return Err(ClipboardError::UnsupportedType),
            }

            Ok(())
        }

        fn get_active_window_info(&self) -> Result<WindowMetadata, ClipboardError> {
            unsafe {
                let hwnd = GetForegroundWindow();
                if hwnd.is_invalid() {
                    return Ok(WindowMetadata {
                        source_app: "Unknown".to_string(),
                        window_title: "".to_string(),
                        source_url: None,
                    });
                }

                let mut title = vec![0u16; 256];
                let len = GetWindowTextW(hwnd, &mut title);
                let window_title = String::from_utf16_lossy(&title[..len as usize]);

                let mut process_id = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut process_id));

                let source_app = Self::get_process_name(process_id)
                    .unwrap_or_else(|_| "Unknown".to_string());

                Ok(WindowMetadata {
                    source_app,
                    window_title,
                    source_url: None,
                })
            }
        }

        async fn clear(&self) -> Result<(), ClipboardError> {
            unsafe {
                OpenClipboard(self.hwnd.0)
                    .map_err(|e| ClipboardError::AccessError(format!("Failed to open clipboard: {}", e)))?;
                EmptyClipboard()
                    .map_err(|e| ClipboardError::AccessError(format!("Failed to empty clipboard: {}", e)))?;
                CloseClipboard()
                    .map_err(|e| ClipboardError::AccessError(format!("Failed to close clipboard: {}", e)))?;
            }
            Ok(())
        }
    }

    impl WindowsClipboard {
        fn get_clipboard_content_sync() -> Result<ClipboardContent, ClipboardError> {
            use arboard::Clipboard;
            let mut clipboard = Clipboard::new()
                .map_err(|e| ClipboardError::AccessError(e.to_string()))?;

            if let Ok(text) = clipboard.get_text() {
                return Ok(ClipboardContent::Text(text));
            }

            if let Ok(img) = clipboard.get_image() {
                let rgba = image::RgbaImage::from_raw(
                    img.width as u32,
                    img.height as u32,
                    img.bytes.to_vec(),
                ).ok_or(ClipboardError::PlatformError("Invalid image data".to_string()))?;

                let mut buffer = Vec::new();
                use image::codecs::png::PngEncoder;
                let encoder = PngEncoder::new(&mut buffer);
                rgba.write_with_encoder(encoder)
                    .map_err(|e| ClipboardError::PlatformError(e.to_string()))?;

                return Ok(ClipboardContent::Image(buffer));
            }

            Err(ClipboardError::UnsupportedType)
        }

        fn get_process_name(process_id: u32) -> Result<String, ClipboardError> {
            use windows::Win32::System::Threading::*;
            use windows::core::PWSTR;

            unsafe {
                let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, process_id)
                    .map_err(|e| ClipboardError::PlatformError(e.to_string()))?;

                let mut name = vec![0u16; 260];
                let mut size = name.len() as u32;
                let pwstr = PWSTR(name.as_mut_ptr());

                match QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, pwstr, &mut size) {
                    Ok(_) => {
                        let _ = CloseHandle(handle);
                        let path = String::from_utf16_lossy(&name[..size as usize]);
                        Ok(std::path::Path::new(&path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("Unknown")
                            .to_string())
                    }
                    Err(_) => {
                        let _ = CloseHandle(handle);
                        Ok("Unknown".to_string())
                    }
                }
            }
        }
    }
}

use super::super::{provider::OcrProvider, OcrError, OcrResult};
use async_trait::async_trait;

pub struct MacNativeOcr;

impl MacNativeOcr {
    pub fn new() -> Self {
        Self
    }

    fn do_recognize(image_path: &str) -> Result<String, OcrError> {
        use objc::runtime::{Class, Object, BOOL, YES};
        use objc::{msg_send, sel, sel_impl};
        use std::ffi::CString;

        unsafe {
            // Load image: NSImage -> CGImage
            let ns_string_cls = Class::get("NSString")
                .ok_or_else(|| OcrError::EngineError("NSString class not found".into()))?;
            let c_path = CString::new(image_path)
                .map_err(|e| OcrError::EngineError(format!("Invalid path: {}", e)))?;
            let ns_path: *mut Object =
                msg_send![ns_string_cls, stringWithUTF8String: c_path.as_ptr()];

            let ns_image_cls = Class::get("NSImage")
                .ok_or_else(|| OcrError::EngineError("NSImage class not found".into()))?;
            let ns_image: *mut Object = msg_send![ns_image_cls, alloc];
            let ns_image: *mut Object = msg_send![ns_image, initWithContentsOfFile: ns_path];
            if ns_image.is_null() {
                return Err(OcrError::ImageError(format!(
                    "Failed to load image: {}",
                    image_path
                )));
            }

            // Get CGImage from NSImage
            let cg_rect = cocoa::foundation::NSRect::new(
                cocoa::foundation::NSPoint::new(0.0, 0.0),
                cocoa::foundation::NSSize::new(0.0, 0.0),
            );
            let null_ptr: *mut Object = std::ptr::null_mut();
            let cg_image: *mut Object =
                msg_send![ns_image, CGImageForProposedRect: &cg_rect context: null_ptr hints: null_ptr];
            if cg_image.is_null() {
                return Err(OcrError::ImageError("Failed to get CGImage".into()));
            }

            // Create VNImageRequestHandler
            let handler_cls = Class::get("VNImageRequestHandler")
                .ok_or_else(|| OcrError::EngineError("VNImageRequestHandler not found".into()))?;
            let handler: *mut Object = msg_send![handler_cls, alloc];
            let options_cls = Class::get("NSDictionary")
                .ok_or_else(|| OcrError::EngineError("NSDictionary not found".into()))?;
            let empty_dict: *mut Object = msg_send![options_cls, dictionary];
            let handler: *mut Object =
                msg_send![handler, initWithCGImage: cg_image options: empty_dict];

            // Create VNRecognizeTextRequest
            let request_cls = Class::get("VNRecognizeTextRequest")
                .ok_or_else(|| OcrError::EngineError("VNRecognizeTextRequest not found".into()))?;
            let request: *mut Object = msg_send![request_cls, alloc];
            let request: *mut Object = msg_send![request, init];

            // Set recognition languages: Chinese + English
            let ns_array_cls = Class::get("NSArray")
                .ok_or_else(|| OcrError::EngineError("NSArray not found".into()))?;
            let lang_zh: *mut Object =
                msg_send![ns_string_cls, stringWithUTF8String: CString::new("zh-Hans").unwrap().as_ptr()];
            let lang_en: *mut Object =
                msg_send![ns_string_cls, stringWithUTF8String: CString::new("en").unwrap().as_ptr()];
            let langs: *mut Object =
                msg_send![ns_array_cls, arrayWithObjects: &[lang_zh, lang_en][0] count: 2usize];
            let _: () = msg_send![request, setRecognitionLanguages: langs];

            // Set accurate recognition level (1 = accurate)
            let _: () = msg_send![request, setRecognitionLevel: 1i64];

            // Perform request
            let requests: *mut Object =
                msg_send![ns_array_cls, arrayWithObject: request];
            let mut error: *mut Object = std::ptr::null_mut();
            let success: BOOL =
                msg_send![handler, performRequests: requests error: &mut error];

            if success != YES {
                let desc: *mut Object = msg_send![error, localizedDescription];
                let c_str: *const i8 = msg_send![desc, UTF8String];
                let err_msg = if c_str.is_null() {
                    "Unknown Vision error".to_string()
                } else {
                    std::ffi::CStr::from_ptr(c_str).to_string_lossy().into_owned()
                };
                return Err(OcrError::EngineError(format!("Vision request failed: {}", err_msg)));
            }

            // Extract results
            let results: *mut Object = msg_send![request, results];
            let count: usize = msg_send![results, count];
            let mut text_parts: Vec<String> = Vec::new();

            for i in 0..count {
                let observation: *mut Object = msg_send![results, objectAtIndex: i];
                let candidates: *mut Object =
                    msg_send![observation, topCandidates: 1usize];
                let candidate_count: usize = msg_send![candidates, count];
                if candidate_count > 0 {
                    let candidate: *mut Object = msg_send![candidates, objectAtIndex: 0usize];
                    let text_obj: *mut Object = msg_send![candidate, string];
                    let c_str: *const i8 = msg_send![text_obj, UTF8String];
                    if !c_str.is_null() {
                        let s = std::ffi::CStr::from_ptr(c_str)
                            .to_string_lossy()
                            .into_owned();
                        text_parts.push(s);
                    }
                }
            }

            Ok(text_parts.join("\n"))
        }
    }
}

#[async_trait]
impl OcrProvider for MacNativeOcr {
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        let path = image_path.to_string();
        let text = tokio::task::spawn_blocking(move || Self::do_recognize(&path))
            .await
            .map_err(|e| OcrError::EngineError(format!("Task failed: {}", e)))??;

        Ok(OcrResult::new(text, "Native OCR".to_string()))
    }

    async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError> {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("native_ocr_{}.png", uuid::Uuid::new_v4()));

        tokio::fs::write(&temp_file, image_data)
            .await
            .map_err(|e| OcrError::IoError(e))?;

        let result = self.recognize(temp_file.to_str().unwrap()).await;

        let _ = tokio::fs::remove_file(&temp_file).await;

        result
    }

    fn provider_name(&self) -> &str {
        "Native OCR"
    }

    async fn is_available(&self) -> bool {
        // Vision framework is available on macOS 10.15+
        true
    }
}


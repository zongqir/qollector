use super::{provider::OcrProvider, OcrError, OcrResult};
use async_trait::async_trait;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

/// DeepSeek OCR 实现
///
/// 使用 DeepSeek 的视觉模型进行 OCR 识别
pub struct DeepSeekOcr {
    api_key: String,
    base_url: String,
    model: String,
    client: reqwest::Client,
}

#[derive(Debug, Serialize)]
struct ImageContent {
    #[serde(rename = "type")]
    content_type: String,
    image_url: ImageUrl,
}

#[derive(Debug, Serialize)]
struct ImageUrl {
    url: String,
}

#[derive(Debug, Serialize)]
struct TextContent {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum MessageContent {
    Text(TextContent),
    Image(ImageContent),
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: Vec<MessageContent>,
}

#[derive(Debug, Serialize)]
struct OcrRequest {
    model: String,
    messages: Vec<Message>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Debug, Deserialize)]
struct OcrResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

impl DeepSeekOcr {
    pub fn new(api_key: String, base_url: Option<String>, model: Option<String>) -> Self {
        let client = crate::http_client::long_running_client().clone();
        let selected_model = model
            .filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| "deepseek-chat".to_string());

        Self {
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.deepseek.com/v1".to_string()),
            model: selected_model,
            client,
        }
    }

    pub fn with_model(mut self, model: String) -> Self {
        if !model.trim().is_empty() {
            self.model = model;
        }
        self
    }

    async fn read_image_to_base64(&self, image_path: &str) -> Result<String, OcrError> {
        let image_data = tokio::fs::read(image_path).await?;
        Ok(super::preprocess_image_for_vlm(&image_data))
    }

    fn bytes_to_base64(&self, image_data: &[u8]) -> String {
        super::preprocess_image_for_vlm(image_data)
    }

    async fn call_api(&self, image_base64: String) -> Result<OcrResult, OcrError> {
        let data_url = format!("data:image/jpeg;base64,{}", image_base64);

        let request = OcrRequest {
            model: self.model.clone(),
            messages: vec![Message {
                role: "user".to_string(),
                content: vec![
                    MessageContent::Text(TextContent {
                        content_type: "text".to_string(),
                        text: "请识别图片中的所有文字，直接返回文字内容，不要添加任何解释或格式。"
                            .to_string(),
                    }),
                    MessageContent::Image(ImageContent {
                        content_type: "image_url".to_string(),
                        image_url: ImageUrl { url: data_url },
                    }),
                ],
            }],
            max_tokens: 2000,
            temperature: 0.0,
        };

        let url = format!("{}/chat/completions", self.base_url);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    OcrError::ApiError(format!("DeepSeek OCR 识别超时（已等待 120 秒），服务端处理或排队过久: {}", e))
                } else {
                    OcrError::RequestError(e)
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await?;
            return Err(OcrError::ApiError(format!(
                "DeepSeek API error ({}): {}",
                status, error_text
            )));
        }

        let response_text = response.text().await?;
        let ocr_response: OcrResponse = serde_json::from_str(&response_text)
            .map_err(|e| OcrError::ApiError(format!("Failed to parse response: {}", e)))?;

        if let Some(choice) = ocr_response.choices.first() {
            let text = choice.message.content.trim().to_string();
            Ok(OcrResult::new(text, "DeepSeek".to_string()))
        } else {
            Err(OcrError::ApiError("No response from DeepSeek".to_string()))
        }
    }
}

#[async_trait]
impl OcrProvider for DeepSeekOcr {
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        let image_base64 = self.read_image_to_base64(image_path).await?;
        self.call_api(image_base64).await
    }

    async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError> {
        let image_base64 = self.bytes_to_base64(image_data);
        self.call_api(image_base64).await
    }

    fn provider_name(&self) -> &str {
        "DeepSeek OCR"
    }

    async fn is_available(&self) -> bool {
        !self.api_key.is_empty()
    }
}

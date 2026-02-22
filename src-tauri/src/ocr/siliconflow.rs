use super::{provider::OcrProvider, OcrError, OcrResult};
use async_trait::async_trait;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};

/// 硅基流动 OCR 实现
///
/// 使用硅基流动的视觉模型进行 OCR 识别
pub struct SiliconFlowOcr {
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

impl SiliconFlowOcr {
    pub fn new(api_key: String, base_url: Option<String>) -> Self {
        let client = crate::http_client::client().clone();

        Self {
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.siliconflow.cn/v1".to_string()),
            model: "Qwen/Qwen2-VL-72B-Instruct".to_string(), // 使用 Qwen2-VL-72B 模型
            client,
        }
    }

    pub fn with_model(mut self, model: String) -> Self {
        self.model = model;
        self
    }

    async fn read_image_to_base64(&self, image_path: &str) -> Result<String, OcrError> {
        let image_data = tokio::fs::read(image_path).await?;
        Ok(general_purpose::STANDARD.encode(&image_data))
    }

    fn bytes_to_base64(&self, image_data: &[u8]) -> String {
        general_purpose::STANDARD.encode(image_data)
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
                        text: "请识别图片中的所有文字，直接返回文字内容，不要添加任何解释或格式。如果图片中没有文字，返回空字符串。".to_string(),
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

        println!("调用硅基流动 OCR API: {}", url);
        println!("使用模型: {}", self.model);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        println!("API 响应状态: {}", status);

        if !status.is_success() {
            let error_text = response.text().await?;
            println!("API 错误响应: {}", error_text);
            return Err(OcrError::ApiError(format!(
                "硅基流动 API 错误 ({}): {}",
                status, error_text
            )));
        }

        let response_text = response.text().await?;
        println!("API 响应内容: {}", response_text);

        let ocr_response: OcrResponse = serde_json::from_str(&response_text)
            .map_err(|e| OcrError::ApiError(format!("解析响应失败: {}", e)))?;

        if let Some(choice) = ocr_response.choices.first() {
            let text = choice.message.content.trim().to_string();
            println!("OCR 识别结果: {}", text);
            Ok(OcrResult::new(text, "硅基流动".to_string()))
        } else {
            Err(OcrError::ApiError("硅基流动未返回结果".to_string()))
        }
    }
}

#[async_trait]
impl OcrProvider for SiliconFlowOcr {
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        let image_base64 = self.read_image_to_base64(image_path).await?;
        self.call_api(image_base64).await
    }

    async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError> {
        let image_base64 = self.bytes_to_base64(image_data);
        self.call_api(image_base64).await
    }

    fn provider_name(&self) -> &str {
        "硅基流动 OCR"
    }

    async fn is_available(&self) -> bool {
        let available = !self.api_key.is_empty();
        println!("硅基流动 OCR 可用性检查: {}", available);
        println!("  API Key 长度: {}", self.api_key.len());
        println!("  Base URL: {}", self.base_url);
        println!("  Model: {}", self.model);
        available
    }
}

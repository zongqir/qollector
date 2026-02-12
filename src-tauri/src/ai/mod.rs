use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AIError {
    #[error("HTTP request failed: {0}")]
    RequestError(#[from] reqwest::Error),
    #[error("API error: {0}")]
    ApiError(String),
    #[error("Invalid configuration: {0}")]
    ConfigError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AIProvider {
    SiliconFlow,
    Volcano,
    Alibaba,
    Custom { name: String, base_url: String },
}

impl AIProvider {
    pub fn base_url(&self) -> &str {
        match self {
            AIProvider::SiliconFlow => "https://api.siliconflow.cn/v1",
            AIProvider::Volcano => "https://ark.cn-beijing.volces.com/api/v3",
            AIProvider::Alibaba => "https://dashscope.aliyuncs.com/api/v1",
            AIProvider::Custom { base_url, .. } => base_url,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            AIProvider::SiliconFlow => "硅基流动",
            AIProvider::Volcano => "火山引擎",
            AIProvider::Alibaba => "阿里云",
            AIProvider::Custom { name, .. } => name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfig {
    pub provider: AIProvider,
    pub api_key: String,
    pub model: String,
    pub enabled: bool,
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            provider: AIProvider::SiliconFlow,
            api_key: String::new(),
            model: "Qwen/Qwen2.5-7B-Instruct".to_string(),
            enabled: false,
        }
    }
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Debug, Deserialize)]
struct Message {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    code: Option<i32>,
    message: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

pub struct AIService {
    config: AIConfig,
    client: reqwest::Client,
}

impl AIService {
    pub fn new(config: AIConfig) -> Self {
        Self {
            config,
            client: reqwest::Client::new(),
        }
    }

    pub async fn generate_tags(&self, content: &str) -> Result<Vec<String>, AIError> {
        if !self.config.enabled || self.config.api_key.is_empty() {
            return Ok(Vec::new());
        }

        // Sanitize and truncate content
        let truncated = &content[..content.len().min(500)];
        let sanitized = truncated.replace('\0', "").trim().to_string();

        if sanitized.is_empty() {
            return Ok(Vec::new());
        }

        let prompt = format!(
            "请为以下内容生成3-5个简短的中文标签，用于分类和检索。只返回标签，用逗号分隔，不要其他解释。\n\n内容：{}",
            sanitized
        );

        let request = ChatRequest {
            model: self.config.model.clone(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: prompt.clone(),
            }],
            max_tokens: 100,
            temperature: 0.7,
        };

        let url = format!("{}/chat/completions", self.config.provider.base_url());

        println!("=== AI Request Debug ===");
        println!("URL: {}", url);
        println!("Model: {}", self.config.model);
        println!("API Key (first 10 chars): {}", &self.config.api_key[..10.min(self.config.api_key.len())]);
        println!("Prompt length: {}", prompt.len());
        println!("Request body: {}", serde_json::to_string_pretty(&request).unwrap_or_default());

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        println!("=== AI Response Debug ===");
        println!("Status: {}", status);

        if !status.is_success() {
            let error_text = response.text().await?;
            println!("Error response: {}", error_text);
            return Err(AIError::ApiError(error_text));
        }

        let response_text = response.text().await?;
        println!("Response body: {}", response_text);

        // First try to parse as error response
        if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&response_text) {
            if error_response.code.is_some() {
                return Err(AIError::ApiError(format!(
                    "API error code {}: {}",
                    error_response.code.unwrap(),
                    error_response.message
                )));
            }
        }

        // Parse as successful response
        let chat_response: ChatResponse = serde_json::from_str(&response_text)
            .map_err(|e| AIError::ApiError(format!("Failed to parse response: {}", e)))?;

        if let Some(choice) = chat_response.choices.first() {
            let tags_text = choice.message.content.trim();
            println!("AI generated text: {}", tags_text);

            let tags: Vec<String> = tags_text
                .split(&[',', '，', '\n'][..])
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .take(5)
                .collect();

            println!("Parsed tags: {:?}", tags);
            Ok(tags)
        } else {
            Ok(Vec::new())
        }
    }
}

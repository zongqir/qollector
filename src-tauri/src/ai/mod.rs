use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

// 系统提示词配置（打包进 EXE）
const SYSTEM_PROMPTS_JSON: &str = include_str!("../../prompts/ai_tag_generation.json");

#[derive(Debug, Deserialize)]
struct SystemPrompts {
    #[serde(rename = "zh-CN")]
    zh_cn: PromptConfig,
    #[serde(rename = "en-US")]
    en_us: PromptConfig,
}

#[derive(Debug, Deserialize)]
struct PromptConfig {
    system_prompt: String,
}

// 懒加载系统提示词
static SYSTEM_PROMPTS: Lazy<SystemPrompts> = Lazy::new(|| {
    serde_json::from_str(SYSTEM_PROMPTS_JSON).expect("Failed to parse system prompts JSON")
});

/// 获取系统提示词（根据语言）
pub fn get_system_prompt(language: &str) -> &'static str {
    match language {
        "zh-CN" | "zh" => &SYSTEM_PROMPTS.zh_cn.system_prompt,
        "en-US" | "en" => &SYSTEM_PROMPTS.en_us.system_prompt,
        _ => &SYSTEM_PROMPTS.zh_cn.system_prompt, // 默认中文
    }
}

#[derive(Debug, Error)]
pub enum AIError {
    #[error("HTTP request failed: {0}")]
    RequestError(#[from] reqwest::Error),
    #[error("API error: {0}")]
    ApiError(String),
    #[error("Invalid configuration: {0}")]
    ConfigError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
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

    /// 获取该供应商支持的模型列表
    pub fn available_models(&self) -> Vec<String> {
        match self {
            AIProvider::SiliconFlow => vec![
                "Qwen/Qwen2.5-7B-Instruct".to_string(),
                "Qwen/Qwen2.5-14B-Instruct".to_string(),
                "Qwen/Qwen2.5-32B-Instruct".to_string(),
                "Qwen/Qwen2.5-72B-Instruct".to_string(),
                "deepseek-ai/DeepSeek-V2.5".to_string(),
                "THUDM/glm-4-9b-chat".to_string(),
            ],
            AIProvider::Volcano => vec![
                "doubao-seed-1-8-251228".to_string(),
                "ep-20250101-xxxxx".to_string(), // 示例格式
            ],
            AIProvider::Alibaba => vec![
                "qwen-turbo".to_string(),
                "qwen-plus".to_string(),
                "qwen-max".to_string(),
                "qwen-max-longcontext".to_string(),
            ],
            AIProvider::Custom { .. } => vec![
                "gpt-3.5-turbo".to_string(),
                "gpt-4".to_string(),
                "gpt-4-turbo".to_string(),
            ],
        }
    }

    /// 获取默认模型
    pub fn default_model(&self) -> String {
        match self {
            AIProvider::SiliconFlow => "Qwen/Qwen2.5-7B-Instruct".to_string(),
            AIProvider::Volcano => "doubao-seed-1-8-251228".to_string(),
            AIProvider::Alibaba => "qwen-turbo".to_string(),
            AIProvider::Custom { .. } => "gpt-3.5-turbo".to_string(),
        }
    }
}

/// AI 供应商的凭证信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AICredentials {
    pub api_key: String,
    pub model: String,
}

impl AICredentials {
    pub fn new(api_key: String, model: String) -> Self {
        Self { api_key, model }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfig {
    pub current_provider: AIProvider,
    pub credentials: HashMap<String, AICredentials>, // key 是 provider 的字符串表示
    pub enabled: bool,
    #[serde(default)]
    pub custom_prompt: Option<String>, // 用户自定义提示词（未来功能）
}

impl AIConfig {
    /// 获取当前供应商的凭证
    pub fn get_current_credentials(&self) -> Option<&AICredentials> {
        self.credentials
            .get(&self.provider_key(&self.current_provider))
    }

    /// 获取当前供应商的 API Key
    pub fn get_current_api_key(&self) -> String {
        self.get_current_credentials()
            .map(|c| c.api_key.clone())
            .unwrap_or_default()
    }

    /// 获取当前供应商的模型
    pub fn get_current_model(&self) -> String {
        self.get_current_credentials()
            .map(|c| c.model.clone())
            .unwrap_or_else(|| self.current_provider.default_model())
    }

    /// 设置当前供应商的凭证
    pub fn set_current_credentials(&mut self, api_key: String, model: String) {
        let key = self.provider_key(&self.current_provider);
        self.credentials
            .insert(key, AICredentials::new(api_key, model));
    }

    /// 生成供应商的唯一键
    fn provider_key(&self, provider: &AIProvider) -> String {
        match provider {
            AIProvider::SiliconFlow => "siliconflow".to_string(),
            AIProvider::Volcano => "volcano".to_string(),
            AIProvider::Alibaba => "alibaba".to_string(),
            AIProvider::Custom { name, .. } => format!("custom_{}", name),
        }
    }
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            current_provider: AIProvider::SiliconFlow,
            credentials: HashMap::new(),
            enabled: false,
            custom_prompt: None,
        }
    }
}

// 用于反序列化旧格式配置的临时结构
#[derive(Debug, Deserialize)]
struct LegacyAIConfig {
    provider: AIProvider,
    api_key: String,
    model: String,
    enabled: bool,
}

impl AIConfig {
    /// 从旧格式配置迁移
    pub fn from_legacy(json_str: &str) -> Result<Self, serde_json::Error> {
        // 尝试解析为新格式
        if let Ok(config) = serde_json::from_str::<AIConfig>(json_str) {
            return Ok(config);
        }

        // 如果失败，尝试解析为旧格式并迁移
        let legacy: LegacyAIConfig = serde_json::from_str(json_str)?;

        let mut config = AIConfig {
            current_provider: legacy.provider.clone(),
            credentials: HashMap::new(),
            enabled: legacy.enabled,
            custom_prompt: None,
        };

        // 将旧的 api_key 和 model 迁移到 credentials
        if !legacy.api_key.is_empty() {
            config.set_current_credentials(legacy.api_key, legacy.model);
        }

        Ok(config)
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
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self { config, client }
    }

    pub async fn generate_tags(
        &self,
        content: &str,
        language: &str,
    ) -> Result<(Vec<String>, Option<String>), AIError> {
        let api_key = self.config.get_current_api_key();

        // Only try if API key exists, don't check enabled flag
        if api_key.is_empty() {
            return Ok((Vec::new(), None));
        }

        // Sanitize and truncate content (考虑 UTF-8 字符边界)
        let max_len = 1000; // 增加到1000字符，因为不用担心token限制
        let truncated = if content.len() <= max_len {
            content
        } else {
            // 找到最后一个有效的字符边界
            let mut end = max_len;
            while end > 0 && !content.is_char_boundary(end) {
                end -= 1;
            }
            &content[..end]
        };
        let sanitized = truncated.replace('\0', "").trim().to_string();

        if sanitized.is_empty() {
            return Ok((Vec::new(), None));
        }

        // 获取提示词：优先使用用户自定义，否则使用系统提示词
        let system_prompt = if let Some(custom) = &self.config.custom_prompt {
            custom.as_str()
        } else {
            get_system_prompt(language)
        };

        let content_label = match language {
            "en-US" | "en" => "Content",
            _ => "内容",
        };
        let prompt = format!("{}\n\n{}：{}", system_prompt, content_label, sanitized);

        let model = self.config.get_current_model();
        let request = ChatRequest {
            model: model.clone(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: prompt.clone(),
            }],
            max_tokens: 100,
            temperature: 0.7,
        };

        let url = format!(
            "{}/chat/completions",
            self.config.current_provider.base_url()
        );

        println!("=== AI Request Debug ===");
        println!("URL: {}", url);
        println!("Model: {}", model);
        println!("Language: {}", language);
        println!(
            "API Key (first 10 chars): {}",
            &api_key[..10.min(api_key.len())]
        );
        println!("Prompt length: {}", prompt.len());
        println!(
            "Request body: {}",
            serde_json::to_string_pretty(&request).unwrap_or_default()
        );

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
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
            let raw_text = choice.message.content.trim();
            println!("AI generated text: {}", raw_text);

            let mut lines = raw_text.lines();
            let first_line = lines.next().unwrap_or("").trim();

            // Parse LANG:xxx from first line
            let code_language = if let Some(lang) = first_line.strip_prefix("LANG:") {
                let lang = lang.trim().to_lowercase();
                if lang == "none" || lang.is_empty() {
                    None
                } else {
                    Some(lang)
                }
            } else {
                None
            };

            // Remaining lines are tags (second line onward)
            let tags_text: String = lines.collect::<Vec<&str>>().join("\n");
            let tags: Vec<String> = tags_text
                .split(&[',', '\u{ff0c}', '\n'][..])
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty() && !s.starts_with("LANG:"))
                .take(3)
                .collect();

            println!("Parsed tags: {:?}, code_language: {:?}", tags, code_language);
            Ok((tags, code_language))
        } else {
            Ok((Vec::new(), None))
        }
    }
}

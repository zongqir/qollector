use chrono::{Local, TimeZone, Timelike};
use std::sync::LazyLock;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

// System prompts configuration (embedded in EXE)
const SYSTEM_PROMPTS_JSON: &str = include_str!("../../prompts/ai_tag_generation.json");
const TIMELINE_PROMPTS_JSON: &str = include_str!("../../prompts/timeline_summary.json");
const MAX_AI_TAGS: usize = 20;
const MAX_AI_TAG_RESPONSE_TOKENS: u32 = 280;
const AI_REQUEST_MAX_ATTEMPTS: u32 = 3;

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

// Lazy load system prompts
static SYSTEM_PROMPTS: LazyLock<SystemPrompts> = LazyLock::new(|| {
    serde_json::from_str(SYSTEM_PROMPTS_JSON).expect("Failed to parse system prompts JSON")
});

static TIMELINE_PROMPTS: LazyLock<SystemPrompts> = LazyLock::new(|| {
    serde_json::from_str(TIMELINE_PROMPTS_JSON).expect("Failed to parse timeline prompts JSON")
});

/// Get system prompt (by language)
pub fn get_system_prompt(language: &str) -> &'static str {
    match language {
        "zh-CN" | "zh" => &SYSTEM_PROMPTS.zh_cn.system_prompt,
        "en-US" | "en" => &SYSTEM_PROMPTS.en_us.system_prompt,
        _ => &SYSTEM_PROMPTS.zh_cn.system_prompt, // Default to Chinese
    }
}

/// Get timeline summary prompt (by language)
pub fn get_timeline_prompt(language: &str) -> &'static str {
    match language {
        "zh-CN" | "zh" => &TIMELINE_PROMPTS.zh_cn.system_prompt,
        "en-US" | "en" => &TIMELINE_PROMPTS.en_us.system_prompt,
        _ => &TIMELINE_PROMPTS.zh_cn.system_prompt, // Default to Chinese
    }
}

fn strip_prefixed_value<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    let value_bytes = value.as_bytes();
    let prefix_bytes = prefix.as_bytes();

    if value_bytes.len() < prefix_bytes.len() {
        return None;
    }

    // Compare ASCII prefix on raw bytes first. This avoids split_at on a non-char boundary
    // for lines that do not actually start with this prefix (e.g. "TAGS:回应..." with "TITLE:").
    if !value_bytes[..prefix_bytes.len()].eq_ignore_ascii_case(prefix_bytes) {
        return None;
    }

    Some(value[prefix_bytes.len()..].trim())
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    let normalized = value.unwrap_or("").trim();
    if normalized.is_empty() || normalized.eq_ignore_ascii_case("none") {
        None
    } else {
        Some(normalized.to_string())
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
    OpenAI,
    Gemini,
    Custom { name: String, base_url: String },
}

impl AIProvider {
    pub fn base_url(&self) -> &str {
        match self {
            AIProvider::SiliconFlow => "https://api.siliconflow.cn/v1",
            AIProvider::Volcano => "https://ark.cn-beijing.volces.com/api/v3",
            AIProvider::Alibaba => "https://dashscope.aliyuncs.com/api/v1",
            AIProvider::OpenAI => "https://api.openai.com/v1",
            AIProvider::Gemini => "https://generativelanguage.googleapis.com/v1beta/openai",
            AIProvider::Custom { base_url, .. } => base_url,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            AIProvider::SiliconFlow => "SiliconFlow",
            AIProvider::Volcano => "Volcano",
            AIProvider::Alibaba => "Alibaba",
            AIProvider::OpenAI => "OpenAI",
            AIProvider::Gemini => "Gemini",
            AIProvider::Custom { name, .. } => name,
        }
    }

    /// Get available models for this provider (fallback list)
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
                "ep-20250101-xxxxx".to_string(),
            ],
            AIProvider::Alibaba => vec![
                "qwen-turbo".to_string(),
                "qwen-plus".to_string(),
                "qwen-max".to_string(),
                "qwen-max-longcontext".to_string(),
            ],
            AIProvider::OpenAI => vec![
                "gpt-4o".to_string(),
                "gpt-4o-mini".to_string(),
                "gpt-4-turbo".to_string(),
                "gpt-3.5-turbo".to_string(),
            ],
            AIProvider::Gemini => vec![
                "gemini-2.0-flash".to_string(),
                "gemini-1.5-flash".to_string(),
                "gemini-1.5-pro".to_string(),
            ],
            AIProvider::Custom { .. } => vec![
                "gpt-3.5-turbo".to_string(),
                "gpt-4".to_string(),
                "gpt-4-turbo".to_string(),
            ],
        }
    }

    /// Get default model
    pub fn default_model(&self) -> String {
        match self {
            AIProvider::SiliconFlow => "Qwen/Qwen2.5-7B-Instruct".to_string(),
            AIProvider::Volcano => "doubao-seed-1-8-251228".to_string(),
            AIProvider::Alibaba => "qwen-turbo".to_string(),
            AIProvider::OpenAI => "gpt-4o-mini".to_string(),
            AIProvider::Gemini => "gemini-2.0-flash".to_string(),
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
            AIProvider::OpenAI => "openai".to_string(),
            AIProvider::Gemini => "gemini".to_string(),
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

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: String,
}

/// Fetch available models from a provider's /models endpoint (OpenAI-compatible).
pub async fn fetch_models(base_url: &str, api_key: &str) -> Result<Vec<String>, AIError> {
    let client = crate::http_client::client();

    let url = format!("{}/models", base_url.trim_end_matches('/'));
    println!("[AI] Fetching models from: {}", url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await?;

    if !response.status().is_success() {
        let error_text = response.text().await?;
        println!("[AI] Fetch models error: {}", error_text);
        return Err(AIError::ApiError(error_text));
    }

    let body = response.text().await?;
    let models_resp: ModelsResponse = serde_json::from_str(&body)
        .map_err(|e| AIError::ApiError(format!("Failed to parse models response: {}", e)))?;

    let mut model_ids: Vec<String> = models_resp.data.into_iter().map(|m| m.id).collect();
    model_ids.sort();

    println!("[AI] Fetched {} models", model_ids.len());
    Ok(model_ids)
}

pub struct AIService {
    config: AIConfig,
    client: reqwest::Client,
}

impl AIService {
    pub fn new(config: AIConfig) -> Self {
        let client = crate::http_client::client().clone();

        Self { config, client }
    }

    pub async fn generate_tags(
        &self,
        content: &str,
        language: &str,
    ) -> Result<(Vec<String>, Option<String>, Option<String>), AIError> {
        if !self.config.enabled {
            return Ok((Vec::new(), None, None));
        }

        let api_key = self.config.get_current_api_key();

        // Only try if API key exists.
        if api_key.is_empty() {
            return Ok((Vec::new(), None, None));
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
            return Ok((Vec::new(), None, None));
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
            max_tokens: MAX_AI_TAG_RESPONSE_TOKENS,
            temperature: 0.7,
        };

        let url = format!(
            "{}/chat/completions",
            self.config.current_provider.base_url()
        );

        println!("[AI] request: model={}, language={}, prompt_len={}", model, language, prompt.len());

        let mut attempt = 1;
        let response = loop {
            let send_result = self
                .client
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await;

            match send_result {
                Ok(response) => break response,
                Err(err) => {
                    if attempt >= AI_REQUEST_MAX_ATTEMPTS {
                        return Err(AIError::RequestError(err));
                    }

                    let backoff_ms = 300_u64 * attempt as u64;
                    eprintln!(
                        "[AI] request send failed (attempt {}/{}), retry in {}ms: {}",
                        attempt, AI_REQUEST_MAX_ATTEMPTS, backoff_ms, err
                    );
                    tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                    attempt += 1;
                }
            }
        };

        let status = response.status();
        println!("[AI] response status: {}", status);

        if !status.is_success() {
            let error_text = response.text().await?;
            eprintln!("[AI] request failed with status {}", status);
            return Err(AIError::ApiError(error_text));
        }

        let response_text = response.text().await?;
        println!("[AI] response size: {} bytes", response_text.len());

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
            println!("[AI] generated response length: {}", raw_text.len());

            let normalized_lines: Vec<&str> = raw_text
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect();
            let first_line = normalized_lines.first().copied().unwrap_or("");

            let code_language = normalize_optional_text(strip_prefixed_value(first_line, "LANG:"))
                .map(|lang| lang.to_lowercase());

            let mut ai_title: Option<String> = None;
            let mut tag_lines: Vec<String> = Vec::new();
            for line in normalized_lines.iter().skip(1) {
                if ai_title.is_none() {
                    if let Some(title) = normalize_optional_text(strip_prefixed_value(line, "TITLE:")) {
                        ai_title = Some(title);
                        continue;
                    }
                }

                if let Some(tags_part) = strip_prefixed_value(line, "TAGS:") {
                    if !tags_part.is_empty() {
                        tag_lines.push(tags_part.to_string());
                    }
                    continue;
                }

                if strip_prefixed_value(line, "LANG:").is_some() {
                    continue;
                }

                tag_lines.push((*line).to_string());
            }

            // Backward compatibility: old prompt uses second line as plain tags without TAGS:.
            let tags_text: String = tag_lines.join("\n");
            let mut seen = HashSet::new();
            let tags: Vec<String> = tags_text
                .split(&[',', '\u{ff0c}', '\n'][..])
                .map(|s| {
                    s.trim()
                        .trim_matches(|c| matches!(c, '"' | '\'' | '`' | '*' | '-'))
                        .to_string()
                })
                .filter(|s| {
                    !s.is_empty()
                        && strip_prefixed_value(s, "LANG:").is_none()
                        && strip_prefixed_value(s, "TITLE:").is_none()
                        && strip_prefixed_value(s, "TAGS:").is_none()
                })
                .filter(|s| seen.insert(s.to_lowercase()))
                .take(MAX_AI_TAGS) // Keep order, but hard-cap to avoid runaway output
                .collect();

            println!(
                "[AI] parsed tags count={}, code_language={:?}, title={:?}",
                tags.len(),
                code_language,
                ai_title
            );
            Ok((tags, code_language, ai_title))
        } else {
            Ok((Vec::new(), None, None))
        }
    }

    pub async fn generate_structured_text(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<String, AIError> {
        if !self.config.enabled {
            return Err(AIError::ConfigError("AI feature is disabled".to_string()));
        }

        let api_key = self.config.get_current_api_key();
        if api_key.is_empty() {
            return Err(AIError::ConfigError("API key is empty".to_string()));
        }

        let model = self.config.get_current_model();
        let request = ChatRequest {
            model,
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: system_prompt.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user_prompt.to_string(),
                },
            ],
            max_tokens: max_tokens.clamp(128, 2200),
            temperature: temperature.clamp(0.0, 1.2),
        };

        let url = format!(
            "{}/chat/completions",
            self.config.current_provider.base_url()
        );

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(AIError::ApiError(error_text));
        }

        let response_text = response.text().await?;
        if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&response_text) {
            if let Some(code) = error_response.code {
                let detail = error_response
                    .data
                    .map(|value| format!(" | data: {}", value))
                    .unwrap_or_default();
                return Err(AIError::ApiError(format!(
                    "API error code {}: {}{}",
                    code, error_response.message, detail
                )));
            }
        }

        let chat_response: ChatResponse = serde_json::from_str(&response_text)
            .map_err(|e| AIError::ApiError(format!("Failed to parse response: {}", e)))?;

        let output = chat_response
            .choices
            .first()
            .map(|choice| choice.message.content.trim().to_string())
            .unwrap_or_default();

        if output.is_empty() {
            return Err(AIError::ApiError("Empty response from model".to_string()));
        }

        Ok(output)
    }

    pub async fn generate_timeline_summary(
        &self,
        items: &[crate::core::models::ClipboardItem],
        language: &str,
    ) -> Result<String, AIError> {
        if !self.config.enabled {
            return Err(AIError::ConfigError("AI feature is disabled".to_string()));
        }

        println!(
            "[Timeline AI] Starting summary generation for {} items",
            items.len()
        );

        let api_key = self.config.get_current_api_key();

        if api_key.is_empty() {
            println!("[Timeline AI] Error: API key is empty");
            return Err(AIError::ConfigError("API key is empty".to_string()));
        }

        // Build timeline data summary
        let mut timeline_data = String::new();
        for item in items {
            let timestamp = item.updated_at;
            let hour = Local
                .timestamp_opt(timestamp, 0)
                .single()
                .map(|dt| dt.hour())
                .unwrap_or(0);

            let content = item.content.as_deref().unwrap_or("");

            // Safely truncate content at char boundary
            let content_preview = if content.chars().count() > 100 {
                let truncated: String = content.chars().take(100).collect();
                format!("{}...", truncated)
            } else {
                content.to_string()
            };

            timeline_data.push_str(&format!("{}:00 - {}\n", hour, content_preview));
        }

        if timeline_data.is_empty() {
            println!("[Timeline AI] No data to summarize");
            return Ok(match language {
                "en-US" | "en" => "No clipboard activity for this period.".to_string(),
                _ => "这段时间没有剪贴板活动。".to_string(),
            });
        }

        // Get timeline prompt
        let system_prompt = get_timeline_prompt(language);
        let prompt = format!("{}\n\n{}", system_prompt, timeline_data);

        println!("[Timeline AI] Prompt length: {} chars", prompt.len());

        let model = self.config.get_current_model();
        let request = ChatRequest {
            model: model.clone(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: prompt,
            }],
            max_tokens: 500,
            temperature: 0.7,
        };

        let url = format!(
            "{}/chat/completions",
            self.config.current_provider.base_url()
        );

        println!("[Timeline AI] Sending request to: {}", url);

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        println!("[Timeline AI] Response status: {}", status);

        if !status.is_success() {
            let error_text = response.text().await?;
            eprintln!("[Timeline AI] request failed with status {}", status);
            return Err(AIError::ApiError(error_text));
        }

        let response_text = response.text().await?;
        println!(
            "[Timeline AI] Response received, length: {} chars",
            response_text.len()
        );

        let chat_response: ChatResponse = serde_json::from_str(&response_text)
            .map_err(|e| AIError::ApiError(format!("Failed to parse response: {}", e)))?;

        if let Some(choice) = chat_response.choices.first() {
            let summary = choice.message.content.trim().to_string();
            println!("[Timeline AI] summary done");
            Ok(summary)
        } else {
            println!("[Timeline AI] No choices in response");
            Ok(String::new())
        }
    }
}

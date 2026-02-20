use serde::{Deserialize, Serialize};

const LOCALE_ZH: &str = "zh-CN";
const LOCALE_EN: &str = "en-US";
const LOCALE_AUTO: &str = "auto";
const MAX_INPUT_CHARS: usize = 12_000;
const MAX_EXTRA_INSTRUCTION_CHARS: usize = 1_200;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PromptTaskType {
    Summarize,
    Rewrite,
    Extract,
    Translate,
    Reply,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssistantRequest {
    pub task_type: PromptTaskType,
    pub input: String,
    #[serde(default)]
    pub ui_language: Option<String>,
    #[serde(default)]
    pub output_language: Option<String>,
    #[serde(default)]
    pub tone: Option<String>,
    #[serde(default)]
    pub length: Option<String>,
    #[serde(default)]
    pub extra_instruction: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAssistantResponse {
    pub output: String,
    pub model: String,
    pub detected_input_language: String,
    pub effective_output_language: String,
}

pub fn validate_request(request: &PromptAssistantRequest) -> Result<(), String> {
    if request.input.trim().is_empty() {
        return Err("Input content is empty".to_string());
    }
    Ok(())
}

pub fn build_prompt_assistant_prompts(
    request: &PromptAssistantRequest,
    default_ui_locale: &str,
) -> (String, String, String, String) {
    let detected_input_locale = detect_primary_locale(&request.input);
    let ui_locale = resolve_ui_locale(request.ui_language.as_deref(), default_ui_locale);
    let effective_output_locale = resolve_output_locale(
        request.output_language.as_deref(),
        &detected_input_locale,
        &request.task_type,
        &ui_locale,
    );

    let system_prompt = build_system_prompt(request, &effective_output_locale);
    let user_prompt = build_user_prompt(request, &effective_output_locale);

    (
        system_prompt,
        user_prompt,
        detected_input_locale,
        effective_output_locale,
    )
}

fn build_system_prompt(request: &PromptAssistantRequest, output_locale: &str) -> String {
    let output_language = locale_display_name(output_locale);
    let tone_rule = tone_instruction(request.tone.as_deref());
    let length_rule = length_instruction(request.length.as_deref());
    let (task_rule, output_contract) = match request.task_type {
        PromptTaskType::Summarize => (
            "Preserve the source's reasoning order and structural skeleton. Remove ornamental wording while keeping all key facts.",
            "Return one concise paragraph. Hard cap: 300 Chinese characters or 180 English words. Avoid bullet lists unless the source itself is list-like.",
        ),
        PromptTaskType::Rewrite => (
            "Rewrite the source for better clarity and readability without changing factual meaning.",
            "Return a polished version suitable for direct reuse. Keep meaning equivalent to the source.",
        ),
        PromptTaskType::Extract => (
            "Ignore surface details and identify the underlying mechanism or core contradiction behind the source.",
            "Return exactly two sections:\n1) Core Logic/Contradiction: one sentence.\n2) Actionable Principle: one sentence starting with an imperative verb.\nDo not restate examples, anecdotes, or minor facts.",
        ),
        PromptTaskType::Translate => (
            "Translate the source faithfully. Keep names, numbers, code, and URLs unchanged unless translation is required.",
            "Return translation only, with no added explanation.",
        ),
        PromptTaskType::Reply => (
            "Draft a response that can be sent directly. Keep it relevant and actionable.",
            "Return a message ready to send as-is.",
        ),
    };

    format!(
        "You are an AI writing assistant embedded in a desktop productivity app.\n\
Task rule: {task_rule}\n\
Output contract: {output_contract}\n\
Output language: {output_language}\n\
Tone rule: {tone_rule}\n\
Length rule: {length_rule}\n\
Hard rules:\n\
- Keep all factual details that are present in the source.\n\
- Do not invent missing facts.\n\
- Keep the output directly usable.\n\
- Return only the final answer without meta commentary."
    )
}

fn build_user_prompt(request: &PromptAssistantRequest, output_locale: &str) -> String {
    let truncated_input = truncate_with_notice(&request.input, MAX_INPUT_CHARS);
    let mut sections = vec![format!("Source content:\n{}", truncated_input)];

    match request.task_type {
        PromptTaskType::Summarize => {
            sections.push(
                "Focus requirement: keep the original logic flow and compress to essential facts only."
                    .to_string(),
            );
        }
        PromptTaskType::Extract => {
            sections.push(
                "Focus requirement: do not summarize details; infer one reusable principle from the underlying logic."
                    .to_string(),
            );
        }
        _ => {}
    }

    if let Some(extra) = request.extra_instruction.as_deref().map(str::trim) {
        if !extra.is_empty() {
            sections.push(format!(
                "Additional requirement:\n{}",
                truncate_with_notice(extra, MAX_EXTRA_INSTRUCTION_CHARS)
            ));
        }
    }

    if request.task_type == PromptTaskType::Translate {
        sections.push(format!(
            "Target language: {}",
            locale_display_name(output_locale)
        ));
    }

    sections.join("\n\n")
}

fn resolve_ui_locale(requested_locale: Option<&str>, default_ui_locale: &str) -> String {
    normalize_locale_code(requested_locale)
        .or_else(|| normalize_locale_code(Some(default_ui_locale)))
        .unwrap_or_else(|| LOCALE_ZH.to_string())
}

fn resolve_output_locale(
    requested_locale: Option<&str>,
    detected_input_locale: &str,
    task_type: &PromptTaskType,
    ui_locale: &str,
) -> String {
    match normalize_locale_code(requested_locale) {
        Some(locale) if locale != LOCALE_AUTO => locale,
        _ => match task_type {
            PromptTaskType::Translate => {
                if detected_input_locale == LOCALE_ZH {
                    LOCALE_EN.to_string()
                } else if detected_input_locale == LOCALE_EN {
                    LOCALE_ZH.to_string()
                } else if ui_locale == LOCALE_ZH {
                    LOCALE_EN.to_string()
                } else {
                    LOCALE_ZH.to_string()
                }
            }
            _ => detected_input_locale.to_string(),
        },
    }
}

fn normalize_locale_code(locale: Option<&str>) -> Option<String> {
    let normalized = locale?.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if normalized == LOCALE_AUTO {
        return Some(LOCALE_AUTO.to_string());
    }
    if normalized.starts_with("zh") {
        return Some(LOCALE_ZH.to_string());
    }
    if normalized.starts_with("en") {
        return Some(LOCALE_EN.to_string());
    }
    None
}

fn detect_primary_locale(input: &str) -> String {
    let mut cjk_count = 0usize;
    let mut latin_count = 0usize;

    for ch in input.chars().take(1200) {
        if ('\u{4E00}'..='\u{9FFF}').contains(&ch) {
            cjk_count += 1;
        } else if ch.is_ascii_alphabetic() {
            latin_count += 1;
        }
    }

    if cjk_count >= latin_count {
        LOCALE_ZH.to_string()
    } else {
        LOCALE_EN.to_string()
    }
}

fn tone_instruction(tone: Option<&str>) -> &'static str {
    match tone.unwrap_or("neutral").trim().to_ascii_lowercase().as_str() {
        "professional" => "Use a professional and confident tone.",
        "friendly" => "Use a warm and friendly tone.",
        "direct" => "Be direct and concise.",
        _ => "Use a neutral, clear tone.",
    }
}

fn length_instruction(length: Option<&str>) -> &'static str {
    match length.unwrap_or("medium").trim().to_ascii_lowercase().as_str() {
        "short" => "Keep it compact, around 3-6 lines.",
        "long" => "Provide a fuller version with more context and detail.",
        _ => "Use medium length with balanced detail.",
    }
}

fn truncate_with_notice(input: &str, max_chars: usize) -> String {
    let trimmed = input.trim();
    let total_chars = trimmed.chars().count();
    if total_chars <= max_chars {
        return trimmed.to_string();
    }

    let mut result = String::with_capacity(max_chars + 64);
    for ch in trimmed.chars().take(max_chars) {
        result.push(ch);
    }
    result.push_str("\n\n[Content truncated for prompt size safety]");
    result
}

fn locale_display_name(locale: &str) -> &'static str {
    if locale.starts_with("zh") {
        "Chinese"
    } else {
        "English"
    }
}

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

struct TaskPromptProfile {
    objective: &'static str,
    differentiation_rule: &'static str,
    output_contract: String,
    user_focus_rule: Option<&'static str>,
    supports_tone: bool,
    supports_length: bool,
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
    let profile = task_profile(&request.task_type, output_locale);
    let output_language = locale_display_name(output_locale);
    let tone_rule = if profile.supports_tone {
        tone_instruction(request.tone.as_deref())
    } else {
        "Not applicable for this task."
    };
    let length_rule = if profile.supports_length {
        length_instruction(request.length.as_deref())
    } else {
        "Not applicable for this task."
    };

    format!(
        "You are an AI writing assistant embedded in a desktop productivity app.\n\
Task objective: {objective}\n\
Strict differentiation rule: {differentiation_rule}\n\
Output contract (must follow exactly):\n{output_contract}\n\
Output language: {output_language}\n\
Tone rule: {tone_rule}\n\
Length rule: {length_rule}\n\
Hard rules:\n\
- Keep all factual details that are present in the source.\n\
- Do not invent missing facts.\n\
- Keep names, numbers, code snippets, and URLs accurate.\n\
- Section headings and labels must match the output language.\n\
- Return only the final answer.\n\
- Do not output analysis about your own process.",
        objective = profile.objective,
        differentiation_rule = profile.differentiation_rule,
        output_contract = profile.output_contract,
    )
}

fn build_user_prompt(request: &PromptAssistantRequest, output_locale: &str) -> String {
    let profile = task_profile(&request.task_type, output_locale);
    let truncated_input = truncate_with_notice(&request.input, MAX_INPUT_CHARS);
    let mut sections = vec![format!("Source content:\n{}", truncated_input)];

    if let Some(focus_rule) = profile.user_focus_rule {
        sections.push(format!("Focus requirement: {}", focus_rule));
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

fn task_profile(task_type: &PromptTaskType, output_locale: &str) -> TaskPromptProfile {
    match task_type {
        PromptTaskType::Summarize => TaskPromptProfile {
            objective:
                "Preserve the source logic flow and compress it into a concise briefing for fast reuse.",
            differentiation_rule:
                "Summary must keep chronology and causal links; it is not allowed to infer hidden mechanisms.",
            output_contract: summarize_output_contract(output_locale),
            user_focus_rule: Some(
                "Keep the original reasoning order and remove ornamental wording only.",
            ),
            supports_tone: true,
            supports_length: true,
        },
        PromptTaskType::Rewrite => TaskPromptProfile {
            objective:
                "Rewrite for clarity and readability while preserving meaning and factual accuracy.",
            differentiation_rule:
                "Rewrite must stay semantically equivalent and should not convert into summary or extraction format.",
            output_contract: "Return rewritten content only.\nConstraints:\n- Keep paragraph granularity close to the original.\n- Do not add headings, labels, or commentary.".to_string(),
            user_focus_rule: Some(
                "Polish wording and structure, but keep named entities, numbers, and constraints unchanged.",
            ),
            supports_tone: true,
            supports_length: true,
        },
        PromptTaskType::Extract => TaskPromptProfile {
            objective:
                "Ignore surface details and derive the underlying mechanism, core contradiction, and executable principle.",
            differentiation_rule:
                "Extraction must not look like a summary; it must abstract and produce an action rule.",
            output_contract: extract_output_contract(output_locale),
            user_focus_rule: Some(
                "Do not summarize details; abstract the hidden mechanism and convert it to action.",
            ),
            supports_tone: true,
            supports_length: true,
        },
        PromptTaskType::Translate => TaskPromptProfile {
            objective:
                "Translate faithfully into the target language while preserving factual and technical integrity.",
            differentiation_rule:
                "Translation must not summarize, explain, or rewrite beyond language conversion.",
            output_contract: "Return translation only.\nConstraints:\n- No headings.\n- No extra explanation.\n- Keep names, numbers, URLs, and code intact unless translation is explicitly required.".to_string(),
            user_focus_rule: None,
            supports_tone: false,
            supports_length: false,
        },
        PromptTaskType::Reply => TaskPromptProfile {
            objective: "Generate directly sendable response candidates for practical communication.",
            differentiation_rule:
                "Reply generation must be actionable and conversational; it must not become summary output.",
            output_contract: reply_output_contract(output_locale),
            user_focus_rule: Some(
                "Prioritize direct usability and relevance to the source context.",
            ),
            supports_tone: true,
            supports_length: true,
        },
    }
}

fn is_zh_output_locale(output_locale: &str) -> bool {
    output_locale.starts_with("zh")
}

fn summarize_output_contract(output_locale: &str) -> String {
    if is_zh_output_locale(output_locale) {
        "使用金字塔结构（结论先行）并满足 MECE。\n输出为纯文本，不要 Markdown 标题。\n固定结构：\n1. 结论（先给最终判断，一句话）\n2. MECE 拆解（按互斥且完全穷尽分组，列出关键事实）\n3. 行动建议（给出可执行下一步）\n约束：\n- 各部分信息不重复。\n- 保留原文中的关键名称、数字、约束与时间线。\n- 不要空话，不要自我解释。".to_string()
    } else {
        "Use a Pyramid Principle structure (answer first) and keep MECE grouping.\nReturn plain text (no Markdown headings).\nRequired structure:\n1. Conclusion (one-sentence judgment first)\n2. MECE Breakdown (mutually exclusive, collectively exhaustive groups of key facts)\n3. Action Recommendation (clear next step)\nConstraints:\n- Avoid overlap across sections.\n- Preserve key names, numbers, constraints, and chronology from source.\n- No fluff, no self-referential commentary.".to_string()
    }
}

fn extract_output_contract(output_locale: &str) -> String {
    if is_zh_output_locale(output_locale) {
        "输出为纯文本，不要 Markdown 标题，不要项目符号，不要编号列表，不要代码块。\n请直接写成一小段外行也能看懂的话，依次说清：\n1. 这件事背后的关键机制是什么。\n2. 真正的核心矛盾是什么。\n3. 最值得执行的一条原则或下一步是什么。\n约束：\n- 不要复述琐碎细节、案例枝节或表面描述。\n- 可以保留关键名词，但优先用通俗表达解释清楚。\n- 整体控制在 3 到 5 句，短、直白、可执行。".to_string()
    } else {
        "Return plain text only. Do not use Markdown headings, bullet lists, numbered lists, or code blocks.\nWrite one short, non-technical paragraph that a non-expert can understand, covering in order:\n1. the key mechanism underneath the issue,\n2. the real core contradiction,\n3. the single most useful principle or next step.\nConstraints:\n- Do not recap anecdotes, minor facts, or surface details.\n- Keep important terms when necessary, but explain them in plain language.\n- Keep it to 3 to 5 sentences, concise and actionable.".to_string()
    }
}

fn reply_output_contract(output_locale: &str) -> String {
    if is_zh_output_locale(output_locale) {
        "Use this exact markdown structure:\n## 回复方案A\nMessage text\n## 回复方案B\nMessage text\n## 推荐方案\n\"A\" or \"B\" + one sentence reason\nConstraints:\n- Each option must be ready to send as-is.\n- Avoid placeholders such as \"[name]\".".to_string()
    } else {
        "Use this exact markdown structure:\n## Reply Option A\nMessage text\n## Reply Option B\nMessage text\n## Recommended\n\"A\" or \"B\" + one sentence reason\nConstraints:\n- Each option must be ready to send as-is.\n- Avoid placeholders such as \"[name]\".".to_string()
    }
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
    match tone
        .unwrap_or("neutral")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "professional" => "Use a professional and confident tone.",
        "friendly" => "Use a warm and friendly tone.",
        "direct" => "Be direct and concise.",
        _ => "Use a neutral, clear tone.",
    }
}

fn length_instruction(length: Option<&str>) -> &'static str {
    match length
        .unwrap_or("medium")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "short" => "Keep it compact and high-density.",
        "long" => "Provide fuller context and richer detail.",
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

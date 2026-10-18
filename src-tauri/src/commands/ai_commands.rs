use crate::ai::{AIConfig, AIProvider, AIService};
use crate::core::clipboard_manager::ClipboardManager;
use crate::core::models::{ClipboardItem, SearchFilters, WindowMetadata};
use crate::repository::config_repo::ConfigRepository;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

pub struct AIState {
    pub config: Arc<Mutex<AIConfig>>,
    pub config_repo: Arc<ConfigRepository>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiSearchHints {
    pub prefer_recent: Option<bool>,
    pub prefer_ocr_text: Option<bool>,
    pub prefer_note: Option<bool>,
    pub prefer_code: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiSearchPlan {
    pub goal: Option<String>,
    pub query: Option<String>,
    #[serde(default)]
    pub filters: SearchFilters,
    #[serde(default)]
    pub hints: AiSearchHints,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSearchResponse {
    pub summary: String,
    pub interpreted_query: String,
    pub interpreted_filters: SearchFilters,
    pub plan_reason: Option<String>,
    pub items: Vec<ClipboardItem>,
    pub total_candidates: usize,
    pub reranked: bool,
    pub fallback_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AiSearchRerankResult {
    pub summary: Option<String>,
    pub ordered_ids: Vec<String>,
    pub top_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct AiSearchCandidate {
    id: String,
    #[serde(rename = "type")]
    type_: String,
    content: Option<String>,
    ocr_text: Option<String>,
    user_note: Option<String>,
    tags: Vec<String>,
    source_app: Option<String>,
    created_at: i64,
    is_favorite: bool,
    is_pinned: bool,
    code_language: Option<String>,
}

fn parse_ai_json<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<T, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Empty AI response".to_string());
    }

    if let Ok(parsed) = serde_json::from_str::<T>(trimmed) {
        return Ok(parsed);
    }

    if let Some(start) = trimmed.find('{').or_else(|| trimmed.find('[')) {
        if let Some(end) = trimmed.rfind('}').or_else(|| trimmed.rfind(']')) {
            if end > start {
                let slice = &trimmed[start..=end];
                return serde_json::from_str::<T>(slice).map_err(|e| e.to_string());
            }
        }
    }

    Err("AI response is not valid JSON".to_string())
}

fn truncate_text(value: Option<&str>, max_chars: usize) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }

    let mut out = String::new();
    for ch in raw.chars().take(max_chars) {
        out.push(ch);
    }
    if raw.chars().count() > max_chars {
        out.push_str("...");
    }
    Some(out)
}

fn parse_tags(tags_json: Option<&str>) -> Vec<String> {
    let Some(json) = tags_json else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter(|tag| !tag.trim().is_empty())
        .take(8)
        .collect()
}

fn parse_source_app(metadata_json: Option<&str>) -> Option<String> {
    let metadata = metadata_json?;
    serde_json::from_str::<WindowMetadata>(metadata)
        .ok()
        .map(|value| value.source_app.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_ai_search_candidates(items: &[ClipboardItem]) -> Vec<AiSearchCandidate> {
    items
        .iter()
        .map(|item| AiSearchCandidate {
            id: item.id.clone(),
            type_: item.type_.clone(),
            content: truncate_text(item.content.as_deref(), 220),
            ocr_text: truncate_text(item.ocr_text.as_deref(), 180),
            user_note: truncate_text(item.user_note.as_deref(), 160),
            tags: parse_tags(item.tags.as_deref()),
            source_app: parse_source_app(item.metadata.as_deref()),
            created_at: item.created_at,
            is_favorite: item.is_favorite,
            is_pinned: item.is_pinned,
            code_language: truncate_text(item.code_language.as_deref(), 32),
        })
        .collect()
}

fn build_planner_system_prompt(language: &str) -> String {
    if language.starts_with("en") {
        return r#"You are an AI search planner for a clipboard manager.

Convert the user's natural language request into strict JSON only.

Rules:
1. Output JSON only. No markdown.
2. Use this shape:
{
  "goal": string | null,
  "query": string | null,
  "filters": {
    "type_filter": string | null,
    "tag_filter": string[] | null,
    "source_filter": string[] | null,
    "type_tag_filter": string[] | null,
    "date_range": { "start": number, "end": number } | null,
    "is_pinned": boolean | null,
    "is_favorite": boolean | null,
    "workbench_id": string | null,
    "require_code_language": boolean | null
  },
  "hints": {
    "prefer_recent": boolean | null,
    "prefer_ocr_text": boolean | null,
    "prefer_note": boolean | null,
    "prefer_code": boolean | null
  },
  "reason": string | null
}
3. Do not invent fields.
4. If uncertain, prefer broader recall and leave strict filters null.
5. If the user mentions code, regex, command, SQL or snippet, consider require_code_language.
6. If the user mentions image text, receipt, screenshot, invoice number or order number, prefer_ocr_text should be true.
"#.to_string();
    }

    r#"你是一个剪贴板管理器的 AI 搜索规划器。

请把用户的自然语言问题转换成严格 JSON，不要输出 markdown，不要解释。

输出结构必须是：
{
  "goal": string | null,
  "query": string | null,
  "filters": {
    "type_filter": string | null,
    "tag_filter": string[] | null,
    "source_filter": string[] | null,
    "type_tag_filter": string[] | null,
    "date_range": { "start": number, "end": number } | null,
    "is_pinned": boolean | null,
    "is_favorite": boolean | null,
    "workbench_id": string | null,
    "require_code_language": boolean | null
  },
  "hints": {
    "prefer_recent": boolean | null,
    "prefer_ocr_text": boolean | null,
    "prefer_note": boolean | null,
    "prefer_code": boolean | null
  },
  "reason": string | null
}

要求：
1. 只能使用上面这些字段，禁止自造字段。
2. 不确定时宁可放宽，不要下过窄的过滤条件。
3. 如果用户提到代码、正则、命令、SQL、代码片段，可以考虑 require_code_language。
4. 如果用户提到截图、图片里的字、订单号、发票号、OCR 文字，请把 prefer_ocr_text 设为 true。
"#.to_string()
}

fn build_planner_user_prompt(question: &str, language: &str) -> String {
    if language.starts_with("en") {
        return format!(
            "Current UI language: {language}\nUser question: {question}\nReturn JSON only."
        );
    }

    format!(
        "当前界面语言：{language}\n用户问题：{question}\n只返回 JSON。"
    )
}

fn build_rerank_system_prompt(language: &str) -> String {
    if language.starts_with("en") {
        return r#"You rerank clipboard search candidates.

Return JSON only:
{
  "summary": string | null,
  "ordered_ids": string[],
  "top_reason": string | null
}

Rules:
1. ordered_ids must only contain ids from the provided candidates.
2. Keep the list concise and sorted by relevance.
3. summary must be one short sentence.
"#.to_string();
    }

    r#"你负责对剪贴板搜索候选进行相关性重排。

只返回 JSON：
{
  "summary": string | null,
  "ordered_ids": string[],
  "top_reason": string | null
}

要求：
1. ordered_ids 只能使用候选里给出的 id。
2. 按相关性从高到低排序。
3. summary 只能是一句简短总结。
"#.to_string()
}

fn fallback_summary(language: &str, total: usize, fallback_used: &str) -> String {
    if language.starts_with("en") {
        return match fallback_used {
            "planner_failed" => format!("I used direct keyword search and found {total} candidate items."),
            "rerank_failed" => format!("I found {total} candidate items and returned the original search order."),
            _ => format!("I found {total} related items across your clipboard history."),
        };
    }

    match fallback_used {
        "planner_failed" => format!("我改用直接关键词搜索，找到了 {total} 条候选内容。"),
        "rerank_failed" => format!("我找到了 {total} 条候选内容，并按原始搜索顺序返回。"),
        _ => format!("我在你的全部剪贴板内容中找到了 {total} 条相关结果。"),
    }
}

fn reorder_items_by_ids(items: &[ClipboardItem], ordered_ids: &[String]) -> Vec<ClipboardItem> {
    let mut ordered = Vec::new();
    let mut used = std::collections::HashSet::new();

    for id in ordered_ids {
        if let Some(item) = items.iter().find(|candidate| candidate.id == *id) {
            ordered.push(item.clone());
            used.insert(id.clone());
        }
    }

    for item in items {
        if !used.contains(&item.id) {
            ordered.push(item.clone());
        }
    }

    ordered
}

#[tauri::command]
pub async fn ai_search_items(
    state: State<'_, AIState>,
    manager: State<'_, Arc<ClipboardManager>>,
    question: String,
    limit: Option<i32>,
) -> Result<AiSearchResponse, String> {
    let trimmed_question = question.trim();
    if trimmed_question.is_empty() {
        return Err("Search question is empty".to_string());
    }

    let language = state
        .config_repo
        .load_general_config()
        .await
        .ok()
        .flatten()
        .map(|c| c.language)
        .unwrap_or_else(|| "zh-CN".to_string());

    let config = state.config.lock().clone();
    if !config.enabled || config.get_current_api_key().is_empty() {
        return Err("AI not configured".to_string());
    }

    let service = AIService::new(config);
    let effective_limit = limit.unwrap_or(12).clamp(1, 24) as usize;
    let candidate_limit = std::cmp::max(50, effective_limit * 4);

    let planner_system_prompt = build_planner_system_prompt(&language);
    let planner_user_prompt = build_planner_user_prompt(trimmed_question, &language);

    let mut fallback_used = "none".to_string();
    let mut plan = match service
        .generate_structured_text(&planner_system_prompt, &planner_user_prompt, 700, 0.15)
        .await
    {
        Ok(raw) => parse_ai_json::<AiSearchPlan>(&raw).unwrap_or_else(|_| {
            fallback_used = "planner_failed".to_string();
            AiSearchPlan {
                goal: None,
                query: Some(trimmed_question.to_string()),
                filters: SearchFilters::default(),
                hints: AiSearchHints::default(),
                reason: Some("Planner JSON parse failed".to_string()),
            }
        }),
        Err(_) => {
            fallback_used = "planner_failed".to_string();
            AiSearchPlan {
                goal: None,
                query: Some(trimmed_question.to_string()),
                filters: SearchFilters::default(),
                hints: AiSearchHints::default(),
                reason: Some("Planner request failed".to_string()),
            }
        }
    };

    let interpreted_query = plan.query.clone().unwrap_or_else(|| trimmed_question.to_string());
    let mut candidates = manager
        .search_items_with_filters(&interpreted_query, plan.filters.clone(), candidate_limit)
        .await
        .map_err(|e| e.to_string())?;

    if candidates.is_empty() && (
        plan.filters.type_filter.is_some()
        || plan.filters.tag_filter.is_some()
        || plan.filters.source_filter.is_some()
        || plan.filters.type_tag_filter.is_some()
        || plan.filters.date_range.is_some()
        || plan.filters.is_pinned.is_some()
        || plan.filters.is_favorite.is_some()
        || plan.filters.workbench_id.is_some()
        || plan.filters.require_code_language.is_some()
    ) {
        fallback_used = "search_only".to_string();
        plan.filters = SearchFilters::default();
        candidates = manager
            .search_items(&interpreted_query, candidate_limit)
            .await
            .map_err(|e| e.to_string())?;
    }

    if candidates.is_empty() {
        return Ok(AiSearchResponse {
            summary: if language.starts_with("en") {
                "No related content was found in your clipboard history.".to_string()
            } else {
                "没有在你的剪贴板历史中找到相关内容。".to_string()
            },
            interpreted_query,
            interpreted_filters: plan.filters,
            plan_reason: plan.reason,
            items: Vec::new(),
            total_candidates: 0,
            reranked: false,
            fallback_used,
        });
    }

    let candidates_payload = build_ai_search_candidates(&candidates);
    let rerank_system_prompt = build_rerank_system_prompt(&language);
    let rerank_user_prompt = serde_json::json!({
        "question": trimmed_question,
        "plan": plan,
        "candidates": candidates_payload,
    })
    .to_string();

    let mut reranked = false;
    let mut summary = fallback_summary(&language, candidates.len(), &fallback_used);
    let mut ordered_items = candidates.clone();

    match service
        .generate_structured_text(&rerank_system_prompt, &rerank_user_prompt, 900, 0.2)
        .await
    {
        Ok(raw) => {
            if let Ok(result) = parse_ai_json::<AiSearchRerankResult>(&raw) {
                if !result.ordered_ids.is_empty() {
                    ordered_items = reorder_items_by_ids(&candidates, &result.ordered_ids);
                    reranked = true;
                }
                if let Some(next_summary) = result.summary {
                    let trimmed = next_summary.trim();
                    if !trimmed.is_empty() {
                        summary = trimmed.to_string();
                    }
                }
            } else {
                fallback_used = "rerank_failed".to_string();
            }
        }
        Err(_) => {
            fallback_used = "rerank_failed".to_string();
        }
    }

    ordered_items.truncate(effective_limit);

    Ok(AiSearchResponse {
        summary,
        interpreted_query,
        interpreted_filters: plan.filters,
        plan_reason: plan.reason,
        items: ordered_items,
        total_candidates: candidates.len(),
        reranked,
        fallback_used,
    })
}

#[tauri::command]
pub async fn get_ai_config(state: State<'_, AIState>) -> Result<AIConfig, String> {
    let config = state.config.lock();
    Ok(config.clone())
}

#[tauri::command]
pub async fn update_ai_config(
    state: State<'_, AIState>,
    manager: State<'_, Arc<ClipboardManager>>,
    config: AIConfig,
) -> Result<(), String> {
    // 更新内存中的配置
    {
        let mut current_config = state.config.lock();
        *current_config = config.clone();
    }

    // 同步更新 ClipboardManager 中的配置
    manager.update_ai_config(config.clone());

    // 持久化到数据库
    state
        .config_repo
        .save_ai_config(&config)
        .await
        .map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn generate_ai_tags(
    state: State<'_, AIState>,
    content: String,
) -> Result<(Vec<String>, Option<String>, Option<String>), String> {
    let config = state.config.lock().clone();

    if !config.enabled || config.get_current_api_key().is_empty() {
        return Ok((Vec::new(), None, None));
    }

    let language = state
        .config_repo
        .load_general_config()
        .await
        .ok()
        .flatten()
        .map(|c| c.language)
        .unwrap_or_else(|| "zh-CN".to_string());

    let service = AIService::new(config);
    match service.generate_tags(&content, &language).await {
        Ok(result) => Ok(result),
        Err(e) => {
            eprintln!("AI tag generation failed (silent): {}", e);
            Ok((Vec::new(), None, None))
        }
    }
}

#[tauri::command]
pub async fn test_ai_connection(
    state: State<'_, AIState>,
    config: AIConfig,
) -> Result<bool, String> {
    // 获取当前语言配置
    let language = state
        .config_repo
        .load_general_config()
        .await
        .ok()
        .flatten()
        .map(|c| c.language)
        .unwrap_or_else(|| "zh-CN".to_string());

    let service = AIService::new(config);
    match service.generate_tags("test", &language).await {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_ai_models(provider: String) -> Result<Vec<String>, String> {
    let ai_provider = match provider.as_str() {
        "SiliconFlow" => AIProvider::SiliconFlow,
        "Volcano" => AIProvider::Volcano,
        "Alibaba" => AIProvider::Alibaba,
        "OpenAI" => AIProvider::OpenAI,
        "Gemini" => AIProvider::Gemini,
        "Custom" => AIProvider::Custom {
            name: "Custom".to_string(),
            base_url: "".to_string(),
        },
        _ => return Err("Unknown provider".to_string()),
    };

    Ok(ai_provider.available_models())
}

#[tauri::command]
pub fn get_default_ai_model(provider: String) -> Result<String, String> {
    let ai_provider = match provider.as_str() {
        "SiliconFlow" => AIProvider::SiliconFlow,
        "Volcano" => AIProvider::Volcano,
        "Alibaba" => AIProvider::Alibaba,
        "OpenAI" => AIProvider::OpenAI,
        "Gemini" => AIProvider::Gemini,
        "Custom" => AIProvider::Custom {
            name: "Custom".to_string(),
            base_url: "".to_string(),
        },
        _ => return Err("Unknown provider".to_string()),
    };

    Ok(ai_provider.default_model())
}

#[tauri::command]
pub async fn fetch_remote_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    crate::ai::fetch_models(&base_url, &api_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_timeline_summary(
    state: State<'_, AIState>,
    items: Vec<crate::core::models::ClipboardItem>,
) -> Result<String, String> {
    let config = state.config.lock().clone();

    if !config.enabled {
        return Err("AI feature is disabled".to_string());
    }

    if config.get_current_api_key().is_empty() {
        return Err("AI not configured".to_string());
    }

    let language = state
        .config_repo
        .load_general_config()
        .await
        .ok()
        .flatten()
        .map(|c| c.language)
        .unwrap_or_else(|| "zh-CN".to_string());

    let service = AIService::new(config);
    service
        .generate_timeline_summary(&items, &language)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn translate_clipboard_item(
    state: State<'_, AIState>,
    manager: State<'_, Arc<ClipboardManager>>,
    item_id: String,
    target_lang: Option<String>,
) -> Result<String, String> {
    let config = state.config.lock().clone();
    if !config.enabled || config.get_current_api_key().is_empty() {
        return Err("AI is not configured or enabled".to_string());
    }

    let item = manager
        .get_item_by_id(&item_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Item not found".to_string())?;

    let content = item
        .content
        .as_deref()
        .or(item.ocr_text.as_deref())
        .ok_or_else(|| "Item has no translatable text".to_string())?;

    let source = config.auto_translate_source_lang.as_str();
    let target = target_lang
        .as_deref()
        .unwrap_or(config.auto_translate_target_lang.as_str());

    let service = AIService::new(config.clone());
    let translated = service
        .translate_text(content, source, target)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(next_metadata) = ClipboardManager::merge_translation_metadata(
        item.metadata.as_deref(),
        source,
        target,
        &translated,
        &config.get_current_model(),
    ) {
        manager
            .update_metadata(&item_id, &next_metadata)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(translated)
}

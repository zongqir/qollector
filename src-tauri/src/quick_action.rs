use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickActionItem {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub payload: String,
    pub action_type: String, // "copy" | "open_url"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickActionResult {
    pub match_type: String, // "timestamp" | "url" | "math" | "color" | "json" | "base64" | "translation"
    pub badge: String,
    pub preview: String,
    pub raw_text: String,
    pub actions: Vec<QuickActionItem>,
}

/// Analyze text for high-confidence patterns.
/// If no special pattern matches, returns None (zero interruption).
pub fn detect_quick_action(raw_input: &str) -> Option<QuickActionResult> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() || trimmed.len() > 2000 {
        return None;
    }

    // 1. Check Timestamp
    if let Some(result) = match_timestamp(trimmed) {
        return Some(result);
    }

    // 2. Check URL
    if let Some(result) = match_url(trimmed) {
        return Some(result);
    }

    // 3. Check Math expression
    if let Some(result) = match_math(trimmed) {
        return Some(result);
    }

    // 4. Check Color value
    if let Some(result) = match_color(trimmed) {
        return Some(result);
    }

    // 5. Check JSON
    if let Some(result) = match_json(trimmed) {
        return Some(result);
    }

    // 6. Check Base64
    if let Some(result) = match_base64(trimmed) {
        return Some(result);
    }

    // 7. Check Foreign word / phrase for quick translation
    if let Some(result) = match_translation(trimmed) {
        return Some(result);
    }

    None
}

// ── 1. Timestamp Matcher ──────────────────────────────────────────────────

fn match_timestamp(text: &str) -> Option<QuickActionResult> {
    // Check purely numeric timestamp (10 digits: seconds, 13 digits: milliseconds)
    if text.chars().all(|c| c.is_ascii_digit()) {
        let (seconds, is_millis) = if text.len() == 10 {
            let s: i64 = text.parse().ok()?;
            (s, false)
        } else if text.len() == 13 {
            let ms: i64 = text.parse().ok()?;
            (ms / 1000, true)
        } else {
            return None;
        };

        // Validate timestamp range: 2001-09-09 to 2100-01-01
        if !(1_000_000_000..=4_102_444_800).contains(&seconds) {
            return None;
        }

        let datetime = Local.timestamp_opt(seconds, 0).single()?;
        let formatted = datetime.format("%Y-%m-%d %H:%M:%S").to_string();
        let date_only = datetime.format("%Y-%m-%d").to_string();
        let time_only = datetime.format("%H:%M:%S").to_string();

        let badge = if is_millis {
            "毫秒时间戳".to_string()
        } else {
            "时间戳".to_string()
        };

        return Some(QuickActionResult {
            match_type: "timestamp".to_string(),
            badge,
            preview: formatted.clone(),
            raw_text: text.to_string(),
            actions: vec![
                QuickActionItem {
                    id: "copy_formatted".to_string(),
                    label: "复制时间".to_string(),
                    icon: "clock".to_string(),
                    payload: formatted,
                    action_type: "copy".to_string(),
                },
                QuickActionItem {
                    id: "copy_date".to_string(),
                    label: "仅日期".to_string(),
                    icon: "calendar".to_string(),
                    payload: date_only,
                    action_type: "copy".to_string(),
                },
                QuickActionItem {
                    id: "copy_time".to_string(),
                    label: "仅时刻".to_string(),
                    icon: "clock".to_string(),
                    payload: time_only,
                    action_type: "copy".to_string(),
                },
            ],
        });
    }

    None
}

// ── 2. URL Matcher ────────────────────────────────────────────────────────

fn match_url(text: &str) -> Option<QuickActionResult> {
    let lower = text.to_lowercase();
    let is_http = lower.starts_with("http://") || lower.starts_with("https://");
    let is_www = lower.starts_with("www.") && lower.contains('.');

    if !is_http && !is_www {
        return None;
    }

    if text.contains(' ') || text.contains('\n') || text.contains('\t') {
        return None;
    }

    let full_url = if is_www {
        format!("https://{}", text)
    } else {
        text.to_string()
    };

    // Clean tracking parameters from URL
    let clean_url = clean_tracking_params(&full_url);

    // Host preview
    let host = if let Ok(parsed) = url::Url::parse(&full_url) {
        parsed.host_str().unwrap_or("URL").to_string()
    } else {
        "URL".to_string()
    };

    let has_cleaned = clean_url != full_url;

    let mut actions = vec![QuickActionItem {
        id: "open_browser".to_string(),
        label: "打开链接".to_string(),
        icon: "external-link".to_string(),
        payload: full_url.clone(),
        action_type: "open_url".to_string(),
    }];

    if has_cleaned {
        actions.push(QuickActionItem {
            id: "copy_clean".to_string(),
            label: "复制纯净链接".to_string(),
            icon: "sparkles".to_string(),
            payload: clean_url,
            action_type: "copy".to_string(),
        });
    }

    actions.push(QuickActionItem {
        id: "copy_raw".to_string(),
        label: "复制链接".to_string(),
        icon: "copy".to_string(),
        payload: full_url,
        action_type: "copy".to_string(),
    });

    Some(QuickActionResult {
        match_type: "url".to_string(),
        badge: "链接".to_string(),
        preview: host,
        raw_text: text.to_string(),
        actions,
    })
}

fn clean_tracking_params(raw_url: &str) -> String {
    let mut url_parsed = match url::Url::parse(raw_url) {
        Ok(u) => u,
        Err(_) => return raw_url.to_string(),
    };

    let tracking_keys = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "spm",
        "spm_id_from",
        "from_source",
        "fbclid",
        "gclid",
        "ref",
        "from",
        "source",
        "feature",
        "scm",
        "vd_source",
    ];

    let query_pairs: Vec<(String, String)> = url_parsed
        .query_pairs()
        .filter(|(key, _)| {
            let k = key.to_lowercase();
            !tracking_keys
                .iter()
                .any(|tk| k == *tk || k.starts_with("utm_") || k.starts_with("spm"))
        })
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    if query_pairs.is_empty() {
        url_parsed.set_query(None);
    } else {
        url_parsed.query_pairs_mut().clear().extend_pairs(query_pairs);
    }

    url_parsed.to_string()
}

// ── 3. Math Evaluator Matcher ─────────────────────────────────────────────

fn match_math(text: &str) -> Option<QuickActionResult> {
    let expr = text.trim_end_matches('=').trim();
    if expr.len() < 3 || expr.len() > 80 {
        return None;
    }

    // Must only contain digits, operators, parens, spaces, and decimal points
    if !expr
        .chars()
        .all(|c| c.is_ascii_digit() || "+-*/%^(). ".contains(c))
    {
        return None;
    }

    // Must contain at least one arithmetic operator
    if !expr.chars().any(|c| "+-*/%^".contains(c)) {
        return None;
    }

    // Evaluate safely
    let result = evaluate_simple_math(expr)?;
    let result_str = if result.fract() == 0.0 && result.abs() < 1e15 {
        format!("{:.0}", result)
    } else {
        format!("{:.4}", result)
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    };

    let equation = format!("{} = {}", expr, result_str);

    Some(QuickActionResult {
        match_type: "math".to_string(),
        badge: "算式计算".to_string(),
        preview: format!("= {}", result_str),
        raw_text: text.to_string(),
        actions: vec![
            QuickActionItem {
                id: "copy_result".to_string(),
                label: "复制结果".to_string(),
                icon: "calculator".to_string(),
                payload: result_str,
                action_type: "copy".to_string(),
            },
            QuickActionItem {
                id: "copy_equation".to_string(),
                label: "复制等式".to_string(),
                icon: "copy".to_string(),
                payload: equation,
                action_type: "copy".to_string(),
            },
        ],
    })
}

fn evaluate_simple_math(expr: &str) -> Option<f64> {
    let tokens = tokenize_math(expr)?;
    let mut pos = 0;
    parse_expression(&tokens, &mut pos)
}

#[derive(Debug, Clone, PartialEq)]
enum MathToken {
    Num(f64),
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    LParen,
    RParen,
}

fn tokenize_math(expr: &str) -> Option<Vec<MathToken>> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }

        match c {
            '+' => {
                tokens.push(MathToken::Add);
                i += 1;
            }
            '-' => {
                tokens.push(MathToken::Sub);
                i += 1;
            }
            '*' => {
                tokens.push(MathToken::Mul);
                i += 1;
            }
            '/' => {
                tokens.push(MathToken::Div);
                i += 1;
            }
            '%' => {
                tokens.push(MathToken::Mod);
                i += 1;
            }
            '(' => {
                tokens.push(MathToken::LParen);
                i += 1;
            }
            ')' => {
                tokens.push(MathToken::RParen);
                i += 1;
            }
            _ if c.is_ascii_digit() || c == '.' => {
                let start = i;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                }
                let num_str: String = chars[start..i].iter().collect();
                let num: f64 = num_str.parse().ok()?;
                tokens.push(MathToken::Num(num));
            }
            _ => return None,
        }
    }

    if tokens.is_empty() {
        None
    } else {
        Some(tokens)
    }
}

fn parse_expression(tokens: &[MathToken], pos: &mut usize) -> Option<f64> {
    let mut left = parse_term(tokens, pos)?;

    while *pos < tokens.len() {
        match tokens[*pos] {
            MathToken::Add => {
                *pos += 1;
                let right = parse_term(tokens, pos)?;
                left += right;
            }
            MathToken::Sub => {
                *pos += 1;
                let right = parse_term(tokens, pos)?;
                left -= right;
            }
            _ => break,
        }
    }

    Some(left)
}

fn parse_term(tokens: &[MathToken], pos: &mut usize) -> Option<f64> {
    let mut left = parse_factor(tokens, pos)?;

    while *pos < tokens.len() {
        match tokens[*pos] {
            MathToken::Mul => {
                *pos += 1;
                let right = parse_factor(tokens, pos)?;
                left *= right;
            }
            MathToken::Div => {
                *pos += 1;
                let right = parse_factor(tokens, pos)?;
                if right == 0.0 {
                    return None;
                }
                left /= right;
            }
            MathToken::Mod => {
                *pos += 1;
                let right = parse_factor(tokens, pos)?;
                if right == 0.0 {
                    return None;
                }
                left %= right;
            }
            _ => break,
        }
    }

    Some(left)
}

fn parse_factor(tokens: &[MathToken], pos: &mut usize) -> Option<f64> {
    if *pos >= tokens.len() {
        return None;
    }

    match &tokens[*pos] {
        MathToken::Num(n) => {
            *pos += 1;
            Some(*n)
        }
        MathToken::Sub => {
            *pos += 1;
            let val = parse_factor(tokens, pos)?;
            Some(-val)
        }
        MathToken::Add => {
            *pos += 1;
            parse_factor(tokens, pos)
        }
        MathToken::LParen => {
            *pos += 1;
            let val = parse_expression(tokens, pos)?;
            if *pos < tokens.len() && tokens[*pos] == MathToken::RParen {
                *pos += 1;
                Some(val)
            } else {
                None
            }
        }
        _ => None,
    }
}

// ── 4. Color Matcher ──────────────────────────────────────────────────────

fn match_color(text: &str) -> Option<QuickActionResult> {
    let trimmed = text.trim();

    // Check Hex: #fff, #3b82f6, #ff000080
    if trimmed.starts_with('#') {
        let hex = &trimmed[1..];
        if [3, 4, 6, 8].contains(&hex.len()) && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            let (r, g, b, a) = parse_hex_to_rgba(hex)?;
            let rgba_str = if (a - 1.0).abs() < 1e-3 {
                format!("rgb({}, {}, {})", r, g, b)
            } else {
                format!("rgba({}, {}, {}, {:.2})", r, g, b, a)
            };
            let (h, s, l) = rgb_to_hsl(r, g, b);
            let hsl_str = format!("hsl({:.0}, {:.0}%, {:.0}%)", h, s * 100.0, l * 100.0);

            return Some(QuickActionResult {
                match_type: "color".to_string(),
                badge: "颜色代码".to_string(),
                preview: trimmed.to_uppercase(),
                raw_text: text.to_string(),
                actions: vec![
                    QuickActionItem {
                        id: "copy_hex".to_string(),
                        label: "复制 HEX".to_string(),
                        icon: "palette".to_string(),
                        payload: trimmed.to_uppercase(),
                        action_type: "copy".to_string(),
                    },
                    QuickActionItem {
                        id: "copy_rgba".to_string(),
                        label: "复制 RGB(A)".to_string(),
                        icon: "copy".to_string(),
                        payload: rgba_str,
                        action_type: "copy".to_string(),
                    },
                    QuickActionItem {
                        id: "copy_hsl".to_string(),
                        label: "复制 HSL".to_string(),
                        icon: "copy".to_string(),
                        payload: hsl_str,
                        action_type: "copy".to_string(),
                    },
                ],
            });
        }
    }

    // Check rgb(r, g, b) / rgba(r, g, b, a)
    let lower = trimmed.to_lowercase();
    if lower.starts_with("rgb(") || lower.starts_with("rgba(") {
        let inner = lower
            .trim_start_matches("rgba(")
            .trim_start_matches("rgb(")
            .trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').map(|s| s.trim()).collect();
        if parts.len() == 3 || parts.len() == 4 {
            let r: u8 = parts[0].parse().ok()?;
            let g: u8 = parts[1].parse().ok()?;
            let b: u8 = parts[2].parse().ok()?;
            let hex_str = format!("#{:02X}{:02X}{:02X}", r, g, b);
            let (h, s, l) = rgb_to_hsl(r, g, b);
            let hsl_str = format!("hsl({:.0}, {:.0}%, {:.0}%)", h, s * 100.0, l * 100.0);

            return Some(QuickActionResult {
                match_type: "color".to_string(),
                badge: "RGB 颜色".to_string(),
                preview: hex_str.clone(),
                raw_text: text.to_string(),
                actions: vec![
                    QuickActionItem {
                        id: "copy_hex".to_string(),
                        label: "转 HEX".to_string(),
                        icon: "palette".to_string(),
                        payload: hex_str,
                        action_type: "copy".to_string(),
                    },
                    QuickActionItem {
                        id: "copy_hsl".to_string(),
                        label: "转 HSL".to_string(),
                        icon: "copy".to_string(),
                        payload: hsl_str,
                        action_type: "copy".to_string(),
                    },
                ],
            });
        }
    }

    None
}

fn parse_hex_to_rgba(hex: &str) -> Option<(u8, u8, u8, f32)> {
    match hex.len() {
        3 => {
            let r = u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()?;
            let g = u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()?;
            let b = u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()?;
            Some((r, g, b, 1.0))
        }
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            Some((r, g, b, 1.0))
        }
        8 => {
            let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
            let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
            let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
            let a = u8::from_str_radix(&hex[6..8], 16).ok()? as f32 / 255.0;
            Some((r, g, b, a))
        }
        _ => None,
    }
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;

    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let delta = max - min;

    let l = (max + min) / 2.0;

    if delta == 0.0 {
        return (0.0, 0.0, l);
    }

    let s = if l > 0.5 {
        delta / (2.0 - max - min)
    } else {
        delta / (max + min)
    };

    let mut h = if max == rf {
        (gf - bf) / delta + (if gf < bf { 6.0 } else { 0.0 })
    } else if max == gf {
        (bf - rf) / delta + 2.0
    } else {
        (rf - gf) / delta + 4.0
    };

    h *= 60.0;
    (h, s, l)
}

// ── 5. JSON Matcher ───────────────────────────────────────────────────────

fn match_json(text: &str) -> Option<QuickActionResult> {
    let trimmed = text.trim();
    if !(trimmed.starts_with('{') && trimmed.ends_with('}'))
        && !(trimmed.starts_with('[') && trimmed.ends_with(']'))
    {
        return None;
    }

    let parsed: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let pretty = serde_json::to_string_pretty(&parsed).ok()?;
    let minified = serde_json::to_string(&parsed).ok()?;

    let preview = match &parsed {
        serde_json::Value::Object(map) => format!("JSON 对象 ({} 项)", map.len()),
        serde_json::Value::Array(arr) => format!("JSON 数组 ({} 项)", arr.len()),
        _ => "JSON 数据".to_string(),
    };

    Some(QuickActionResult {
        match_type: "json".to_string(),
        badge: "JSON 数据".to_string(),
        preview,
        raw_text: text.to_string(),
        actions: vec![
            QuickActionItem {
                id: "beautify_json".to_string(),
                label: "美化 JSON".to_string(),
                icon: "sparkles".to_string(),
                payload: pretty,
                action_type: "copy".to_string(),
            },
            QuickActionItem {
                id: "minify_json".to_string(),
                label: "单行压缩".to_string(),
                icon: "minimize-2".to_string(),
                payload: minified,
                action_type: "copy".to_string(),
            },
        ],
    })
}

// ── 6. Base64 Matcher ─────────────────────────────────────────────────────

fn match_base64(text: &str) -> Option<QuickActionResult> {
    let trimmed = text.trim();
    if trimmed.len() < 12 || trimmed.len() > 1000 || trimmed.len() % 4 != 0 {
        return None;
    }

    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
    {
        return None;
    }

    // Must not be plain english words
    if trimmed.chars().all(|c| c.is_ascii_alphabetic()) && trimmed.len() < 24 {
        return None;
    }

    use base64::Engine;
    let decoded_bytes = base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .ok()?;
    let decoded_text = String::from_utf8(decoded_bytes).ok()?;

    // Check that decoded text has reasonable printable characters
    if decoded_text.is_empty() || decoded_text.chars().any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t') {
        return None;
    }

    let preview = if decoded_text.len() > 30 {
        format!("{}...", &decoded_text[..30])
    } else {
        decoded_text.clone()
    };

    Some(QuickActionResult {
        match_type: "base64".to_string(),
        badge: "Base64 编码".to_string(),
        preview,
        raw_text: text.to_string(),
        actions: vec![QuickActionItem {
            id: "copy_decoded".to_string(),
            label: "复制明文".to_string(),
            icon: "copy".to_string(),
            payload: decoded_text,
            action_type: "copy".to_string(),
        }],
    })
}

// ── 7. Translation Matcher ────────────────────────────────────────────────

fn match_translation(text: &str) -> Option<QuickActionResult> {
    let trimmed = text.trim();

    // Single word or 2-4 word English phrase
    if trimmed.len() >= 2 && trimmed.len() <= 40 {
        let is_ascii_alpha = trimmed.chars().all(|c| c.is_ascii_alphabetic() || c == ' ' || c == '-');
        let word_count = trimmed.split_whitespace().count();

        if is_ascii_alpha && word_count >= 1 && word_count <= 4 {
            let encoded: String = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
            let search_url = format!("https://translate.google.com/?sl=auto&tl=zh-CN&text={}&op=translate", encoded);
            return Some(QuickActionResult {
                match_type: "translation".to_string(),
                badge: "外语翻译".to_string(),
                preview: trimmed.to_string(),
                raw_text: text.to_string(),
                actions: vec![
                    QuickActionItem {
                        id: "open_translate".to_string(),
                        label: "在线翻译".to_string(),
                        icon: "languages".to_string(),
                        payload: search_url,
                        action_type: "open_url".to_string(),
                    },
                    QuickActionItem {
                        id: "copy_word".to_string(),
                        label: "复制词汇".to_string(),
                        icon: "copy".to_string(),
                        payload: trimmed.to_string(),
                        action_type: "copy".to_string(),
                    },
                ],
            });
        }
    }

    None
}

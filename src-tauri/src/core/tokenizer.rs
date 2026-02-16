use jieba_rs::Jieba;
use once_cell::sync::Lazy;

static JIEBA: Lazy<Jieba> = Lazy::new(Jieba::new);

/// Tokenize text for FTS5 indexing: segment with jieba, join with spaces.
/// For CJK tokens longer than 1 char, also emit individual characters
/// so that single-character searches can match.
pub fn tokenize(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let words = JIEBA.cut(text, true);
    let mut tokens = Vec::new();
    for w in words {
        let w = w.trim();
        if w.is_empty() {
            continue;
        }
        tokens.push(w.to_string());
        // For multi-char CJK words, also index individual characters
        let chars: Vec<char> = w.chars().collect();
        if chars.len() > 1 && chars.iter().any(|c| is_cjk(*c)) {
            for ch in &chars {
                tokens.push(ch.to_string());
            }
        }
    }
    tokens.join(" ")
}

fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}'
        | '\u{3400}'..='\u{4DBF}'
        | '\u{F900}'..='\u{FAFF}'
    )
}

/// Tokenize a search query into an FTS5 MATCH expression.
/// Each token uses prefix matching ("token"*) so that a single character
/// like "拖" can match longer words like "拖曳" or "拖拽".
pub fn tokenize_for_query(query: &str) -> String {
    if query.is_empty() {
        return String::new();
    }
    let words = JIEBA.cut(query, true);
    let tokens: Vec<String> = words
        .into_iter()
        .filter(|w| !w.trim().is_empty())
        .map(|w| format!("\"{}\"*", w.replace('"', "\"\"")))
        .collect();
    if tokens.is_empty() {
        return String::new();
    }
    tokens.join(" AND ")
}

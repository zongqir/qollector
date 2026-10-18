use crate::core::models::ClipboardItem;

/// Check if the text is suitable for automatic background translation.
///
/// This serves as Step 1 of the auto-translation pipeline:
/// Filtering out "abnormal/non-translatable" scenarios like code snippets,
/// shell commands, URLs, file paths, variables, hashes, or mismatched languages.
pub fn should_auto_translate(text: &str, source_lang: &str, target_lang: &str) -> bool {
    let trimmed = text.trim();
    let char_count = trimmed.chars().count();

    // 1. Length bounds: between 3 and 2500 characters
    if char_count < 3 || char_count > 2500 {
        return false;
    }

    // If source and target language are the same, skip translation
    if source_lang != "auto" && normalize_lang(source_lang) == normalize_lang(target_lang) {
        return false;
    }

    // 2. URL, link, or path checks
    if ClipboardItem::is_url(trimmed) {
        return false;
    }
    if is_likely_link_or_email(trimmed) {
        return false;
    }
    if is_likely_file_path(trimmed) {
        return false;
    }

    // 3. Structured data (JSON, XML, HTML, SQL)
    if is_structured_data(trimmed) {
        return false;
    }

    // 4. Shell commands and code snippets
    if is_shell_command(trimmed) {
        return false;
    }
    if is_code_snippet(trimmed) {
        return false;
    }

    // 5. Single identifiers (camelCase, snake_case, screaming snake, uuid, hex, etc.)
    if is_code_identifier_or_hash(trimmed) {
        return false;
    }

    // 6. Language matching
    is_source_language_matched(trimmed, source_lang, target_lang)
}

fn normalize_lang(lang: &str) -> &str {
    let lower = lang.trim();
    if lower.starts_with("zh") {
        "zh"
    } else if lower.starts_with("en") {
        "en"
    } else if lower.starts_with("ja") {
        "ja"
    } else if lower.starts_with("ko") {
        "ko"
    } else {
        lower
    }
}

fn is_likely_link_or_email(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("ftp://")
        || lower.starts_with("file://")
        || lower.starts_with("ssh://")
        || lower.starts_with("mailto:")
        || lower.starts_with("git@")
    {
        return true;
    }

    // Check if it's an email address (single token containing @ and dot)
    if !text.contains(char::is_whitespace) && text.contains('@') {
        let parts: Vec<&str> = text.split('@').collect();
        if parts.len() == 2 && parts[1].contains('.') {
            return true;
        }
    }

    false
}

fn is_likely_file_path(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return false;
    }

    // Windows drive path: e.g. C:\Users\... or C:/Users/...
    if trimmed.len() >= 3 {
        let bytes = trimmed.as_bytes();
        if bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
            return true;
        }
    }

    // UNC path \\server\share
    if trimmed.starts_with("\\\\") {
        return true;
    }

    // Unix absolute system path: /usr/..., /etc/..., /var/..., /home/..., /Applications/...
    if trimmed.starts_with('/') {
        let common_unix_dirs = [
            "/bin/", "/usr/", "/etc/", "/var/", "/home/", "/opt/", "/tmp/",
            "/dev/", "/sys/", "/proc/", "/Users/", "/Applications/", "/Library/",
        ];
        if common_unix_dirs.iter().any(|dir| trimmed.starts_with(dir)) {
            return true;
        }
    }

    // Common file path with extension and no spaces: e.g. foo/bar/baz.js or ./src/main.rs
    if !trimmed.contains(char::is_whitespace) && (trimmed.contains('/') || trimmed.contains('\\')) {
        let extensions = [
            ".exe", ".dll", ".so", ".dylib", ".png", ".jpg", ".jpeg", ".gif",
            ".zip", ".tar", ".gz", ".7z", ".iso", ".pdf", ".txt", ".md",
            ".rs", ".js", ".ts", ".jsx", ".tsx", ".py", ".go", ".c", ".cpp", ".h",
        ];
        if extensions.iter().any(|ext| trimmed.ends_with(ext)) {
            return true;
        }
    }

    false
}

fn is_structured_data(text: &str) -> bool {
    let trimmed = text.trim();

    // Check JSON object or array
    if (trimmed.starts_with('{') && trimmed.ends_with('}'))
        || (trimmed.starts_with('[') && trimmed.ends_with(']'))
    {
        if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
            return true;
        }
    }

    // Check XML/HTML tag blocks
    if trimmed.starts_with('<') && trimmed.ends_with('>') {
        if trimmed.contains("</") || trimmed.contains("/>") {
            return true;
        }
    }

    // Check SQL queries
    let first_word = trimmed.split_whitespace().next().unwrap_or("").to_ascii_uppercase();
    if matches!(
        first_word.as_str(),
        "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "CREATE" | "DROP" | "ALTER" | "TRUNCATE"
    ) {
        let upper = trimmed.to_ascii_uppercase();
        if upper.contains(" FROM ")
            || upper.contains(" INTO ")
            || upper.contains(" TABLE ")
            || upper.contains(" SET ")
            || upper.contains(" WHERE ")
        {
            return true;
        }
    }

    false
}

fn is_shell_command(text: &str) -> bool {
    let trimmed = text.trim();
    let mut words = trimmed.split_whitespace();
    let first = match words.next() {
        Some(w) => w.to_ascii_lowercase(),
        None => return false,
    };

    let common_cli = [
        "git", "npm", "pnpm", "yarn", "bun", "cargo", "rustc", "docker",
        "kubectl", "curl", "wget", "ssh", "scp", "sudo", "apt", "yum",
        "pacman", "brew", "pip", "python", "node", "grep", "awk", "sed",
        "chmod", "chown", "systemctl", "journalctl", "cat", "cd", "mkdir",
        "rm", "ps", "kill", "touch", "ls", "echo",
    ];

    if common_cli.contains(&first.as_str()) {
        // If it starts with a CLI command and either has command flags (-x, --xx) or multiple CLI-like args
        let rest: Vec<&str> = words.collect();
        if rest.iter().any(|w| w.starts_with('-')) {
            return true;
        }
        if matches!(first.as_str(), "git" | "docker" | "cargo" | "npm" | "pnpm" | "yarn") && !rest.is_empty() {
            return true;
        }
    }

    false
}

fn is_code_snippet(text: &str) -> bool {
    let trimmed = text.trim();

    // Check code statements
    let code_signatures = [
        "import ", "from \"", "from '", "export default", "export const",
        "package ", "fn ", "pub fn ", "impl ", "struct ", "enum ",
        "pub struct ", "def ", "class ", "public static void", "private ",
        "protected ", "console.log(", "println!(", "fmt.Println(",
        "#include <", "#include \"", "use std::", "const ", "let mut ",
    ];

    for sig in &code_signatures {
        if trimmed.contains(sig) {
            return true;
        }
    }

    // Check code punctuation ratio
    let mut symbol_count = 0usize;
    let mut total_count = 0usize;

    for ch in trimmed.chars() {
        if !ch.is_whitespace() {
            total_count += 1;
            if matches!(
                ch,
                '{' | '}' | '(' | ')' | ';' | '[' | ']' | '=' | '<' | '>' | '&' | '|' | '!' | '~' | '^'
            ) {
                symbol_count += 1;
            }
        }
    }

    if total_count >= 10 && (symbol_count as f32 / total_count as f32) > 0.18 {
        return true;
    }

    false
}

fn is_code_identifier_or_hash(text: &str) -> bool {
    let trimmed = text.trim();

    // Only inspect single-token strings (no spaces)
    if trimmed.contains(char::is_whitespace) {
        return false;
    }

    let len = trimmed.len();

    // UUID check: 36 characters with dashes at 8, 13, 18, 23
    if len == 36 && trimmed.chars().filter(|c| *c == '-').count() == 4 {
        if uuid::Uuid::parse_str(trimmed).is_ok() {
            return true;
        }
    }

    // Long pure hex string / MD5 / SHA-256 (>= 16 hex chars)
    if len >= 16 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return true;
    }

    // Base64 hash pattern
    if len >= 20 && (trimmed.ends_with('=') || trimmed.ends_with("==")) {
        if trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=') {
            return true;
        }
    }

    // Pure digits / numeric code
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }

    // Check camelCase (e.g. getUserProfile, isAuthorized)
    // Has at least one lowercase letter, followed by an uppercase letter, no spaces, all ascii alphabetic
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.iter().all(|c| c.is_ascii_alphabetic()) {
        let mut has_lower = false;
        let mut has_upper = false;
        let mut has_transition = false;
        for i in 0..chars.len() {
            if chars[i].is_ascii_lowercase() {
                has_lower = true;
            } else if chars[i].is_ascii_uppercase() {
                has_upper = true;
                if i > 0 && chars[i - 1].is_ascii_lowercase() {
                    has_transition = true;
                }
            }
        }
        if has_lower && has_upper && has_transition {
            return true;
        }
    }

    // Check snake_case (e.g. user_session_token) or kebab-case (e.g. user-session-token)
    if (trimmed.contains('_') || trimmed.contains('-'))
        && chars.iter().all(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
    {
        return true;
    }

    // SCREAMING_SNAKE_CASE (e.g. MAX_BUFFER_SIZE)
    if chars.iter().all(|c| c.is_ascii_uppercase() || *c == '_' || c.is_ascii_digit())
        && trimmed.contains('_')
    {
        return true;
    }

    false
}

fn is_source_language_matched(text: &str, source_lang: &str, target_lang: &str) -> bool {
    let mut cjk_count = 0usize;
    let mut latin_count = 0usize;
    let mut total_alpha = 0usize;

    for ch in text.chars().take(800) {
        if ('\u{4E00}'..='\u{9FFF}').contains(&ch)
            || ('\u{3400}'..='\u{4DBF}').contains(&ch)
            || ('\u{F900}'..='\u{FAFF}').contains(&ch)
        {
            cjk_count += 1;
            total_alpha += 1;
        } else if ch.is_ascii_alphabetic() {
            latin_count += 1;
            total_alpha += 1;
        }
    }

    let norm_source = normalize_lang(source_lang);
    let norm_target = normalize_lang(target_lang);

    match norm_source {
        "en" => {
            // Must have sufficient Latin characters
            if latin_count < 3 {
                return false;
            }
            // Must not be predominantly Chinese (CJK ratio < 15%)
            if cjk_count > 0 && (cjk_count as f32 / total_alpha as f32) > 0.15 {
                return false;
            }
            true
        }
        "zh" => {
            // Must have sufficient Chinese characters
            if cjk_count < 2 {
                return false;
            }
            // CJK characters should be significant
            if (cjk_count as f32 / total_alpha.max(1) as f32) < 0.25 {
                return false;
            }
            true
        }
        "auto" => {
            // If text is primarily CJK and target is zh, reject
            if cjk_count >= latin_count && norm_target == "zh" {
                return false;
            }
            // If text is primarily Latin and target is en, reject
            if latin_count > cjk_count && norm_target == "en" {
                return false;
            }
            total_alpha >= 3
        }
        _ => {
            // For other languages, ensure there are enough alphabetic characters
            total_alpha >= 3
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_english_sentences() {
        assert!(should_auto_translate(
            "The quick brown fox jumps over the lazy dog.",
            "en",
            "zh-CN"
        ));
        assert!(should_auto_translate(
            "Connection established with remote cluster successfully.",
            "en",
            "zh-CN"
        ));
        // Single English dictionary word lookup
        assert!(should_auto_translate("phenomenon", "en", "zh-CN"));
        assert!(should_auto_translate("abandon", "en", "zh-CN"));
    }

    #[test]
    fn test_skip_code_snippets() {
        assert!(!should_auto_translate(
            "const [state, setState] = useState(null);",
            "en",
            "zh-CN"
        ));
        assert!(!should_auto_translate(
            "import { useState } from 'react';",
            "en",
            "zh-CN"
        ));
        assert!(!should_auto_translate(
            "pub fn calculate_hash(data: &[u8]) -> String {",
            "en",
            "zh-CN"
        ));
        assert!(!should_auto_translate(
            "def process_item(item_id: str):",
            "en",
            "zh-CN"
        ));
    }

    #[test]
    fn test_skip_commands() {
        assert!(!should_auto_translate("git commit -m \"fix: issue\"", "en", "zh-CN"));
        assert!(!should_auto_translate("npm run build", "en", "zh-CN"));
        assert!(!should_auto_translate("docker run -d -p 80:80 nginx", "en", "zh-CN"));
        assert!(!should_auto_translate("cargo test --release", "en", "zh-CN"));
    }

    #[test]
    fn test_skip_urls_and_paths() {
        assert!(!should_auto_translate("https://github.com/zongqir/qollector", "en", "zh-CN"));
        assert!(!should_auto_translate("C:\\Users\\admin\\AppData\\Local", "en", "zh-CN"));
        assert!(!should_auto_translate("/var/log/nginx/access.log", "en", "zh-CN"));
        assert!(!should_auto_translate("support@example.com", "en", "zh-CN"));
    }

    #[test]
    fn test_skip_identifiers_and_hashes() {
        assert!(!should_auto_translate("getUserProfile", "en", "zh-CN"));
        assert!(!should_auto_translate("user_auth_token", "en", "zh-CN"));
        assert!(!should_auto_translate("MAX_BUFFER_SIZE", "en", "zh-CN"));
        assert!(!should_auto_translate("550e8400-e29b-41d4-a716-446655440000", "en", "zh-CN"));
        assert!(!should_auto_translate("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "en", "zh-CN"));
    }

    #[test]
    fn test_skip_chinese_when_expecting_english() {
        assert!(!should_auto_translate(
            "这是一段中文文本，不需要当成英文来翻译",
            "en",
            "zh-CN"
        ));
    }
}

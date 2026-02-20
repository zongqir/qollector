fn sanitize_file_stem(input: &str) -> String {
    let trimmed = input.trim();
    let mut sanitized = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            sanitized.push(ch);
        } else if ch.is_whitespace() {
            sanitized.push('_');
        }
    }
    let compact = sanitized
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_");
    if compact.is_empty() {
        "clipbox_collection".to_string()
    } else {
        compact
    }
}

#[tauri::command]
pub async fn export_collection_text(
    default_name: Option<String>,
    content: String,
    format: Option<String>,
) -> Result<String, String> {
    let normalized_format = format
        .unwrap_or_else(|| "markdown".to_string())
        .to_lowercase();
    let (ext, filter_name) = if normalized_format == "text" || normalized_format == "txt" {
        ("txt", "Text")
    } else {
        ("md", "Markdown")
    };

    let base_name = sanitize_file_stem(default_name.as_deref().unwrap_or("clipbox_collection"));
    let file_name = format!("{}.{}", base_name, ext);

    let save_path = rfd::FileDialog::new()
        .set_file_name(&file_name)
        .add_filter(filter_name, &[ext])
        .save_file()
        .ok_or_else(|| "CANCELLED".to_string())?;

    std::fs::write(&save_path, content)
        .map_err(|error| format!("Failed to write export file: {}", error))?;

    Ok(save_path.to_string_lossy().to_string())
}

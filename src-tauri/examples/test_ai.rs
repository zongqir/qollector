use std::collections::HashMap;
use clipbox::ai::{AIConfig, AICredentials, AIProvider, AIService};

#[tokio::main]
async fn main() {
    let mut credentials = HashMap::new();
    credentials.insert(
        "siliconflow".to_string(),
        AICredentials::new(
            "sk-your-api-key-here".to_string(),
            "Qwen/Qwen2.5-7B-Instruct".to_string(),
        ),
    );

    let config = AIConfig {
        current_provider: AIProvider::SiliconFlow,
        credentials,
        enabled: true,
        custom_prompt: None,
    };

    let service = AIService::new(config);

    let test_content =
        "Learned Rust programming language, built a clipboard manager with Tauri and React";

    println!("Test content: {}", test_content);
    println!("Generating tags...\n");

    match service.generate_tags(test_content, "en").await {
        Ok((tags, summary)) => {
            println!("Generated tags:");
            for tag in tags {
                println!("  - {}", tag);
            }
            if let Some(s) = summary {
                println!("Summary: {}", s);
            }
        }
        Err(e) => {
            eprintln!("Error: {}", e);
        }
    }
}

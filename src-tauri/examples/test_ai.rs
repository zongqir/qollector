use clipbox::ai::{AIConfig, AIProvider, AIService};

#[tokio::main]
async fn main() {
    let config = AIConfig {
        provider: AIProvider::SiliconFlow,
        api_key: "sk-huvjsuypfcuzqzolhjmccmjfcwzotwxqojwcvdwpxlyohqrp".to_string(),
        model: "Qwen/Qwen2.5-7B-Instruct".to_string(),
        enabled: true,
    };

    let service = AIService::new(config);

    let test_content = "今天学习了 Rust 编程语言，实现了一个剪贴板管理器，使用了 Tauri 框架和 React 前端";

    println!("测试内容: {}", test_content);
    println!("正在生成标签...\n");

    match service.generate_tags(test_content).await {
        Ok(tags) => {
            println!("生成的标签:");
            for tag in tags {
                println!("  - {}", tag);
            }
        }
        Err(e) => {
            eprintln!("错误: {}", e);
        }
    }
}

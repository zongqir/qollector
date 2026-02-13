use reqwest;
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose};

#[derive(Debug, Serialize)]
struct ImageContent {
    #[serde(rename = "type")]
    content_type: String,
    image_url: ImageUrl,
}

#[derive(Debug, Serialize)]
struct ImageUrl {
    url: String,
}

#[derive(Debug, Serialize)]
struct TextContent {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum MessageContent {
    Text(TextContent),
    Image(ImageContent),
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: Vec<MessageContent>,
}

#[derive(Debug, Serialize)]
struct OcrRequest {
    model: String,
    messages: Vec<Message>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Debug, Deserialize)]
struct OcrResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 创建一个简单的测试图片（1x1 白色像素）
    let test_image = vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82,
    ];

    let image_base64 = general_purpose::STANDARD.encode(&test_image);
    let data_url = format!("data:image/png;base64,{}", image_base64);

    let request = OcrRequest {
        model: "Pro/Qwen/Qwen2-VL-7B-Instruct".to_string(),
        messages: vec![Message {
            role: "user".to_string(),
            content: vec![
                MessageContent::Text(TextContent {
                    content_type: "text".to_string(),
                    text: "请识别图片中的所有文字，直接返回文字内容，不要添加任何解释或格式。如果图片中没有文字，返回空字符串。".to_string(),
                }),
                MessageContent::Image(ImageContent {
                    content_type: "image_url".to_string(),
                    image_url: ImageUrl { url: data_url },
                }),
            ],
        }],
        max_tokens: 2000,
        temperature: 0.0,
    };

    let api_key = "sk-huvjsuypfcuzqzolhjmccmjfcwzotwxqojwcvdwpxlyohqrp";
    let url = "https://api.siliconflow.cn/v1/chat/completions";

    println!("发送请求到: {}", url);
    println!("使用模型: Pro/Qwen/Qwen2-VL-7B-Instruct");

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await?;

    let status = response.status();
    println!("响应状态: {}", status);

    let response_text = response.text().await?;
    println!("响应内容: {}", response_text);

    if status.is_success() {
        let ocr_response: OcrResponse = serde_json::from_str(&response_text)?;
        if let Some(choice) = ocr_response.choices.first() {
            println!("\n✓ OCR 识别成功!");
            println!("识别结果: {}", choice.message.content);
        }
    } else {
        println!("\n✗ API 调用失败");
    }

    Ok(())
}

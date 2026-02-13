# OCR 模块设计文档

## 架构概览

OCR 模块采用抽象接口设计，支持本地和云端多种 OCR 提供者。

```
OcrService (统一入口)
    ↓
OcrProvider (抽象接口)
    ↓
├── LocalOcr (本地 Tesseract)
├── DeepSeekOcr (DeepSeek 视觉模型)
├── AliyunOcr (阿里云 OCR) [待实现]
├── TencentOcr (腾讯云 OCR) [待实现]
└── BaiduOcr (百度 OCR) [待实现]
```

## 核心组件

### 1. OcrProvider Trait

所有 OCR 实现必须实现此接口：

```rust
#[async_trait]
pub trait OcrProvider: Send + Sync {
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError>;
    async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError>;
    fn provider_name(&self) -> &str;
    async fn is_available(&self) -> bool;
}
```

### 2. OcrService

统一服务入口，根据配置自动选择提供者：

```rust
let config = OcrConfig {
    enabled: true,
    provider: OcrProviderType::DeepSeek,
    api_key: Some("sk-xxx".to_string()),
    language: "chi_sim+eng".to_string(),
    auto_ocr: true,
    ..Default::default()
};

let service = OcrService::new(config)?;
let result = service.recognize("/path/to/image.png").await?;
println!("识别结果: {}", result.text);
```

### 3. OcrConfig

配置结构：

```rust
pub struct OcrConfig {
    pub enabled: bool,              // 是否启用 OCR
    pub provider: OcrProviderType,  // 提供者类型
    pub api_key: Option<String>,    // API 密钥
    pub api_secret: Option<String>, // API 密钥（部分提供者需要）
    pub language: String,           // 识别语言（本地 OCR）
    pub auto_ocr: bool,            // 是否自动识别
}
```

### 4. OcrProviderType

支持的提供者：

```rust
pub enum OcrProviderType {
    Local,                                    // 本地 Tesseract
    DeepSeek,                                 // DeepSeek OCR
    Aliyun,                                   // 阿里云 OCR
    Tencent,                                  // 腾讯云 OCR
    Baidu,                                    // 百度 OCR
    Custom { name: String, base_url: String } // 自定义提供者
}
```

## Tauri 命令

### 初始化 OCR 服务

```javascript
await invoke('init_ocr_service', {
  config: {
    enabled: true,
    provider: 'DeepSeek',
    api_key: 'sk-xxx',
    language: 'chi_sim+eng',
    auto_ocr: true
  }
});
```

### 获取配置

```javascript
const config = await invoke('get_ocr_config');
```

### 更新配置

```javascript
await invoke('update_ocr_config', {
  config: {
    enabled: true,
    provider: 'Local',
    language: 'chi_sim+eng',
    auto_ocr: true
  }
});
```

### 识别图片

```javascript
const text = await invoke('recognize_image', {
  image_path: '/path/to/image.png'
});
```

### 识别并更新数据库

```javascript
const text = await invoke('recognize_and_update', {
  item_id: 'uuid-xxx',
  image_path: '/path/to/image.png'
});
```

### 检查服务可用性

```javascript
const available = await invoke('check_ocr_available');
```

### 获取支持的提供者列表

```javascript
const providers = await invoke('get_ocr_providers');
// ['本地 Tesseract', 'DeepSeek OCR', '阿里云 OCR', ...]
```

## 数据库支持

数据库已预留 `ocr_text` 字段：

```sql
CREATE TABLE clipboard_items (
    ...
    ocr_text TEXT,
    ...
);
```

搜索功能已支持 OCR 文本：

```sql
SELECT * FROM clipboard_items
WHERE content LIKE '%query%' OR ocr_text LIKE '%query%';
```

## 实现状态

### ✅ 已完成

- [x] 抽象接口设计 (OcrProvider)
- [x] 服务统一入口 (OcrService)
- [x] DeepSeek OCR 实现
- [x] 本地 OCR 框架（待实现具体逻辑）
- [x] Tauri 命令集成
- [x] 数据库支持
- [x] 错误处理

### 🚧 待实现

- [ ] 本地 Tesseract OCR 具体实现
  - 需要添加依赖：`tesseract-rs` 或 `rusty-tesseract`
  - 需要系统安装 Tesseract
- [ ] 阿里云 OCR
- [ ] 腾讯云 OCR
- [ ] 百度 OCR
- [ ] 自动 OCR（图片捕获后自动识别）
- [ ] 批量 OCR（对历史图片批量识别）
- [ ] 前端 UI 集成

## DeepSeek OCR 使用示例

DeepSeek OCR 使用视觉模型进行文字识别：

```rust
let ocr = DeepSeekOcr::new(
    "sk-your-api-key".to_string(),
    Some("https://api.deepseek.com/v1".to_string())
);

let result = ocr.recognize("/path/to/image.png").await?;
println!("识别文本: {}", result.text);
println!("提供者: {}", result.provider);
```

API 请求格式：

```json
{
  "model": "deepseek-chat",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "请识别图片中的所有文字，直接返回文字内容，不要添加任何解释或格式。"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,..."
          }
        }
      ]
    }
  ],
  "max_tokens": 2000,
  "temperature": 0.0
}
```

## 本地 OCR 实现指南

要实现本地 Tesseract OCR，需要：

1. 添加依赖到 `Cargo.toml`：

```toml
tesseract = "0.14"  # 或 rusty-tesseract = "1.1"
```

2. 在 `local.rs` 中实现：

```rust
use tesseract::Tesseract;

async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
    let text = Tesseract::new(None, Some(&self.language))
        .set_image(image_path)
        .get_text()
        .map_err(|e| OcrError::EngineError(e.to_string()))?;

    Ok(OcrResult::new(text, "本地 Tesseract".to_string()))
}
```

3. 确保系统已安装 Tesseract：
   - Windows: `choco install tesseract`
   - macOS: `brew install tesseract`
   - Linux: `apt install tesseract-ocr`

## 扩展新的 OCR 提供者

1. 创建新文件 `src/ocr/your_provider.rs`
2. 实现 `OcrProvider` trait
3. 在 `OcrProviderType` 中添加新类型
4. 在 `OcrService::create_provider` 中添加创建逻辑

示例：

```rust
// src/ocr/aliyun.rs
pub struct AliyunOcr {
    access_key: String,
    access_secret: String,
    endpoint: String,
}

#[async_trait]
impl OcrProvider for AliyunOcr {
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        // 实现阿里云 OCR API 调用
        todo!()
    }

    // ... 其他方法
}
```

## 错误处理

```rust
pub enum OcrError {
    RequestError(reqwest::Error),  // HTTP 请求错误
    ApiError(String),              // API 返回错误
    ConfigError(String),           // 配置错误
    ImageError(String),            // 图片处理错误
    EngineError(String),           // OCR 引擎错误
    IoError(std::io::Error),       // IO 错误
}
```

## 性能考虑

1. **异步处理**：所有 OCR 操作都是异步的，不会阻塞主线程
2. **克隆服务**：OcrService 实现了 Clone，可以在多个任务间共享
3. **锁管理**：在 await 前释放锁，避免死锁
4. **图片缓存**：图片已存储在文件系统，无需重复读取

## 安全考虑

1. **API 密钥**：敏感信息存储在配置中，不应硬编码
2. **图片隐私**：本地 OCR 不会上传图片到云端
3. **错误信息**：不在错误消息中泄露敏感信息

## 未来优化

1. **缓存机制**：对已识别的图片缓存结果
2. **置信度**：返回识别置信度，低置信度可提示用户
3. **语言检测**：自动检测图片中的语言
4. **区域识别**：支持识别图片中特定区域
5. **格式保留**：保留文本的格式和布局

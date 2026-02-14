# HTTP 请求超时修复

## 问题描述

用户反馈在设置页面点击"测试"按钮后，界面一直显示"测试中"状态，无法完成测试。

## 原因分析

HTTP 客户端没有设置超时时间，当网络有问题或 API 不可达时，请求会一直等待，导致：
1. 前端界面卡在"测试中"状态
2. 用户无法得到反馈
3. 无法判断是网络问题还是配置错误

## 解决方案

为所有 HTTP 客户端添加超时设置：

### AI 服务 (`src-tauri/src/ai/mod.rs`)

```rust
let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))      // 总超时 30 秒
    .connect_timeout(std::time::Duration::from_secs(10))  // 连接超时 10 秒
    .build()
    .unwrap_or_else(|_| reqwest::Client::new());
```

### OCR 服务

**硅基流动 OCR** (`src-tauri/src/ocr/siliconflow.rs`)
```rust
let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(60))      // OCR 需要更长时间
    .connect_timeout(std::time::Duration::from_secs(10))
    .build()
    .unwrap_or_else(|_| reqwest::Client::new());
```

**DeepSeek OCR** (`src-tauri/src/ocr/deepseek.rs`)
```rust
let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(60))
    .connect_timeout(std::time::Duration::from_secs(10))
    .build()
    .unwrap_or_else(|_| reqwest::Client::new());
```

## 超时时间说明

- **连接超时 (connect_timeout)**: 10 秒
  - 建立 TCP 连接的最大等待时间
  - 如果 10 秒内无法连接到服务器，立即返回错误

- **总超时 (timeout)**:
  - AI 服务: 30 秒（标签生成通常很快）
  - OCR 服务: 60 秒（图像识别需要更长时间）
  - 包括连接、发送请求、接收响应的总时间

## 用户体验改进

1. **快速失败**: 网络问题时不再无限等待
2. **明确反馈**: 超时后会显示错误信息
3. **可重试**: 用户可以修改配置后重新测试

## 测试建议

1. **正常情况**: 配置正确的 API Key，测试应该在几秒内完成
2. **错误 API Key**: 应该快速返回认证失败错误
3. **网络问题**: 最多等待 10-60 秒后返回超时错误
4. **无效 URL**: 连接超时 10 秒后返回错误

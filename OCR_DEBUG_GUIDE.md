# OCR 功能调试指南

## 问题诊断

当你在设置中选择"硅基流动 OCR"并填写 API Key 后点击测试，如果显示"OCR 服务不可用"，请按以下步骤排查：

## 调试步骤

### 1. 启动应用并查看日志

```bash
cd D:\code\pith
cargo tauri dev
```

### 2. 打开设置页面

点击应用中的设置按钮

### 3. 配置 OCR

- 选择"OCR 识别"标签
- 确保"启用 OCR 识别"已勾选
- OCR 提供商选择"硅基流动 OCR"
- 填写 API Key: `sk-huvjsuypfcuzqzolhjmccmjfcwzotwxqojwcvdwpxlyohqrp`

### 4. 点击"测试连接"按钮

查看控制台输出，应该看到类似以下日志：

```
收到 OCR 配置更新请求:
  enabled: true
  provider: SiliconFlow
  api_key: Some("sk-huvjsuy...")
  language: chi_sim+eng
  auto_ocr: true
OCR 配置更新成功
检查 OCR 服务可用性
硅基流动 OCR 可用性检查: true
  API Key 长度: 52
  Base URL: https://api.siliconflow.cn/v1
  Model: Qwen/Qwen2-VL-72B-Instruct
OCR 服务可用性: true
提供商: 硅基流动 OCR
```

### 5. 如果显示"不可用"

检查日志中的以下信息：

#### 情况 1: API Key 为空
```
硅基流动 OCR 可用性检查: false
  API Key 长度: 0
```
**解决方案**: 确保在设置中正确填写了 API Key

#### 情况 2: 配置未保存
```
OCR 服务未初始化
```
**解决方案**: 点击"保存"按钮后再测试

#### 情况 3: Provider 类型错误
```
Failed to update OCR config: 硅基流动 API key is required
```
**解决方案**: 检查前端发送的 provider 字段格式

## 测试实际 OCR 功能

### 方法 1: 通过应用界面

1. 复制一张包含文字的图片到剪贴板
2. 在应用中找到该图片
3. 点击"🔍 识别文字"按钮
4. 查看控制台日志：

```
调用硅基流动 OCR API: https://api.siliconflow.cn/v1/chat/completions
使用模型: Qwen/Qwen2-VL-72B-Instruct
API 响应状态: 200
API 响应内容: {...}
OCR 识别结果: [识别出的文字]
```

### 方法 2: 使用测试文件

打开 `test_ocr.html` 在浏览器中测试（需要应用运行）

## 常见错误及解决方案

### 错误 1: "Model disabled"
```json
{"code":30003,"message":"Model disabled.","data":null}
```
**原因**: 模型被禁用或不可用
**解决方案**: 已修改为使用 `Qwen/Qwen2-VL-72B-Instruct`

### 错误 2: "Model does not exist"
```json
{"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
```
**原因**: 模型名称错误
**解决方案**: 检查模型名称拼写

### 错误 3: "Unable to process the image"
```json
{"code":20040,"message":"Unable to process the image","data":null}
```
**原因**: 图片格式或尺寸问题
**解决方案**: 确保图片至少 28x28 像素

### 错误 4: "height or width must be larger than 28"
```json
{"code":20015,"message":"height(1) or width(1) must be larger than 28 for Qwen VL models.","data":null}
```
**原因**: 图片太小
**解决方案**: 使用更大的图片

## 配置文件位置

OCR 配置保存在应用数据目录中，路径类似：
```
C:\Users\[用户名]\AppData\Roaming\com.clipbox.dev\
```

## 手动测试 API

使用 curl 直接测试 API：

```bash
curl -X POST "https://api.siliconflow.cn/v1/chat/completions" \
  -H "Authorization: Bearer sk-huvjsuypfcuzqzolhjmccmjfcwzotwxqojwcvdwpxlyohqrp" \
  -H "Content-Type: application/json" \
  -d @test_request.json
```

## 下一步

如果按照以上步骤仍然无法解决问题，请提供：
1. 完整的控制台日志输出
2. 点击测试按钮时的具体错误信息
3. 网络请求的详细信息（如果有）

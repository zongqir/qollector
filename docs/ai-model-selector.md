# AI 模型自动选择功能

## 功能概述

现在不需要手动输入模型名称了！系统会根据选择的 AI 供应商自动加载可用的模型列表，用户只需从下拉菜单中选择即可。

## 支持的供应商和模型

### 硅基流动 (SiliconFlow)
- Qwen/Qwen2.5-7B-Instruct（默认）
- Qwen/Qwen2.5-14B-Instruct
- Qwen/Qwen2.5-32B-Instruct
- Qwen/Qwen2.5-72B-Instruct
- deepseek-ai/DeepSeek-V2.5
- THUDM/glm-4-9b-chat

### 火山引擎 (Volcano)
- doubao-lite-4k（默认）
- doubao-lite-32k
- doubao-lite-128k
- doubao-pro-4k
- doubao-pro-32k
- doubao-pro-128k
- doubao-pro-256k

### 阿里云 (Alibaba)
- qwen-turbo（默认）
- qwen-plus
- qwen-max
- qwen-max-longcontext

### 自定义 (Custom)
- gpt-3.5-turbo（默认）
- gpt-4
- gpt-4-turbo

## 使用方式

### 1. 切换供应商

在设置页面的 "AI 标签" 标签页：
1. 选择 AI 提供商（硅基流动、火山引擎、阿里云、自定义）
2. 系统自动加载该供应商的模型列表
3. 模型下拉框自动切换到该供应商的默认模型

### 2. 选择模型

从模型下拉框中选择想要使用的模型：
- 列表中的模型都是该供应商支持的
- 默认选中推荐的模型
- 可以随时切换到其他模型

### 3. 测试连接

配置好 API Key 和模型后，点击"测试连接"验证配置是否正确。

## 技术实现

### 后端 API

**获取模型列表**
```rust
#[tauri::command]
pub fn get_ai_models(provider: String) -> Result<Vec<String>, String>
```

**获取默认模型**
```rust
#[tauri::command]
pub fn get_default_ai_model(provider: String) -> Result<String, String>
```

### 前端调用

```javascript
// 获取模型列表
const models = await invoke('get_ai_models', { provider: 'Volcano' });

// 获取默认模型
const defaultModel = await invoke('get_default_ai_model', { provider: 'Volcano' });
```

### 自动切换

当用户切换供应商时：
1. 自动调用 `get_ai_models` 获取新供应商的模型列表
2. 自动调用 `get_default_ai_model` 获取默认模型
3. 更新下拉框选项和当前选中的模型

## 网络测试结果

### 硅基流动
- ❌ 网络连接失败（100% 丢包）
- 可能原因：网络限制、防火墙阻止

### 火山引擎
- ✅ 网络连接正常（延迟 21-23ms）
- ✅ HTTPS 连接正常
- 推荐使用

### 建议

如果硅基流动无法连接，建议：
1. 切换到火山引擎（已验证可用）
2. 或使用阿里云
3. 或配置代理后使用硅基流动

## 火山引擎配置示例

```
供应商: 火山引擎
API Key: 3c071de5-d67c-4e7c-a75f-efa03463bac8
模型: doubao-lite-4k（或其他 doubao 系列模型）
```

## 优势

1. **无需记忆模型名称** - 从列表中选择即可
2. **避免输入错误** - 所有模型名称都是预设的
3. **自动切换** - 切换供应商时自动更新模型列表
4. **默认推荐** - 每个供应商都有推荐的默认模型
5. **易于扩展** - 添加新供应商或模型只需修改后端配置

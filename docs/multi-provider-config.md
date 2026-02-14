# 多供应商配置持久化设计

## 概述

ClipBox 现在支持为每个 AI 和 OCR 供应商独立存储配置信息。切换供应商时，之前保存的 API Key 和其他配置会自动加载，无需反复填写。

## 配置结构

### AI 配置 (AIConfig)

```rust
pub struct AIConfig {
    pub current_provider: AIProvider,  // 当前选中的供应商
    pub credentials: HashMap<String, AICredentials>,  // 每个供应商的凭证
    pub enabled: bool,
}

pub struct AICredentials {
    pub api_key: String,
    pub model: String,
}
```

**供应商键名映射：**
- 硅基流动 → `"siliconflow"`
- 火山引擎 → `"volcano"`
- 阿里云 → `"alibaba"`
- 自定义 → `"custom_{name}"`

**示例数据：**
```json
{
  "current_provider": { "SiliconFlow": null },
  "credentials": {
    "siliconflow": {
      "api_key": "sk-xxx",
      "model": "Qwen/Qwen2.5-7B-Instruct"
    },
    "volcano": {
      "api_key": "ak-yyy",
      "model": "doubao-seed-1-8-251228"
    },
    "alibaba": {
      "api_key": "sk-zzz",
      "model": "qwen-turbo"
    }
  },
  "enabled": false
}
```

### OCR 配置 (OcrConfig)

```rust
pub struct OcrConfig {
    pub enabled: bool,
    pub current_provider: OcrProviderType,  // 当前选中的供应商
    pub credentials: HashMap<String, OcrCredentials>,  // 每个供应商的凭证
    pub language: String,
    pub auto_ocr: bool,
}

pub struct OcrCredentials {
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
}
```

**供应商键名映射：**
- 本地 Tesseract → `"local"`
- 硅基流动 OCR → `"siliconflow"`
- DeepSeek OCR → `"deepseek"`
- 阿里云 OCR → `"aliyun"`
- 腾讯云 OCR → `"tencent"`
- 百度 OCR → `"baidu"`
- 自定义 → `"custom_{name}"`

**示例数据：**
```json
{
  "enabled": true,
  "current_provider": "SiliconFlow",
  "credentials": {
    "siliconflow": {
      "api_key": "sk-xxx",
      "api_secret": null
    },
    "deepseek": {
      "api_key": "sk-yyy",
      "api_secret": null
    },
    "baidu": {
      "api_key": "api-key-zzz",
      "api_secret": "api-secret-www"
    }
  },
  "language": "chi_sim+eng",
  "auto_ocr": true
}
```

## 使用流程

### 用户视角

1. **首次配置供应商**
   - 打开设置 → AI/OCR 标签
   - 选择供应商（如"硅基流动"）
   - 填写 API Key 和模型
   - 点击"保存"

2. **切换到另一个供应商**
   - 选择新供应商（如"DeepSeek"）
   - 如果之前配置过，API Key 会自动填充
   - 如果是首次使用，输入框为空
   - 填写配置并保存

3. **切换回之前的供应商**
   - 选择之前配置过的供应商
   - API Key 和模型自动恢复
   - 无需重新输入

### 技术实现

#### 后端 (Rust)

**保存配置时：**
```rust
// 获取当前供应商的凭证
let api_key = config.get_current_api_key();
let model = config.get_current_model();

// 设置当前供应商的凭证
config.set_current_credentials(api_key, model);

// 持久化到数据库
config_repo.save_ai_config(&config).await?;
```

**加载配置时：**
```rust
// 从数据库加载
let config = config_repo.load_ai_config().await?;

// 获取当前供应商的凭证
let api_key = config.get_current_api_key();
let model = config.get_current_model();
```

#### 前端 (React)

**状态管理：**
```javascript
// 配置对象（与后端同步）
const [aiConfig, setAiConfig] = useState({
  current_provider: { SiliconFlow: null },
  credentials: {},
  enabled: false,
});

// 当前 UI 显示的凭证（用于编辑）
const [currentAiApiKey, setCurrentAiApiKey] = useState('');
const [currentAiModel, setCurrentAiModel] = useState('');
```

**切换供应商：**
```javascript
const handleAiProviderChange = async (value) => {
  // 1. 保存当前供应商的凭证到 credentials
  const oldProviderKey = getProviderKey(aiConfig.current_provider);
  const updatedCredentials = {
    ...aiConfig.credentials,
    [oldProviderKey]: {
      api_key: currentAiApiKey,
      model: currentAiModel,
    },
  };

  // 2. 切换到新供应商
  const newProvider = { [value]: null };
  const newProviderKey = getProviderKey(newProvider);
  const newCreds = updatedCredentials[newProviderKey];

  // 3. 更新配置
  setAiConfig({
    ...aiConfig,
    current_provider: newProvider,
    credentials: updatedCredentials,
  });

  // 4. 更新 UI 显示
  setCurrentAiApiKey(newCreds?.api_key || '');
  setCurrentAiModel(newCreds?.model || defaultModel);
};
```

**保存配置：**
```javascript
const handleAiSave = async () => {
  // 保存当前供应商的凭证
  const providerKey = getProviderKey(aiConfig.current_provider);
  const updatedCredentials = {
    ...aiConfig.credentials,
    [providerKey]: {
      api_key: currentAiApiKey,
      model: currentAiModel,
    },
  };

  // 发送到后端
  await invoke('update_ai_config', {
    config: {
      ...aiConfig,
      credentials: updatedCredentials,
    },
  });
};
```

## 数据库存储

配置以 JSON 格式存储在 SQLite 数据库的 `app_config` 表中：

```sql
CREATE TABLE app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,  -- JSON 格式
    updated_at INTEGER NOT NULL
);
```

**存储示例：**
```sql
INSERT INTO app_config (key, value, updated_at) VALUES (
  'ai_config',
  '{"current_provider":{"SiliconFlow":null},"credentials":{"siliconflow":{"api_key":"sk-xxx","model":"Qwen/Qwen2.5-7B-Instruct"}},"enabled":false}',
  1707123456
);
```

## 迁移指南

### 从旧配置迁移

旧配置结构：
```rust
pub struct AIConfig {
    pub provider: AIProvider,
    pub api_key: String,
    pub model: String,
    pub enabled: bool,
}
```

迁移逻辑（自动处理）：
```rust
// 如果加载的配置是旧格式，自动转换
if let Some(old_config) = load_old_config() {
    let provider_key = get_provider_key(&old_config.provider);
    let mut credentials = HashMap::new();
    credentials.insert(provider_key, AICredentials {
        api_key: old_config.api_key,
        model: old_config.model,
    });

    let new_config = AIConfig {
        current_provider: old_config.provider,
        credentials,
        enabled: old_config.enabled,
    };

    save_config(&new_config);
}
```

## 优势

1. **用户体验提升**
   - 无需反复填写 API Key
   - 快速切换供应商进行测试
   - 配置持久化，重启应用后保留

2. **数据安全**
   - 所有凭证存储在本地数据库
   - 不会因切换供应商而丢失
   - 支持多个供应商同时配置

3. **可扩展性**
   - 轻松添加新供应商
   - 每个供应商可以有不同的配置字段
   - 支持自定义供应商

## 注意事项

1. **API Key 安全**
   - 配置存储在本地 SQLite 数据库
   - 建议用户妥善保管数据库文件
   - 未来可考虑加密存储

2. **配置同步**
   - 前端和后端配置需保持一致
   - 切换供应商时自动保存当前配置
   - 保存按钮会将所有配置持久化

3. **默认值处理**
   - 首次使用供应商时，凭证为空
   - 模型会自动设置为该供应商的默认模型
   - 用户可以随时修改

## 相关文件

- `src-tauri/src/ai/mod.rs` - AI 配置结构定义
- `src-tauri/src/ocr/mod.rs` - OCR 配置结构定义
- `src-tauri/src/repository/config_repo.rs` - 配置持久化
- `src-tauri/src/commands/ai_commands.rs` - AI 配置命令
- `src-tauri/src/commands/ocr_commands.rs` - OCR 配置命令
- `src/Settings.jsx` - 前端配置界面

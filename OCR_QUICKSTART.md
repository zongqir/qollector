# OCR 功能快速开始

## 立即使用 DeepSeek OCR

### 1. 获取 API Key

访问 [DeepSeek 官网](https://platform.deepseek.com/) 注册并获取 API Key。

### 2. 前端初始化

```javascript
// 在应用启动时初始化
await window.__TAURI__.invoke('init_ocr_service', {
  config: {
    enabled: true,
    provider: 'DeepSeek',
    api_key: 'sk-your-api-key-here',
    language: 'chi_sim+eng',
    auto_ocr: true,
    api_secret: null
  }
});
```

### 3. 识别图片

```javascript
// 方式 1: 仅识别
const text = await window.__TAURI__.invoke('recognize_image', {
  image_path: 'D:/path/to/image.png'
});
console.log('识别结果:', text);

// 方式 2: 识别并保存到数据库（推荐）
const text = await window.__TAURI__.invoke('recognize_and_update', {
  item_id: 'clipboard-item-uuid',
  image_path: 'D:/path/to/image.png'
});
```

### 4. 在 UI 中添加 OCR 按钮

```jsx
function ImageItem({ item }) {
  const [loading, setLoading] = useState(false);
  const [ocrText, setOcrText] = useState(item.ocr_text);

  const handleOcr = async () => {
    setLoading(true);
    try {
      const paths = JSON.parse(item.image_paths);
      const text = await window.__TAURI__.invoke('recognize_and_update', {
        item_id: item.id,
        image_path: paths.raw
      });
      setOcrText(text);
    } catch (error) {
      alert('识别失败: ' + error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <img src={convertFileSrc(JSON.parse(item.image_paths).thumb)} />
      {ocrText ? (
        <div className="ocr-result">{ocrText}</div>
      ) : (
        <button onClick={handleOcr} disabled={loading}>
          {loading ? '识别中...' : '🔍 识别文字'}
        </button>
      )}
    </div>
  );
}
```

## 使用本地 OCR（待实现）

### 1. 安装 Tesseract

```bash
# Windows
choco install tesseract

# macOS
brew install tesseract

# Linux
sudo apt install tesseract-ocr tesseract-ocr-chi-sim
```

### 2. 初始化本地 OCR

```javascript
await window.__TAURI__.invoke('init_ocr_service', {
  config: {
    enabled: true,
    provider: 'Local',
    language: 'chi_sim+eng',
    auto_ocr: true,
    api_key: null,
    api_secret: null
  }
});
```

**注意**: 本地 OCR 的具体实现还需要补充，目前会返回"尚未实现"错误。

## 配置说明

### OcrConfig 字段

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `enabled` | boolean | 是否启用 OCR | `true` |
| `provider` | string | OCR 提供者 | `'Local'` |
| `api_key` | string? | API 密钥（云端 OCR） | `null` |
| `api_secret` | string? | API 密钥（部分提供者） | `null` |
| `language` | string | 识别语言（本地 OCR） | `'chi_sim+eng'` |
| `auto_ocr` | boolean | 自动识别新图片 | `true` |

### 支持的 Provider

- `'Local'` - 本地 Tesseract（待实现）
- `'DeepSeek'` - DeepSeek 视觉模型（✅ 已实现）
- `'Aliyun'` - 阿里云 OCR（待实现）
- `'Tencent'` - 腾讯云 OCR（待实现）
- `'Baidu'` - 百度 OCR（待实现）

## 常见问题

### Q: DeepSeek OCR 识别准确吗？

A: DeepSeek 使用视觉大模型，对中英文混合、手写字、复杂排版都有较好的识别效果。

### Q: 识别一张图片需要多久？

A: 取决于图片大小和网络速度，通常 2-5 秒。

### Q: 如何处理识别失败？

A: 捕获错误并提示用户，可以提供重试按钮：

```javascript
try {
  const text = await invoke('recognize_image', { image_path });
} catch (error) {
  console.error('识别失败:', error);
  // 显示错误提示或重试按钮
}
```

### Q: 可以批量识别吗？

A: 可以，参考 `src/ocr-integration-example.js` 中的 `batchOcr` 函数。

### Q: OCR 结果会自动保存吗？

A: 使用 `recognize_and_update` 命令会自动保存到数据库的 `ocr_text` 字段。

### Q: 如何搜索 OCR 文本？

A: 数据库搜索已支持 OCR 文本，直接使用现有的搜索功能即可。

## 成本估算（DeepSeek）

DeepSeek API 定价（参考官网最新价格）：
- 输入: ~¥0.001/千 tokens
- 输出: ~¥0.002/千 tokens

一张图片识别成本约 ¥0.01-0.05，非常经济。

## 下一步

1. 在 Settings.jsx 中添加 OCR 配置面板
2. 在 App.jsx 中为图片条目添加 OCR 按钮
3. 实现自动 OCR（图片捕获后自动识别）
4. 实现批量 OCR（对历史图片批量识别）

## 技术支持

- 查看完整文档: `src-tauri/src/ocr/README.md`
- 查看实现总结: `OCR_IMPLEMENTATION_SUMMARY.md`
- 查看前端示例: `src/ocr-integration-example.js`

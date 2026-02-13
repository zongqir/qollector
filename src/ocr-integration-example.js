// OCR 功能集成示例

// 1. 初始化 OCR 服务（应用启动时）
async function initOcrService() {
  try {
    const config = {
      enabled: true,
      provider: 'Local', // 默认使用本地 OCR
      language: 'chi_sim+eng', // 中英文
      auto_ocr: true,
      api_key: null,
      api_secret: null
    };

    const result = await window.__TAURI__.invoke('init_ocr_service', { config });
    console.log('OCR 服务初始化成功:', result);
  } catch (error) {
    console.error('OCR 服务初始化失败:', error);
  }
}

// 2. 切换到 DeepSeek OCR
async function switchToDeepSeek(apiKey) {
  try {
    const config = {
      enabled: true,
      provider: 'DeepSeek',
      api_key: apiKey,
      language: 'chi_sim+eng',
      auto_ocr: true,
      api_secret: null
    };

    await window.__TAURI__.invoke('update_ocr_config', { config });
    console.log('已切换到 DeepSeek OCR');
  } catch (error) {
    console.error('切换失败:', error);
  }
}

// 3. 手动识别图片
async function recognizeImage(imagePath) {
  try {
    const text = await window.__TAURI__.invoke('recognize_image', {
      image_path: imagePath
    });
    console.log('识别结果:', text);
    return text;
  } catch (error) {
    console.error('识别失败:', error);
    throw error;
  }
}

// 4. 识别并更新数据库（推荐）
async function recognizeAndUpdate(itemId, imagePath) {
  try {
    const text = await window.__TAURI__.invoke('recognize_and_update', {
      item_id: itemId,
      image_path: imagePath
    });
    console.log('识别并更新成功:', text);
    return text;
  } catch (error) {
    console.error('识别并更新失败:', error);
    throw error;
  }
}

// 5. 检查 OCR 是否可用
async function checkOcrAvailable() {
  try {
    const available = await window.__TAURI__.invoke('check_ocr_available');
    return available;
  } catch (error) {
    console.error('检查失败:', error);
    return false;
  }
}

// 6. 获取支持的提供者列表
async function getOcrProviders() {
  try {
    const providers = await window.__TAURI__.invoke('get_ocr_providers');
    console.log('支持的 OCR 提供者:', providers);
    return providers;
  } catch (error) {
    console.error('获取提供者列表失败:', error);
    return [];
  }
}

// 7. React 组件示例
function OcrButton({ item }) {
  const [loading, setLoading] = React.useState(false);
  const [ocrText, setOcrText] = React.useState(item.ocr_text);

  const handleOcr = async () => {
    if (item.type !== 'image' || !item.image_paths) {
      return;
    }

    setLoading(true);
    try {
      // 解析图片路径
      const paths = JSON.parse(item.image_paths);
      const imagePath = paths.raw;

      // 识别并更新
      const text = await recognizeAndUpdate(item.id, imagePath);
      setOcrText(text);

      // 刷新列表
      // await refreshItems();
    } catch (error) {
      alert('OCR 识别失败: ' + error);
    } finally {
      setLoading(false);
    }
  };

  if (item.type !== 'image') {
    return null;
  }

  return (
    <div className="ocr-section">
      {ocrText ? (
        <div className="ocr-result">
          <div className="ocr-label">识别文本:</div>
          <div className="ocr-text">{ocrText}</div>
        </div>
      ) : (
        <button
          onClick={handleOcr}
          disabled={loading}
          className="ocr-button"
        >
          {loading ? '识别中...' : '🔍 识别文字'}
        </button>
      )}
    </div>
  );
}

// 8. 设置面板示例
function OcrSettings() {
  const [config, setConfig] = React.useState(null);
  const [providers, setProviders] = React.useState([]);

  React.useEffect(() => {
    loadConfig();
    loadProviders();
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await window.__TAURI__.invoke('get_ocr_config');
      setConfig(cfg);
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  };

  const loadProviders = async () => {
    const list = await getOcrProviders();
    setProviders(list);
  };

  const handleSave = async () => {
    try {
      await window.__TAURI__.invoke('update_ocr_config', { config });
      alert('保存成功');
    } catch (error) {
      alert('保存失败: ' + error);
    }
  };

  if (!config) return <div>加载中...</div>;

  return (
    <div className="ocr-settings">
      <h3>OCR 设置</h3>

      <label>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
        />
        启用 OCR
      </label>

      <label>
        OCR 提供者:
        <select
          value={config.provider}
          onChange={(e) => setConfig({ ...config, provider: e.target.value })}
        >
          <option value="Local">本地 Tesseract</option>
          <option value="DeepSeek">DeepSeek OCR</option>
          <option value="Aliyun">阿里云 OCR</option>
          <option value="Tencent">腾讯云 OCR</option>
          <option value="Baidu">百度 OCR</option>
        </select>
      </label>

      {config.provider !== 'Local' && (
        <label>
          API Key:
          <input
            type="password"
            value={config.api_key || ''}
            onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
            placeholder="输入 API Key"
          />
        </label>
      )}

      {config.provider === 'Local' && (
        <label>
          识别语言:
          <input
            type="text"
            value={config.language}
            onChange={(e) => setConfig({ ...config, language: e.target.value })}
            placeholder="chi_sim+eng"
          />
        </label>
      )}

      <label>
        <input
          type="checkbox"
          checked={config.auto_ocr}
          onChange={(e) => setConfig({ ...config, auto_ocr: e.target.checked })}
        />
        自动识别图片
      </label>

      <button onClick={handleSave}>保存设置</button>
    </div>
  );
}

// 9. 自动 OCR（在图片捕获后自动触发）
async function autoOcrOnImageCapture(item) {
  // 检查是否启用自动 OCR
  const config = await window.__TAURI__.invoke('get_ocr_config');
  if (!config.enabled || !config.auto_ocr) {
    return;
  }

  // 检查是否为图片
  if (item.type !== 'image' || !item.image_paths) {
    return;
  }

  try {
    const paths = JSON.parse(item.image_paths);
    const imagePath = paths.raw;

    // 后台异步识别
    recognizeAndUpdate(item.id, imagePath).catch(error => {
      console.error('自动 OCR 失败:', error);
    });
  } catch (error) {
    console.error('自动 OCR 解析失败:', error);
  }
}

// 10. 批量 OCR（对历史图片批量识别）
async function batchOcr(items) {
  const imageItems = items.filter(item =>
    item.type === 'image' && !item.ocr_text && item.image_paths
  );

  console.log(`开始批量 OCR，共 ${imageItems.length} 张图片`);

  for (const item of imageItems) {
    try {
      const paths = JSON.parse(item.image_paths);
      const imagePath = paths.raw;

      await recognizeAndUpdate(item.id, imagePath);
      console.log(`✓ 已识别: ${item.id}`);

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`✗ 识别失败 ${item.id}:`, error);
    }
  }

  console.log('批量 OCR 完成');
}

// 导出函数
export {
  initOcrService,
  switchToDeepSeek,
  recognizeImage,
  recognizeAndUpdate,
  checkOcrAvailable,
  getOcrProviders,
  autoOcrOnImageCapture,
  batchOcr,
  OcrButton,
  OcrSettings
};

import { invoke } from '@tauri-apps/api/core';

export const initOcrService = async () => {
  try {
    const savedConfig = await invoke('get_ocr_config');
    if (savedConfig && savedConfig.api_key) {
      await invoke('init_ocr_service', { config: savedConfig });
      console.log('OCR 服务初始化成功（使用已保存配置）');
    } else {
      console.log('OCR 服务未配置，请在设置中配置 API Key');
    }
  } catch (error) {
    console.error('OCR 服务初始化失败:', error);
  }
};

export const recognizeAndUpdate = async (itemId, imagePath) => {
  return invoke('recognize_and_update', {
    itemId,
    imagePath
  });
};

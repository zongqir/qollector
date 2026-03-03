import { invoke } from '@tauri-apps/api/core';

const toDataUrlPayload = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed;
};

export const smartCopyFromImageData = async (imageData, options = {}) => {
  const payload = toDataUrlPayload(imageData);
  if (!payload) {
    throw new Error('image data is empty');
  }

  return invoke('smart_copy_from_image_data', {
    imageData: payload,
    copyToClipboard: options.copyToClipboard ?? true,
  });
};

export const smartCopyFromImagePath = async (imagePath, options = {}) => {
  const path = typeof imagePath === 'string' ? imagePath.trim() : '';
  if (!path) {
    throw new Error('image path is empty');
  }

  return invoke('smart_copy_from_image_path', {
    imagePath: path,
    copyToClipboard: options.copyToClipboard ?? true,
  });
};

export const startSystemScreenCapture = async () => {
  return invoke('start_system_screen_capture');
};

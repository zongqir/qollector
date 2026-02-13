import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * 图片路径解析工具函数
 */

export const getImageThumbnail = (imagePathsStr) => {
  if (!imagePathsStr) return '';
  try {
    const paths = JSON.parse(imagePathsStr);
    const thumbnailPath = paths.thumbnail || paths.original;
    const converted = convertFileSrc(thumbnailPath);
    return converted;
  } catch (e) {
    console.error('Error parsing image paths:', e);
    return convertFileSrc(imagePathsStr);
  }
};

export const getImageOriginal = (imagePathsStr) => {
  if (!imagePathsStr) return '';
  try {
    const paths = JSON.parse(imagePathsStr);
    const originalPath = paths.original || paths.raw || paths.thumbnail;
    const converted = convertFileSrc(originalPath);
    return converted;
  } catch (e) {
    console.error('Error parsing image paths:', e);
    return convertFileSrc(imagePathsStr);
  }
};

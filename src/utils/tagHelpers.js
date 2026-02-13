/**
 * 标签解析工具函数
 */

export const getTags = (tagsStr) => {
  if (!tagsStr) return [];
  try {
    return JSON.parse(tagsStr);
  } catch {
    return [];
  }
};

export const getSourceApp = (metadataStr) => {
  if (!metadataStr) return 'Unknown';
  try {
    const metadata = JSON.parse(metadataStr);
    let appName = metadata.source_app || 'Unknown';
    if (appName.toLowerCase().endsWith('.exe')) {
      appName = appName.slice(0, -4);
    }
    return appName;
  } catch {
    return 'Unknown';
  }
};

/**
 * 格式化和内容处理工具函数
 */

export const formatDate = (timestamp, language) => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString(language);
};

export const getContentPreview = (content, maxLength = 100) => {
  if (!content) return '';
  return content;
};

export const getFileList = (content) => {
  if (!content) return [];
  return content.split('\n').filter(p => p.trim());
};

export const getFileName = (path) => {
  return path.split(/[/\\]/).pop() || path;
};

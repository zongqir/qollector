/**
 * 格式化和内容处理工具函数
 */

export const formatDate = (timestamp, language) => {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isCurrentYear = date.getFullYear() === now.getFullYear();

  if (isCurrentYear) {
    // 本年：MM-DD HH:mm
    return date.toLocaleString(language, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  // 非本年：YYYY-MM-DD HH:mm
  return date.toLocaleString(language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * 根据时间戳计算时间线颜色
 * 越新的条目颜色越鲜明，越旧的越淡
 */
export const getTimelineColor = (timestamp) => {
  const now = Date.now();
  const created = timestamp * 1000;
  const diffMinutes = (now - created) / (1000 * 60);

  if (diffMinutes < 2) return '#007aff';       // 蓝色 - 刚刚
  if (diffMinutes < 15) return '#5856d6';      // 紫色 - 几分钟前
  if (diffMinutes < 60) return '#5ac8fa';      // 青色 - 一小时内
  if (diffMinutes < 360) return '#34c759';     // 绿色 - 几小时内
  if (diffMinutes < 1440) return '#ff9500';    // 橙色 - 一天内
  if (diffMinutes < 4320) return '#ff3b30';    // 红色 - 几天内
  return '#8e8e93';                             // 灰色 - 更早
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

/**
 * 根据文件扩展名返回图标信息
 */
export const getFileIcon = (filename) => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map = {
    pdf: { icon: 'FileText', color: '#ff3b30', label: 'PDF' },
    doc: { icon: 'FileText', color: '#007aff', label: 'DOC' },
    docx: { icon: 'FileText', color: '#007aff', label: 'DOCX' },
    xls: { icon: 'FileSpreadsheet', color: '#34c759', label: 'XLS' },
    xlsx: { icon: 'FileSpreadsheet', color: '#34c759', label: 'XLSX' },
    csv: { icon: 'FileSpreadsheet', color: '#34c759', label: 'CSV' },
    png: { icon: 'FileImage', color: '#af52de', label: 'PNG' },
    jpg: { icon: 'FileImage', color: '#af52de', label: 'JPG' },
    jpeg: { icon: 'FileImage', color: '#af52de', label: 'JPEG' },
    gif: { icon: 'FileImage', color: '#af52de', label: 'GIF' },
    svg: { icon: 'FileImage', color: '#af52de', label: 'SVG' },
    webp: { icon: 'FileImage', color: '#af52de', label: 'WEBP' },
    zip: { icon: 'FileArchive', color: '#ff9500', label: 'ZIP' },
    rar: { icon: 'FileArchive', color: '#ff9500', label: 'RAR' },
    '7z': { icon: 'FileArchive', color: '#ff9500', label: '7Z' },
    tar: { icon: 'FileArchive', color: '#ff9500', label: 'TAR' },
    gz: { icon: 'FileArchive', color: '#ff9500', label: 'GZ' },
  };
  return map[ext] || { icon: 'File', color: '#8e8e93', label: ext.toUpperCase() || 'FILE' };
};

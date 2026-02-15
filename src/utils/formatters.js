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

  if (diffMinutes < 2) return '#667eea';       // 紫色 - 刚刚
  if (diffMinutes < 15) return '#5c7cfa';      // 蓝紫 - 几分钟前
  if (diffMinutes < 60) return '#339af0';      // 蓝色 - 一小时内
  if (diffMinutes < 360) return '#22b8cf';     // 青色 - 几小时内
  if (diffMinutes < 1440) return '#51cf66';    // 绿色 - 一天内
  if (diffMinutes < 4320) return '#fcc419';    // 琥珀 - 几天内
  return '#dee2e6';                             // 淡灰 - 更早
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

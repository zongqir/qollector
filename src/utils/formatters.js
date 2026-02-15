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

export const parseUrl = (url) => {
  try {
    const u = new URL(url.trim());
    const domain = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    return { domain, path, favicon };
  } catch {
    return null;
  }
};

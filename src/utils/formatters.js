/**
 * 格式化和内容处理工具函数
 */

import { find as findLinks, registerCustomProtocol } from 'linkifyjs';

registerCustomProtocol('ws');
registerCustomProtocol('wss');

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

const OPENABLE_SCHEMES = new Set(['http:', 'https:', 'ftp:', 'ftps:', 'ws:', 'wss:']);
const WINDOWS_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_RE = /^\\\\[^\\/\s]+[\\/][^\\/\s]+/;
const POSIX_ABSOLUTE_PATH_RE = /^\//;

const normalizePathCandidate = (line) => {
  if (typeof line !== 'string') return '';
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const isLikelyAbsolutePath = (candidate) => (
  WINDOWS_DRIVE_PATH_RE.test(candidate) ||
  WINDOWS_UNC_PATH_RE.test(candidate) ||
  POSIX_ABSOLUTE_PATH_RE.test(candidate)
);

export const extractOpenableUrls = (content, maxUrls = 5) => {
  if (!content || typeof content !== 'string') return [];

  const urls = [];
  const seen = new Set();
  const links = findLinks(content);

  for (const link of links) {
    if (urls.length >= maxUrls) break;
    if (link.type !== 'url') continue;

    try {
      const parsed = new URL(link.href || link.value || '');
      if (!OPENABLE_SCHEMES.has(parsed.protocol)) continue;
      const normalized = parsed.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
    } catch {
      // Ignore malformed candidates.
    }
  }

  return urls;
};

export const extractOpenableFilePaths = (content, maxPaths = 5) => {
  if (!content || typeof content !== 'string') return [];

  const paths = [];
  const seen = new Set();
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (paths.length >= maxPaths) break;
    const normalized = normalizePathCandidate(line);
    if (!normalized || !isLikelyAbsolutePath(normalized)) continue;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    paths.push(normalized);
  }

  return paths;
};

export const getLinkPreviewTitle = (item) => {
  if (!item?.metadata) return null;
  try {
    const metadata = JSON.parse(item.metadata);
    const title = metadata?.link_preview?.title;
    if (typeof title !== 'string') return null;
    const trimmed = title.trim();
    return trimmed || null;
  } catch {
    return null;
  }
};

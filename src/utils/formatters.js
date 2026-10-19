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

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const formatHistoryCardTime = (
  timestamp,
  language,
  nowMs = Date.now(),
  justNowLabel = null,
) => {
  const createdMs = Number(timestamp) * 1000;
  if (!Number.isFinite(createdMs)) return formatDate(timestamp, language);

  const diffMs = nowMs - createdMs;
  if (diffMs < 0 || diffMs >= DAY_MS) {
    return formatDate(timestamp, language);
  }

  const rtf = new Intl.RelativeTimeFormat(language || undefined, { numeric: 'auto' });
  if (diffMs < MINUTE_MS) {
    if (typeof justNowLabel === 'string' && justNowLabel.trim()) {
      return justNowLabel;
    }
    return rtf.format(0, 'second');
  }
  if (diffMs < HOUR_MS) {
    return rtf.format(-Math.floor(diffMs / MINUTE_MS), 'minute');
  }
  return rtf.format(-Math.floor(diffMs / HOUR_MS), 'hour');
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

const TIMESTAMP_SECONDS_RE = /^\d{10}$/;
const TIMESTAMP_MILLISECONDS_RE = /^\d{13}$/;
const MIN_REASONABLE_TIMESTAMP_MS = Date.UTC(2000, 0, 1, 0, 0, 0);
const MAX_REASONABLE_TIMESTAMP_MS = Date.UTC(2100, 0, 1, 0, 0, 0);

const trimTimestampCandidate = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

export const detectTimestampCandidate = (value) => {
  const candidate = trimTimestampCandidate(value);
  if (!candidate || /\s/.test(candidate)) {
    return null;
  }

  let milliseconds = null;
  let unit = null;

  if (TIMESTAMP_SECONDS_RE.test(candidate)) {
    milliseconds = Number(candidate) * 1000;
    unit = 's';
  } else if (TIMESTAMP_MILLISECONDS_RE.test(candidate)) {
    milliseconds = Number(candidate);
    unit = 'ms';
  }

  if (milliseconds === null || !Number.isFinite(milliseconds)) {
    return null;
  }

  if (milliseconds < MIN_REASONABLE_TIMESTAMP_MS || milliseconds > MAX_REASONABLE_TIMESTAMP_MS) {
    return null;
  }

  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    raw: candidate,
    unit,
    milliseconds,
  };
};

const ISO_OR_DATE_RE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const CHINESE_DATE_RE = /^\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}(?::\d{2}|时\d{1,2}分)(?::\d{2}|秒)?)?$/;
const TIME_ONLY_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export const isDateTimeCandidate = (value) => {
  if (typeof value !== 'string') return false;
  const candidate = trimTimestampCandidate(value);
  if (!candidate || candidate.length > 50 || candidate.includes('\n')) {
    return false;
  }

  if (detectTimestampCandidate(candidate)) {
    return true;
  }

  if (ISO_OR_DATE_RE.test(candidate)) {
    const parsed = Date.parse(candidate.replace(/\//g, '-'));
    if (!Number.isNaN(parsed)) {
      const year = new Date(parsed).getFullYear();
      if (year >= 1970 && year <= 2100) return true;
    }
  }

  if (CHINESE_DATE_RE.test(candidate)) {
    return true;
  }

  if (TIME_ONLY_RE.test(candidate)) {
    return true;
  }

  return false;
};

export const formatTimestampCandidate = (candidate, language) => {
  if (!candidate || typeof candidate.milliseconds !== 'number') {
    return '';
  }

  const date = new Date(candidate.milliseconds);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString(language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const COLOR_TEXT_MAX_LENGTH = 64;

const trimQuotedCandidate = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const clampByte = (value) => Math.max(0, Math.min(255, value | 0));

const toHexByte = (value) => clampByte(value).toString(16).toUpperCase().padStart(2, '0');

const toAlphaText = (alpha) => {
  const rounded = Number(alpha.toFixed(3));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const rgbToHsl = (r, g, b) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
  }

  h = Math.round((h * 60 + 360) % 360);
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return {
    h,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
};

let colorProbeContext = null;

const getColorProbeContext = () => {
  if (colorProbeContext) return colorProbeContext;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  colorProbeContext = canvas.getContext('2d', { willReadFrequently: true });
  return colorProbeContext;
};

const supportsCssColor = (candidate) => {
  if (!candidate) return false;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports('color', candidate);
  }
  if (typeof document === 'undefined') {
    return false;
  }
  const probe = document.createElement('option');
  probe.style.color = '';
  probe.style.color = candidate;
  return probe.style.color !== '';
};

const normalizeRawRgbTriplet = (candidate) => {
  if (!candidate) return null;
  const hasDelimiter = candidate.includes(',') || /\s/.test(candidate);
  if (!hasDelimiter) return null;

  const tokens = candidate.split(/[,\s]+/).filter(Boolean);
  if (tokens.length !== 3) return null;
  if (!tokens.every((token) => /^\d{1,3}$/.test(token))) return null;

  const [r, g, b] = tokens.map((token) => Number(token));
  if ([r, g, b].some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return null;
  }

  return `rgb(${r}, ${g}, ${b})`;
};

export const parsePureColorText = (value) => {
  const candidate = trimQuotedCandidate(value);
  if (!candidate || candidate.length > COLOR_TEXT_MAX_LENGTH) {
    return null;
  }
  if (/[\r\n]/.test(candidate)) {
    return null;
  }
  const normalizedColor = normalizeRawRgbTriplet(candidate) || candidate;
  if (!supportsCssColor(normalizedColor)) {
    return null;
  }

  const ctx = getColorProbeContext();
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillStyle = normalizedColor;
  ctx.fillRect(0, 0, 1, 1);
  const rgba = ctx.getImageData(0, 0, 1, 1).data;
  const r = rgba[0];
  const g = rgba[1];
  const b = rgba[2];
  const alpha = rgba[3] / 255;
  const alphaText = toAlphaText(alpha);

  if (alpha === 0) {
    return null;
  }

  const hex = alpha < 1
    ? `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}${toHexByte(Math.round(alpha * 255))}`
    : `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  const rgb = alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${alphaText})`
    : `rgb(${r}, ${g}, ${b})`;
  const hslInfo = rgbToHsl(r, g, b);
  const hsl = alpha < 1
    ? `hsla(${hslInfo.h}, ${hslInfo.s}%, ${hslInfo.l}%, ${alphaText})`
    : `hsl(${hslInfo.h}, ${hslInfo.s}%, ${hslInfo.l}%)`;

  return {
    raw: candidate,
    previewCss: alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${alphaText})` : `rgb(${r}, ${g}, ${b})`,
    hex,
    rgb,
    hsl,
  };
};

import { Key } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';

const TOKEN_PREFIXES = ['sk-', 'ghp_', 'gho_', 'glpat-', 'Bearer '];
const BASE64_HEX_BLOB_RE = /^[A-Za-z0-9_\-+/=\s\r\n]{24,}$/;

export const tokenRule = {
  id: 'token_sanitize',
  category: TRANSFORM_CATEGORIES.CLEAN,
  icon: Key,
  labelKey: 'transforms.tokenSanitize',
  titleKey: 'transforms.tokenSanitizeTitle',
  priority: 40,
  previewable: false,

  match: (text) => {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (trimmed.length < 20 || trimmed.length > 4096) return false;

    // 必须存在需要清洗的杂质字符（换行符、制表符、多余空格或首尾空格）
    const hasImpurity = /[\r\n\t]|\s{2,}|^\s+|\s+$/.test(text);
    if (!hasImpurity) return false;

    // 匹配常见 Token 关键词
    const hasKnownPrefix = TOKEN_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
    if (hasKnownPrefix) return true;

    // 或者是长高熵 Base64/Hex 密文块（不含中文字符和通用标点）
    if (BASE64_HEX_BLOB_RE.test(trimmed)) {
      const compactLength = trimmed.replace(/[\s\r\n\t]/g, '').length;
      return compactLength >= 24;
    }

    return false;
  },

  apply: (text) => {
    if (typeof text !== 'string') return '';
    const trimmed = text.trim();
    if (trimmed.startsWith('Bearer ')) {
      const rest = trimmed.slice(7).replace(/[\s\r\n\t]/g, '');
      return `Bearer ${rest}`;
    }
    return trimmed.replace(/[\s\r\n\t]/g, '');
  },
};

import { ExternalLink } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';

const PERCENT_ENCODED_RE = /%[0-9a-fA-F]{2}/;

export const urlRule = {
  id: 'url_decode',
  category: TRANSFORM_CATEGORIES.DECODE,
  icon: ExternalLink,
  labelKey: 'transforms.urlDecode',
  titleKey: 'transforms.urlDecodeTitle',
  priority: 50,
  previewable: true,

  match: (text) => {
    if (typeof text !== 'string' || text.length === 0) return false;
    if (!PERCENT_ENCODED_RE.test(text)) return false;
    try {
      const decoded = decodeURIComponent(text);
      return decoded !== text;
    } catch {
      // 若全局 decodeURIComponent 因单点孤立 % 失败，尝试局部正则替换看是否能产生有效变化
      const partiallyDecoded = text.replace(/%[0-9a-fA-F]{2}/g, (match) => {
        try {
          return decodeURIComponent(match);
        } catch {
          return match;
        }
      });
      return partiallyDecoded !== text;
    }
  },

  apply: (text) => {
    if (typeof text !== 'string') return '';
    try {
      return decodeURIComponent(text);
    } catch {
      return text.replace(/%[0-9a-fA-F]{2}/g, (match) => {
        try {
          return decodeURIComponent(match);
        } catch {
          return match;
        }
      });
    }
  },
};

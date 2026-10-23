import { Languages } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';

const UNICODE_ESCAPE_RE = /\\u[0-9a-fA-F]{4}/;
const UNICODE_GLOBAL_RE = /\\u([0-9a-fA-F]{4})/g;

export const unicodeRule = {
  id: 'unicode_decode',
  category: TRANSFORM_CATEGORIES.DECODE,
  icon: Languages,
  labelKey: 'transforms.unicodeDecode',
  titleKey: 'transforms.unicodeDecodeTitle',
  priority: 10,
  previewable: true,

  match: (text) => {
    if (typeof text !== 'string' || text.length === 0) return false;
    return UNICODE_ESCAPE_RE.test(text);
  },

  apply: (text) => {
    if (typeof text !== 'string') return '';
    try {
      return text.replace(UNICODE_GLOBAL_RE, (_, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16));
        } catch {
          return _;
        }
      });
    } catch {
      return text;
    }
  },
};

import { FileCode } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';

const EXPORT_ENV_LINE_RE = /(?:^|\n)\s*export\s+[A-Za-z_][A-Za-z0-9_]*\s*=/;
const EXPORT_STRIP_RE = /(^|\n)\s*export\s+([A-Za-z_][A-Za-z0-9_]*\s*=)/g;

export const envRule = {
  id: 'env_strip_export',
  category: TRANSFORM_CATEGORIES.CLEAN,
  icon: FileCode,
  labelKey: 'transforms.envStripExport',
  titleKey: 'transforms.envStripExportTitle',
  priority: 70,
  previewable: true,

  match: (text) => {
    if (typeof text !== 'string' || text.length === 0) return false;
    return EXPORT_ENV_LINE_RE.test(text);
  },

  apply: (text) => {
    if (typeof text !== 'string') return '';
    return text.replace(EXPORT_STRIP_RE, '$1$2');
  },
};

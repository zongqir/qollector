import { Clock3 } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';
import { detectTimestampCandidate, formatTimestampCandidate } from '../../formatters.js';

export const timestampRule = {
  id: 'timestamp_convert',
  category: TRANSFORM_CATEGORIES.CONVERT,
  icon: Clock3,
  labelKey: 'transforms.timestampConvert',
  titleKey: 'transforms.timestampConvertTitle',
  priority: 90,
  previewable: true,

  match: (text) => {
    if (typeof text !== 'string') return false;
    const candidate = detectTimestampCandidate(text);
    return candidate !== null;
  },

  apply: (text, meta) => {
    if (typeof text !== 'string') return '';
    const candidate = detectTimestampCandidate(text);
    if (!candidate) return text;
    const language = meta?.language || 'zh-CN';
    return formatTimestampCandidate(candidate, language);
  },
};

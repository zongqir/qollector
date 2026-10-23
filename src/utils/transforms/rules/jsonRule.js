import { Braces, FileJson } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';

const MAX_JSON_PARSE_LENGTH = 500000;

function safeParseJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_JSON_PARSE_LENGTH) return null;
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export const jsonPrettyRule = {
  id: 'json_pretty',
  category: TRANSFORM_CATEGORIES.CONVERT,
  icon: Braces,
  labelKey: 'transforms.jsonPretty',
  titleKey: 'transforms.jsonPrettyTitle',
  priority: 60,
  previewable: false,

  match: (text) => {
    const parsed = safeParseJson(text);
    if (parsed === null) return false;
    // 如果已经是规范的美化格式（含换行且缩进一致），则不重复推荐美化
    const trimmed = text.trim();
    if (!trimmed.includes('\n')) return true;
    try {
      const formatted = JSON.stringify(parsed, null, 2);
      return formatted !== trimmed;
    } catch {
      return false;
    }
  },

  apply: (text) => {
    const parsed = safeParseJson(text);
    if (parsed === null) return text;
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  },
};

export const jsonCompactRule = {
  id: 'json_compact',
  category: TRANSFORM_CATEGORIES.CONVERT,
  icon: FileJson,
  labelKey: 'transforms.jsonCompact',
  titleKey: 'transforms.jsonCompactTitle',
  priority: 61,
  previewable: false,

  match: (text) => {
    if (typeof text !== 'string' || !text.includes('\n')) return false;
    const parsed = safeParseJson(text);
    return parsed !== null;
  },

  apply: (text) => {
    const parsed = safeParseJson(text);
    if (parsed === null) return text;
    try {
      return JSON.stringify(parsed);
    } catch {
      return text;
    }
  },
};

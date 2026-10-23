import { GitCommit } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';

const FULL_GIT_SHA_RE = /^[0-9a-fA-F]{40}$/;

export const gitRule = {
  id: 'git_short_hash',
  category: TRANSFORM_CATEGORIES.CONVERT,
  icon: GitCommit,
  labelKey: 'transforms.gitShortHash',
  titleKey: 'transforms.gitShortHashTitle',
  priority: 80,
  previewable: false,

  match: (text) => {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    return trimmed.length === 40 && FULL_GIT_SHA_RE.test(trimmed);
  },

  apply: (text) => {
    if (typeof text !== 'string') return '';
    return text.trim().slice(0, 7);
  },
};

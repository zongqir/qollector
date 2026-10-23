import { FolderOpen } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';

const WINDOWS_DRIVE_PATH_RE = /\b[a-zA-Z]:\\(?:[^<>:"/|?*\r\n]+\\)*[^<>:"/|?*\r\n]*/;

export const pathRule = {
  id: 'windows_path_posix',
  category: TRANSFORM_CATEGORIES.CONVERT,
  icon: FolderOpen,
  labelKey: 'transforms.pathPosix',
  titleKey: 'transforms.pathPosixTitle',
  priority: 30,
  previewable: false,

  match: (text) => {
    if (typeof text !== 'string' || text.length === 0) return false;
    return WINDOWS_DRIVE_PATH_RE.test(text);
  },

  apply: (text) => {
    if (typeof text !== 'string') return '';
    // 将 Windows 盘符路径中的反斜杠替换为正斜杠
    return text.replace(/([a-zA-Z]:)\\[^<>:"|?*\r\n]*/g, (match) => {
      return match.replace(/\\/g, '/');
    });
  },
};

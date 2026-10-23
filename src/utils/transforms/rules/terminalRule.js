import { Terminal } from 'lucide-react';
import { TRANSFORM_CATEGORIES } from '../types.js';

const COMMAND_KEYWORDS = /\b(?:npm|pnpm|yarn|bun|npx|git|cargo|rustc|docker|docker-compose|podman|kubectl|sudo|curl|wget|systemctl|journalctl|apt|apt-get|brew|dnf|pacman|yum|python|python3|pip|pip3|node|deno|bash|sh|zsh|make|cmake|go|uv|rye|cat|grep|ls|find|chmod|chown|kill|taskctl|dagu|rtk)\b/i;

const SHELL_PROMPT_LINE_RE = /^\s*(?:[$#]|PS\s+[^\n\r]*?>)\s+\S/m;
const MARKDOWN_COMMAND_LINE_RE = /^\s*>\s+\S/m;

export const terminalRule = {
  id: 'terminal_clean',
  category: TRANSFORM_CATEGORIES.CLEAN,
  icon: Terminal,
  labelKey: 'transforms.terminalClean',
  titleKey: 'transforms.terminalCleanTitle',
  priority: 20,
  previewable: false,

  match: (text) => {
    if (typeof text !== 'string' || text.length === 0) return false;
    if (SHELL_PROMPT_LINE_RE.test(text)) return true;
    if (MARKDOWN_COMMAND_LINE_RE.test(text) && COMMAND_KEYWORDS.test(text)) {
      return true;
    }
    return false;
  },

  apply: (text) => {
    if (typeof text !== 'string') return '';
    const lines = text.split('\n');
    const cleanedLines = lines.map((line) => {
      // 匹配经典 Shell 提示符：$ 或 # 或 PowerShell 提示符 PS C:\...>
      let cleaned = line.replace(/^\s*(?:[$#]|PS\s+[^\n\r]*?>)\s*/, '');
      // 匹配 Markdown 引用格式命令行：> npm install
      if (/^\s*>\s+/.test(line) && COMMAND_KEYWORDS.test(line)) {
        cleaned = line.replace(/^\s*>\s*/, '');
      }
      return cleaned;
    });
    return cleanedLines.join('\n');
  },
};

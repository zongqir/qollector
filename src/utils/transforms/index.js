/**
 * 文本快捷转换规则注册表与调度中枢
 */

import { unicodeRule } from './rules/unicodeRule.js';
import { terminalRule } from './rules/terminalRule.js';
import { pathRule } from './rules/pathRule.js';
import { tokenRule } from './rules/tokenRule.js';
import { urlRule } from './rules/urlRule.js';
import { jsonPrettyRule, jsonCompactRule } from './rules/jsonRule.js';
import { envRule } from './rules/envRule.js';
import { gitRule } from './rules/gitRule.js';
import { timestampRule } from './rules/timestampRule.js';

/**
 * 已注册的转换规则集（按顺序评估）
 */
export const TRANSFORM_REGISTRY = [
  unicodeRule,
  terminalRule,
  pathRule,
  tokenRule,
  urlRule,
  jsonPrettyRule,
  jsonCompactRule,
  envRule,
  gitRule,
  timestampRule,
];

/**
 * 根据输入文本解析所有命中的转换规则列表
 * @param {string} text - 输入内容
 * @param {object} meta - 辅助元数据（如当前语言、item属性等）
 * @returns {Array} 匹配的规则对象数组（按 priority 升序排序）
 */
export function resolveMatchingTransforms(text, meta = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }

  const matched = [];
  for (const rule of TRANSFORM_REGISTRY) {
    try {
      if (rule.match(text, meta)) {
        matched.push(rule);
      }
    } catch (error) {
      console.warn(`[TransformRegistry] Rule "${rule.id}" match failed:`, error);
    }
  }

  return matched.sort((a, b) => (a.priority || 100) - (b.priority || 100));
}

/**
 * 根据 ID 查询单条规则
 * @param {string} id - 规则唯一标识符
 * @returns {object|null}
 */
export function getTransformRule(id) {
  return TRANSFORM_REGISTRY.find((rule) => rule.id === id) || null;
}

export {
  unicodeRule,
  terminalRule,
  pathRule,
  tokenRule,
  urlRule,
  jsonPrettyRule,
  jsonCompactRule,
  envRule,
  gitRule,
  timestampRule,
};

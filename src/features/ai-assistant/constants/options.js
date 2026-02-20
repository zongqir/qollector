import { AI_ACTION_TASKS } from './actionProfiles';

export const AI_ASSISTANT_TASKS = AI_ACTION_TASKS;

export const AI_ASSISTANT_TONES = [
  'neutral',
  'professional',
  'friendly',
  'direct'
];

export const AI_ASSISTANT_LENGTHS = [
  'short',
  'medium',
  'long'
];

export const AI_OUTPUT_LANGUAGES = [
  'auto',
  'zh-CN',
  'en-US'
];

export const AI_TRANSLATE_LANGUAGES = [
  'zh-CN',
  'en-US'
];

export const isTranslateTask = (taskType) => taskType === 'translate';

export const AI_ASSISTANT_TASKS = [
  'summarize',
  'rewrite',
  'extract',
  'translate',
  'reply'
];

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

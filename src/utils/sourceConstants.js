export const QUICK_INPUT_SOURCE = 'Quick Input';
export const QUICK_NOTE_SOURCE = 'Quick Note';

const QOLLECT_INTERNAL_SOURCE_TOKENS = [
  'qollect',
  QUICK_INPUT_SOURCE.toLowerCase(),
  QUICK_NOTE_SOURCE.toLowerCase(),
];

export const isQollectManagedSource = (sourceApp) => {
  if (typeof sourceApp !== 'string') return false;
  const normalized = sourceApp.trim().toLowerCase().replace(/\.exe$/i, '');
  if (!normalized) return false;
  return QOLLECT_INTERNAL_SOURCE_TOKENS.some((token) => normalized.includes(token));
};

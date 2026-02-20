export const resolveOutputLanguageFromUi = (uiLanguage) => {
  const normalized = String(uiLanguage || '').trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en-US';
  return 'auto';
};

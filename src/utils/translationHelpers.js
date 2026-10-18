/**
 * Helpers for extracting and working with clipboard translation metadata.
 */

export const getTranslationFromMetadata = (metadata) => {
  if (!metadata) return null;
  try {
    const obj = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (obj && obj.translation && typeof obj.translation === 'object') {
      const { text, source_lang, target_lang, model, updated_at } = obj.translation;
      if (typeof text === 'string' && text.trim().length > 0) {
        return {
          text: text.trim(),
          source_lang: source_lang || 'auto',
          target_lang: target_lang || 'zh-CN',
          model: model || '',
          updated_at: updated_at || null,
        };
      }
    }
  } catch (_) {
    // Ignore JSON parse errors
  }
  return null;
};

export const hasTranslation = (item) => {
  return !!getTranslationFromMetadata(item?.metadata);
};

export const SUPPORTED_TRANSLATION_LANGUAGES = [
  { code: 'en', labelKey: 'settings.ai.languages.en' },
  { code: 'zh-CN', labelKey: 'settings.ai.languages.zh_cn' },
  { code: 'ja', labelKey: 'settings.ai.languages.ja' },
  { code: 'ko', labelKey: 'settings.ai.languages.ko' },
  { code: 'fr', labelKey: 'settings.ai.languages.fr' },
  { code: 'de', labelKey: 'settings.ai.languages.de' },
  { code: 'es', labelKey: 'settings.ai.languages.es' },
  { code: 'ru', labelKey: 'settings.ai.languages.ru' },
];

export const SUPPORTED_SOURCE_LANGUAGES = [
  { code: 'en', labelKey: 'settings.ai.languages.en' },
  { code: 'auto', labelKey: 'settings.ai.languages.auto' },
  { code: 'zh-CN', labelKey: 'settings.ai.languages.zh_cn' },
  { code: 'ja', labelKey: 'settings.ai.languages.ja' },
  { code: 'ko', labelKey: 'settings.ai.languages.ko' },
  { code: 'fr', labelKey: 'settings.ai.languages.fr' },
  { code: 'de', labelKey: 'settings.ai.languages.de' },
  { code: 'es', labelKey: 'settings.ai.languages.es' },
  { code: 'ru', labelKey: 'settings.ai.languages.ru' },
];

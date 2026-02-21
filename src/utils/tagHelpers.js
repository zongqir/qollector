const AI_TAG_PREFIX = 'AI:';
const SOURCE_TAG_PREFIXES = ['\u6765\u6e90:', 'Source:', 'source:', '\u93c9\u30e6\u7c2e:'];
const TYPE_TAG_PREFIXES = ['\u7c7b\u578b:', 'Type:', 'type:', '\u7eeb\u8bf2\u7037:'];
const RESERVED_TAG_PREFIXES = [
  AI_TAG_PREFIX.toLowerCase(),
  ...SOURCE_TAG_PREFIXES.map((prefix) => prefix.toLowerCase()),
  ...TYPE_TAG_PREFIXES.map((prefix) => prefix.toLowerCase()),
];

const findPrefix = (value, prefixes) => (
  prefixes.find((prefix) => value.startsWith(prefix)) || null
);

const withCustomPrefix = (prefixes, customPrefix) => {
  if (typeof customPrefix !== 'string') return prefixes;
  const normalized = customPrefix.trim();
  if (!normalized) return prefixes;
  return [normalized, ...prefixes];
};

const resolveTranslatedPrefix = (t, key, fallback) => {
  if (typeof t !== 'function') return fallback;
  const translated = t(key, { defaultValue: fallback });
  if (typeof translated !== 'string') return fallback;
  const normalized = translated.trim();
  return normalized || fallback;
};

export const getTags = (tagsStr) => {
  if (!tagsStr) return [];
  try {
    return JSON.parse(tagsStr);
  } catch {
    return [];
  }
};

export const getSourceApp = (metadataStr) => {
  if (!metadataStr) return 'Unknown';
  try {
    const metadata = JSON.parse(metadataStr);
    let appName = metadata.source_app || 'Unknown';
    if (appName.toLowerCase().endsWith('.exe')) {
      appName = appName.slice(0, -4);
    }
    return appName;
  } catch {
    return 'Unknown';
  }
};

export const getSourceDisplay = (metadataStr) => {
  if (!metadataStr) return null;
  try {
    const metadata = JSON.parse(metadataStr);
    const appName = getSourceApp(metadataStr);
    const windowTitle = metadata.window_title || '';
    if (appName === 'Unknown') return null;
    if (windowTitle.trim()) return `${appName} · ${windowTitle}`;
    return appName;
  } catch {
    return null;
  }
};

export const buildSourceTag = (sourceApp, t) => {
  if (!sourceApp || sourceApp === 'Unknown') return null;
  return `${resolveTranslatedPrefix(t, 'tag.source', 'Source:')}${sourceApp}`;
};

export const buildTypeTag = (itemType, t) => {
  if (!itemType) return null;
  const typeLabel = typeof t === 'function'
    ? t(`tag.types.${itemType}`, { defaultValue: itemType })
    : itemType;
  if (typeof typeLabel !== 'string' || !typeLabel.trim()) return null;
  return `${resolveTranslatedPrefix(t, 'tag.type', 'Type:')}${typeLabel}`;
};

export const parseSystemTag = (tag, options = {}) => {
  if (typeof tag !== 'string') {
    return { kind: 'user', displayText: '' };
  }
  if (tag.startsWith(AI_TAG_PREFIX)) {
    return { kind: 'ai', displayText: tag.slice(AI_TAG_PREFIX.length) };
  }

  const sourcePrefix = findPrefix(
    tag,
    withCustomPrefix(SOURCE_TAG_PREFIXES, options.sourcePrefix),
  );
  if (sourcePrefix) {
    return { kind: 'source', displayText: tag.slice(sourcePrefix.length) };
  }

  const typePrefix = findPrefix(
    tag,
    withCustomPrefix(TYPE_TAG_PREFIXES, options.typePrefix),
  );
  if (typePrefix) {
    return { kind: 'type', displayText: tag.slice(typePrefix.length) };
  }

  return { kind: 'user', displayText: tag };
};

export const hasReservedTagPrefix = (tag) => {
  const normalized = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
  if (!normalized) return false;
  return RESERVED_TAG_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

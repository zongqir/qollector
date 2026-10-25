const DEFAULT_FILENAME_STEM = 'qollect';
const MAX_FILENAME_STEM_LENGTH = 64;
const INVALID_FILENAME_CHARS_RE = /[<>:"/\\|?*\u0000-\u001F]/g;
const WINDOWS_RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const toMetadataObject = (metadata) => {
  if (!metadata) return {};
  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return { ...metadata };
  }
  if (typeof metadata !== 'string') return {};
  try {
    const parsed = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
};

const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim();

export const sanitizeFilenameStem = (value) => {
  if (typeof value !== 'string') return '';
  let normalized = normalizeWhitespace(value);
  if (!normalized) return '';

  normalized = normalized.replace(INVALID_FILENAME_CHARS_RE, '_');
  normalized = normalized.replace(/\.+$/g, '').trim();
  normalized = normalized.replace(/^\.*/g, '').trim();
  normalized = normalized.replace(/_+/g, '_').trim();
  normalized = normalized.replace(/\s+/g, ' ');

  if (!normalized) return '';

  if (normalized.length > MAX_FILENAME_STEM_LENGTH) {
    normalized = normalized.slice(0, MAX_FILENAME_STEM_LENGTH).trim();
  }

  const lower = normalized.toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(lower)) {
    normalized = `${normalized}_file`;
  }

  return normalized;
};

export const getFilenameStemFromMetadata = (metadata) => {
  const metadataObj = toMetadataObject(metadata);
  return sanitizeFilenameStem(metadataObj?.naming?.filename_stem || '');
};

export const getFilenameStemFromContent = (content) => {
  if (typeof content !== 'string') return '';
  const firstNonEmptyLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstNonEmptyLine) return '';
  return sanitizeFilenameStem(firstNonEmptyLine);
};

export const resolveFilenameStemForItem = (item) => {
  const byMetadata = getFilenameStemFromMetadata(item?.metadata);
  if (byMetadata) return byMetadata;

  const byContent = getFilenameStemFromContent(item?.content);
  if (byContent) return byContent;

  return DEFAULT_FILENAME_STEM;
};

export const mergeAiNamingIntoMetadata = (metadata, title) => {
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  const filenameStem = sanitizeFilenameStem(normalizedTitle);
  if (!filenameStem) return null;

  const metadataObj = toMetadataObject(metadata);
  const currentNaming = metadataObj.naming && typeof metadataObj.naming === 'object' && !Array.isArray(metadataObj.naming)
    ? metadataObj.naming
    : {};

  metadataObj.naming = {
    ...currentNaming,
    title: normalizedTitle,
    filename_stem: filenameStem,
    source: 'ai',
  };

  return JSON.stringify(metadataObj);
};

export const getAiRetrievalFromMetadata = (metadata) => {
  const metadataObj = toMetadataObject(metadata);
  const retrieval = metadataObj.ai_retrieval;
  if (!retrieval || typeof retrieval !== 'object' || Array.isArray(retrieval)) {
    return null;
  }
  return {
    summary: typeof retrieval.summary === 'string' ? retrieval.summary.trim() : '',
    queries: Array.isArray(retrieval.queries)
      ? retrieval.queries.map((q) => String(q).trim()).filter(Boolean)
      : [],
  };
};

export const mergeAiRetrievalIntoMetadata = (metadata, { summary, queries } = {}) => {
  const normalizedSummary = typeof summary === 'string' ? summary.trim() : '';
  const normalizedQueries = Array.isArray(queries)
    ? queries.map((q) => String(q).trim()).filter((q) => q && q.toLowerCase() !== 'none')
    : [];

  if (!normalizedSummary && normalizedQueries.length === 0) {
    return null;
  }

  const metadataObj = toMetadataObject(metadata);
  const currentRetrieval = metadataObj.ai_retrieval && typeof metadataObj.ai_retrieval === 'object' && !Array.isArray(metadataObj.ai_retrieval)
    ? metadataObj.ai_retrieval
    : {};

  metadataObj.ai_retrieval = {
    ...currentRetrieval,
    ...(normalizedSummary ? { summary: normalizedSummary } : {}),
    ...(normalizedQueries.length > 0 ? { queries: normalizedQueries } : {}),
  };

  return JSON.stringify(metadataObj);
};


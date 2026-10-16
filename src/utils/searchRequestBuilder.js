import { parseSystemTag } from './tagHelpers';

const TYPE_KEYS = ['text', 'image', 'file', 'link', 'code'];
const normalizeText = (value) => (typeof value === 'string' ? value : '');

export const OPEN_ENDED_DATE_MAX_TS = 253402300799;
export const SEARCH_REQUEST_TRIGGER_MODE = {
  ANY_STRUCTURED_FILTER: 'any_structured_filter',
  ADDITIONAL_STRUCTURED_FILTER: 'additional_structured_filter',
};

const resolveTypeKeyFromDisplay = (displayText, t, typeKeys = TYPE_KEYS) => {
  const normalized = normalizeText(displayText).trim().toLowerCase();
  if (!normalized) return null;

  for (const key of typeKeys) {
    const candidates = [
      key,
      t(`tag.types.${key}`, { defaultValue: key }),
      t(`search.typeFilter.${key}`, { defaultValue: key }),
    ]
      .map(value => normalizeText(value).trim().toLowerCase())
      .filter(Boolean);
    if (candidates.includes(normalized)) {
      return key;
    }
  }
  return null;
};

const buildTagFilterSets = (selectedTags, t, typeKeys = TYPE_KEYS) => {
  const selectedTagFilters = new Set();
  const selectedSourceFilters = new Set();
  const selectedTypeTagFilters = new Set();

  (Array.isArray(selectedTags) ? selectedTags : []).forEach((tag) => {
    const parsedTag = parseSystemTag(tag, {
      sourcePrefix: t('tag.source'),
      typePrefix: t('tag.type'),
    });

    if (parsedTag.kind === 'source') {
      const sourceName = normalizeText(parsedTag.displayText).trim();
      if (sourceName) selectedSourceFilters.add(sourceName);
      return;
    }

    if (parsedTag.kind === 'type') {
      const matchedTypeKey = resolveTypeKeyFromDisplay(parsedTag.displayText, t, typeKeys);
      if (matchedTypeKey) {
        selectedTypeTagFilters.add(matchedTypeKey);
        return;
      }
    }

    const normalizedTag = normalizeText(tag).trim();
    if (normalizedTag) selectedTagFilters.add(normalizedTag);
  });

  return {
    selectedTagFilters,
    selectedSourceFilters,
    selectedTypeTagFilters,
  };
};

export const buildSearchRequest = ({
  queryText = '',
  selectedType = 'all',
  selectedTags = [],
  showFavoritesOnly = false,
  selectedDateRange = null,
  baseFilters = {},
  triggerMode = SEARCH_REQUEST_TRIGGER_MODE.ANY_STRUCTURED_FILTER,
  t,
  typeKeys = TYPE_KEYS,
}) => {
  const query = normalizeText(queryText).trim();
  const filters = {
    ...((baseFilters && typeof baseFilters === 'object') ? baseFilters : {}),
  };
  let hasAdditionalStructuredFilters = false;

  const markAdditionalFilter = (key, value) => {
    filters[key] = value;
    hasAdditionalStructuredFilters = true;
  };

  if (selectedType === 'code') {
    markAdditionalFilter('require_code_language', true);
  } else if (selectedType !== 'all') {
    markAdditionalFilter('type_filter', selectedType);
  }

  if (showFavoritesOnly) {
    markAdditionalFilter('is_favorite', true);
  }

  const {
    selectedTagFilters,
    selectedSourceFilters,
    selectedTypeTagFilters,
  } = buildTagFilterSets(selectedTags, t, typeKeys);
  if (selectedTagFilters.size > 0) {
    markAdditionalFilter('tag_filter', Array.from(selectedTagFilters));
  }
  if (selectedSourceFilters.size > 0) {
    markAdditionalFilter('source_filter', Array.from(selectedSourceFilters));
  }
  if (selectedTypeTagFilters.size > 0) {
    markAdditionalFilter('type_tag_filter', Array.from(selectedTypeTagFilters));
  }

  const rangeStart = Number(selectedDateRange?.start);
  const rangeEnd = Number(selectedDateRange?.end);
  const hasStart = Number.isFinite(rangeStart);
  const hasEnd = Number.isFinite(rangeEnd);
  if (hasStart || hasEnd) {
    markAdditionalFilter('date_range', {
      start: hasStart ? rangeStart : 0,
      end: hasEnd ? rangeEnd : OPEN_ENDED_DATE_MAX_TS,
    });
  }

  const hasStructuredFilters = Object.keys(filters).length > 0;
  const shouldQueryStructured = triggerMode === SEARCH_REQUEST_TRIGGER_MODE.ADDITIONAL_STRUCTURED_FILTER
    ? hasAdditionalStructuredFilters
    : hasStructuredFilters;
  const shouldQueryBackend = query.length > 0 || shouldQueryStructured;

  return {
    query,
    filters: hasStructuredFilters ? filters : undefined,
    hasStructuredFilters,
    hasAdditionalStructuredFilters,
    shouldQueryBackend,
  };
};

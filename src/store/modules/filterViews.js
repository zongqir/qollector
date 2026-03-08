import {
  FILTER_VIEWS_STORAGE_KEY,
  WORKBENCH_FILTER_VIEWS_STORAGE_KEY,
} from '../../constants/storageKeys';

export const MAX_FILTER_VIEWS = 12;

const FILTER_TYPE_KEYS = new Set(['all', 'text', 'image', 'file', 'link', 'code']);

export const normalizeDateRange = (range) => {
  if (!range || typeof range !== 'object') return null;
  const parsedStart = range.start == null ? null : Number(range.start);
  const parsedEnd = range.end == null ? null : Number(range.end);
  return {
    preset: typeof range.preset === 'string' ? range.preset : 'custom',
    start: Number.isFinite(parsedStart) ? parsedStart : null,
    end: Number.isFinite(parsedEnd) ? parsedEnd : null,
  };
};

export const normalizeFilterPayload = (payload = {}) => {
  const selectedType = typeof payload.selectedType === 'string' && FILTER_TYPE_KEYS.has(payload.selectedType)
    ? payload.selectedType
    : 'all';
  return {
    searchQuery: typeof payload.searchQuery === 'string' ? payload.searchQuery : '',
    selectedType,
    selectedTags: Array.isArray(payload.selectedTags)
      ? Array.from(new Set(payload.selectedTags.filter((tag) => typeof tag === 'string' && tag.trim())))
      : [],
    showFavoritesOnly: Boolean(payload.showFavoritesOnly),
    showPinnedOnly: Boolean(payload.showPinnedOnly),
    selectedDateRange: normalizeDateRange(payload.selectedDateRange),
    customDateStart: typeof payload.customDateStart === 'string' ? payload.customDateStart : '',
    customDateEnd: typeof payload.customDateEnd === 'string' ? payload.customDateEnd : '',
  };
};

export const buildFilterPayloadFromState = (state) => normalizeFilterPayload({
  searchQuery: state.searchQuery,
  selectedType: state.selectedType,
  selectedTags: state.selectedTags,
  showFavoritesOnly: state.showFavoritesOnly,
  showPinnedOnly: state.showPinnedOnly,
  selectedDateRange: state.selectedDateRange,
  customDateStart: state.customDateStart,
  customDateEnd: state.customDateEnd,
});

export const buildWorkbenchFilterPayloadFromState = (state) => normalizeFilterPayload({
  searchQuery: state.workbenchSearchQuery,
  selectedType: state.workbenchSelectedType,
  selectedTags: state.workbenchSelectedTags,
  showFavoritesOnly: state.workbenchShowFavoritesOnly,
  showPinnedOnly: false,
  selectedDateRange: state.workbenchSelectedDateRange,
  customDateStart: state.workbenchCustomDateStart,
  customDateEnd: state.workbenchCustomDateEnd,
});

const normalizeSavedFilterView = (entry, fallbackIndex = 0) => {
  if (!entry || typeof entry !== 'object') return null;
  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name) return null;
  const createdAt = Number(entry.createdAt) || Date.now();
  const updatedAt = Number(entry.updatedAt) || createdAt;
  const fallbackId = `view_${createdAt}_${fallbackIndex}`;
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : fallbackId,
    name,
    createdAt,
    updatedAt,
    filters: normalizeFilterPayload(entry.filters),
  };
};

const readFilterViewsFromStorage = (storageKey, namespace) => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry, index) => normalizeSavedFilterView(entry, index))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_FILTER_VIEWS);
  } catch (error) {
    console.warn(`[${namespace}] read failed:`, error);
    return [];
  }
};

export const readSavedFilterViews = () => (
  readFilterViewsFromStorage(FILTER_VIEWS_STORAGE_KEY, 'FilterViews')
);

export const readWorkbenchSavedFilterViews = () => (
  readFilterViewsFromStorage(WORKBENCH_FILTER_VIEWS_STORAGE_KEY, 'WorkbenchFilterViews')
);

const persistFilterViewsToStorage = (storageKey, views, namespace) => {
  if (typeof window === 'undefined') return;
  try {
    const normalizedViews = (Array.isArray(views) ? views : [])
      .map((entry, index) => normalizeSavedFilterView(entry, index))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_FILTER_VIEWS);
    localStorage.setItem(storageKey, JSON.stringify(normalizedViews));
  } catch (error) {
    console.warn(`[${namespace}] persist failed:`, error);
  }
};

export const persistSavedFilterViews = (views) => (
  persistFilterViewsToStorage(FILTER_VIEWS_STORAGE_KEY, views, 'FilterViews')
);

export const persistWorkbenchSavedFilterViews = (views) => (
  persistFilterViewsToStorage(WORKBENCH_FILTER_VIEWS_STORAGE_KEY, views, 'WorkbenchFilterViews')
);

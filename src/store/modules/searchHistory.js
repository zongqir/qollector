import {
  COLLECTION_RECENT_SEARCHES_STORAGE_KEY,
  HISTORY_RECENT_SEARCHES_STORAGE_KEY,
  WORKBENCH_RECENT_SEARCHES_STORAGE_KEY,
} from '../../constants/storageKeys';

export const MAX_HISTORY_RECENT_SEARCHES = 10;

const normalizeRecentSearchEntry = (entry) => {
  if (typeof entry !== 'string') return '';
  return entry.trim();
};

export const normalizeHistoryRecentSearches = (entries) => {
  const deduped = [];
  const seen = new Set();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const normalized = normalizeRecentSearchEntry(entry);
    if (!normalized) return;
    const dedupeKey = normalized.toLocaleLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    deduped.push(normalized);
  });

  return deduped.slice(0, MAX_HISTORY_RECENT_SEARCHES);
};

const readRecentSearches = (storageKey, namespace) => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeHistoryRecentSearches(parsed);
  } catch (error) {
    console.warn(`[${namespace}] read failed:`, error);
    return [];
  }
};

const persistRecentSearches = (storageKey, entries, namespace) => {
  if (typeof window === 'undefined') return;

  try {
    const normalized = normalizeHistoryRecentSearches(entries);
    window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  } catch (error) {
    console.warn(`[${namespace}] persist failed:`, error);
  }
};

export const readHistoryRecentSearches = () => (
  readRecentSearches(HISTORY_RECENT_SEARCHES_STORAGE_KEY, 'HistoryRecentSearches')
);

export const readCollectionRecentSearches = () => (
  readRecentSearches(COLLECTION_RECENT_SEARCHES_STORAGE_KEY, 'CollectionRecentSearches')
);

export const readWorkbenchRecentSearches = () => (
  readRecentSearches(WORKBENCH_RECENT_SEARCHES_STORAGE_KEY, 'WorkbenchRecentSearches')
);

export const persistHistoryRecentSearches = (entries) => (
  persistRecentSearches(HISTORY_RECENT_SEARCHES_STORAGE_KEY, entries, 'HistoryRecentSearches')
);

export const persistCollectionRecentSearches = (entries) => (
  persistRecentSearches(COLLECTION_RECENT_SEARCHES_STORAGE_KEY, entries, 'CollectionRecentSearches')
);

export const persistWorkbenchRecentSearches = (entries) => (
  persistRecentSearches(WORKBENCH_RECENT_SEARCHES_STORAGE_KEY, entries, 'WorkbenchRecentSearches')
);

export const recordHistoryRecentSearch = (entries, query) => {
  const normalizedQuery = normalizeRecentSearchEntry(query);
  if (!normalizedQuery) {
    return normalizeHistoryRecentSearches(entries);
  }

  return normalizeHistoryRecentSearches([
    normalizedQuery,
    ...(Array.isArray(entries) ? entries : []),
  ]);
};

export const removeHistoryRecentSearch = (entries, query) => {
  const normalizedQuery = normalizeRecentSearchEntry(query);
  if (!normalizedQuery) {
    return normalizeHistoryRecentSearches(entries);
  }

  const dedupeKey = normalizedQuery.toLocaleLowerCase();
  return normalizeHistoryRecentSearches(
    (Array.isArray(entries) ? entries : []).filter((entry) => (
      normalizeRecentSearchEntry(entry).toLocaleLowerCase() !== dedupeKey
    )),
  );
};

import {
  ACTIVE_WORKBENCH_ID_STORAGE_KEY,
  WORKBENCH_SEARCH_SCOPE_STORAGE_KEY,
} from '../../constants/storageKeys';

export const WORKBENCH_SEARCH_SCOPE_CURRENT = 'current';
export const WORKBENCH_SEARCH_SCOPE_ALL = 'all';

export const readActiveWorkbenchId = () => {
  try {
    const raw = window.localStorage.getItem(ACTIVE_WORKBENCH_ID_STORAGE_KEY);
    const normalized = String(raw || '').trim();
    return normalized || null;
  } catch {
    return null;
  }
};

export const persistActiveWorkbenchId = (workbenchId) => {
  try {
    const normalized = String(workbenchId || '').trim();
    if (!normalized) {
      window.localStorage.removeItem(ACTIVE_WORKBENCH_ID_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_WORKBENCH_ID_STORAGE_KEY, normalized);
  } catch {
    // ignore storage failures
  }
};

export const readWorkbenchSearchScope = () => {
  try {
    const raw = String(window.localStorage.getItem(WORKBENCH_SEARCH_SCOPE_STORAGE_KEY) || '').trim().toLowerCase();
    return raw === WORKBENCH_SEARCH_SCOPE_ALL
      ? WORKBENCH_SEARCH_SCOPE_ALL
      : WORKBENCH_SEARCH_SCOPE_CURRENT;
  } catch {
    return WORKBENCH_SEARCH_SCOPE_CURRENT;
  }
};

export const persistWorkbenchSearchScope = (scope) => {
  try {
    const normalized = scope === WORKBENCH_SEARCH_SCOPE_ALL
      ? WORKBENCH_SEARCH_SCOPE_ALL
      : WORKBENCH_SEARCH_SCOPE_CURRENT;
    window.localStorage.setItem(WORKBENCH_SEARCH_SCOPE_STORAGE_KEY, normalized);
  } catch {
    // ignore storage failures
  }
};

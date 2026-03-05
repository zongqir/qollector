export const COLLECTION_HINTS_DISMISSED_KEY = 'qollect-collection-hints-dismissed-v1';
export const COLLECTION_HINTS_VISIBILITY_EVENT = 'qollect:collection-hints-visibility';

export function readCollectionHintsDismissed() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(COLLECTION_HINTS_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setCollectionHintsDismissed(dismissed) {
  if (typeof window === 'undefined') return;
  const normalized = Boolean(dismissed);
  try {
    if (normalized) {
      localStorage.setItem(COLLECTION_HINTS_DISMISSED_KEY, '1');
    } else {
      localStorage.removeItem(COLLECTION_HINTS_DISMISSED_KEY);
    }
  } catch {
    // Ignore storage write failures and still emit in-memory update.
  }

  window.dispatchEvent(new CustomEvent(COLLECTION_HINTS_VISIBILITY_EVENT, {
    detail: { dismissed: normalized },
  }));
}

import { HISTORY_STREAM_ENABLED_STORAGE_KEY } from '../../constants/storageKeys';

export const readHistoryStreamEnabled = () => {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(HISTORY_STREAM_ENABLED_STORAGE_KEY);
    if (raw == null) return true;
    return raw !== 'false';
  } catch (error) {
    console.warn('[HistoryStreamVisibility] read failed:', error);
    return true;
  }
};

export const persistHistoryStreamEnabled = (enabled) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HISTORY_STREAM_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    console.warn('[HistoryStreamVisibility] persist failed:', error);
  }
};

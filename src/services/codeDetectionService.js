import { invoke } from '@tauri-apps/api/core';
import { detectLanguage, loadHighlightJS } from '../hooks/useCodeHighlight';

const MAX_CANDIDATES_PER_RUN = 12;
const CONCURRENCY_LIMIT = 3;

const sortByUpdatedAtDesc = (a, b) => {
  const timeDiff = Number(b?.updated_at || 0) - Number(a?.updated_at || 0);
  if (timeDiff !== 0) return timeDiff;
  return String(b?.id || '').localeCompare(String(a?.id || ''));
};

export async function prewarmCodeLanguageDetection() {
  try {
    await loadHighlightJS();
  } catch {
    // Warmup is best-effort and should never block core flows.
  }
}

export async function detectAndUpdateCodeLanguage(items, updateItemInStore) {
  const candidates = items.filter(
    (item) => item.type_ === 'text' && !item.code_language && item.content
  );

  if (candidates.length === 0) return;

  const queue = candidates
    .sort(sortByUpdatedAtDesc)
    .slice(0, MAX_CANDIDATES_PER_RUN);
  const workerCount = Math.min(CONCURRENCY_LIMIT, queue.length);
  let index = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      const item = queue[currentIndex];
      if (!item) return;

      try {
        const language = await detectLanguage(item.content);
        if (language) {
          const updatedItem = {
            ...item,
            code_language: language,
          };
          await invoke('update_item', { item: updatedItem });
          updateItemInStore(item.id, language);
        }
      } catch (error) {
        console.error('Code language detection failed:', error);
      }
    }
  });

  await Promise.all(workers);
}

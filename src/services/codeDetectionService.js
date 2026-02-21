import { invoke } from '@tauri-apps/api/core';
import { detectLanguage } from '../hooks/useCodeHighlight';

const BATCH_SIZE = 5;

export async function detectAndUpdateCodeLanguage(items, updateItemInStore) {
  const candidates = items.filter(
    (item) => item.type_ === 'text' && !item.code_language && item.content
  );

  if (candidates.length === 0) return;

  const batch = candidates.slice(0, BATCH_SIZE);

  for (const item of batch) {
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
}

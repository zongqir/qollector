import { invoke } from '@tauri-apps/api/core';
import { getTags } from '../utils/tagHelpers';

export const generateAITagsForItem = async (item) => {
  if (!item.content) return null;

  const [aiTags, codeLanguage] = await invoke('generate_ai_tags', { content: item.content });

  if (aiTags && aiTags.length > 0) {
    // Code tags are factual (no "AI:" prefix); non-code tags get "AI:" prefix
    const taggedAI = codeLanguage
      ? aiTags
      : aiTags.map(tag => `AI:${tag}`);
    const existingTags = getTags(item.tags);
    const newTags = [...existingTags, ...taggedAI.filter(t => !existingTags.includes(t))];

    const updatedItem = {
      ...item,
      tags: JSON.stringify(newTags),
      code_language: codeLanguage || item.code_language || null,
      updated_at: Math.floor(Date.now() / 1000)
    };
    await invoke('update_item', { item: updatedItem });
    return newTags;
  }

  // Even if no tags, still save code_language if detected
  if (codeLanguage && codeLanguage !== item.code_language) {
    const updatedItem = {
      ...item,
      code_language: codeLanguage,
      updated_at: Math.floor(Date.now() / 1000)
    };
    await invoke('update_item', { item: updatedItem });
  }

  return null;
};

export const autoGenerateAITags = async (items, processedItemIds, setProcessedItemIds) => {
  if (processedItemIds.size > 200) {
    setProcessedItemIds(new Set());
    return;
  }

  let processedCount = 0;
  const maxConcurrent = 3;

  for (const item of items) {
    if (processedCount >= maxConcurrent) break;

    if (item.type_ === 'text' &&
        item.content &&
        !processedItemIds.has(item.id)) {

      const tags = getTags(item.tags);
      const hasAITags = tags.some(tag => tag.startsWith('AI:'));

      // Skip if already has AI tags or code_language
      if (!hasAITags && !item.code_language) {
        setProcessedItemIds(prev => new Set([...prev, item.id]));
        processedCount++;

        invoke('generate_ai_tags', { content: item.content })
          .then(([aiTags, codeLanguage]) => {
            if ((aiTags && aiTags.length > 0) || codeLanguage) {
              const taggedAI = codeLanguage
                ? (aiTags || [])
                : (aiTags || []).map(tag => `AI:${tag}`);
              const newTags = [...tags, ...taggedAI];

              const updatedItem = {
                ...item,
                tags: JSON.stringify(newTags),
                code_language: codeLanguage || null,
                updated_at: Math.floor(Date.now() / 1000)
              };
              return invoke('update_item', { item: updatedItem });
            }
          })
          .catch(error => {
            console.error('Auto AI tag generation failed (silent):', error);
          });
      } else {
        setProcessedItemIds(prev => new Set([...prev, item.id]));
      }
    }
  }
};

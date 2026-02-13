import { invoke } from '@tauri-apps/api/core';
import { getTags } from '../utils/tagHelpers';

export const generateAITagsForItem = async (item) => {
  if (!item.content) return null;

  const aiTags = await invoke('generate_ai_tags', { content: item.content });

  if (aiTags && aiTags.length > 0) {
    const taggedAI = aiTags.map(tag => `AI:${tag}`);
    const existingTags = getTags(item.tags);
    const newTags = [...existingTags, ...taggedAI.filter(t => !existingTags.includes(t))];

    const updatedItem = {
      ...item,
      tags: JSON.stringify(newTags),
      updated_at: Math.floor(Date.now() / 1000)
    };
    await invoke('update_item', { item: updatedItem });
    return newTags;
  }

  return null;
};

export const autoGenerateAITags = async (items, processedItemIds, setProcessedItemIds) => {
  let processedCount = 0;
  const maxConcurrent = 3;

  for (const item of items) {
    if (processedCount >= maxConcurrent) break;

    if (item.type_ === 'text' &&
        item.content &&
        !processedItemIds.has(item.id)) {

      const tags = getTags(item.tags);
      const hasAITags = tags.some(tag => tag.startsWith('AI:'));

      if (!hasAITags) {
        setProcessedItemIds(prev => new Set([...prev, item.id]));
        processedCount++;

        invoke('generate_ai_tags', { content: item.content })
          .then(aiTags => {
            if (aiTags && aiTags.length > 0) {
              const taggedAI = aiTags.map(tag => `AI:${tag}`);
              const newTags = [...tags, ...taggedAI];

              const updatedItem = {
                ...item,
                tags: JSON.stringify(newTags),
                updated_at: Math.floor(Date.now() / 1000)
              };
              return invoke('update_item', { item: updatedItem });
            }
          })
          .catch(error => {
            console.error('自动AI标签生成失败(静默):', error);
          });
      } else {
        setProcessedItemIds(prev => new Set([...prev, item.id]));
      }
    }
  }
};

import { invoke } from '@tauri-apps/api/core';
import { getTags } from '../utils/tagHelpers';
import {
  getFilenameStemFromMetadata,
  mergeAiNamingIntoMetadata,
  mergeAiRetrievalIntoMetadata,
} from '../utils/filenameNaming';

const toTaggedAITags = (aiTags) => (
  (aiTags || []).map((tag) => `AI:${tag}`)
);

const buildItemUpdateFromAIResult = (item, aiTags, codeLanguage, aiTitle, aiQueries = []) => {
  const existingTags = getTags(item.tags);
  const taggedAI = toTaggedAITags(aiTags);
  const mergedTags = [...existingTags];

  for (const tag of taggedAI) {
    if (!mergedTags.includes(tag)) {
      mergedTags.push(tag);
    }
  }

  const tagsChanged = mergedTags.length !== existingTags.length;
  const nextCodeLanguage = codeLanguage || item.code_language || null;
  const currentCodeLanguage = item.code_language || null;
  const codeLanguageChanged = nextCodeLanguage !== currentCodeLanguage;

  let nextMetadata = item.metadata || null;
  if (aiTitle) {
    const candidate = mergeAiNamingIntoMetadata(nextMetadata, aiTitle);
    if (candidate) nextMetadata = candidate;
  }
  if (aiTitle || (Array.isArray(aiQueries) && aiQueries.length > 0)) {
    const candidate = mergeAiRetrievalIntoMetadata(nextMetadata, {
      summary: aiTitle,
      queries: aiQueries,
    });
    if (candidate) nextMetadata = candidate;
  }
  const metadataChanged = nextMetadata !== (item.metadata || null);

  if (!tagsChanged && !codeLanguageChanged && !metadataChanged) {
    return null;
  }

  return {
    updatedItem: {
      ...item,
      tags: tagsChanged ? JSON.stringify(mergedTags) : item.tags,
      code_language: nextCodeLanguage,
      metadata: nextMetadata,
      updated_at: Math.floor(Date.now() / 1000),
    },
    mergedTags,
    tagsChanged,
  };
};

export const generateAITagsForItem = async (item) => {
  if (!item.content) return null;

  const [aiTags, codeLanguage, aiTitle, aiQueries] = await invoke('generate_ai_tags', { content: item.content });
  const updateResult = buildItemUpdateFromAIResult(item, aiTags, codeLanguage, aiTitle, aiQueries);
  if (!updateResult) return null;

  await invoke('update_item', { item: updateResult.updatedItem });
  return updateResult.tagsChanged ? updateResult.mergedTags : null;
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
      const hasNamingStem = !!getFilenameStemFromMetadata(item.metadata);

      // Keep auto-generation conservative to avoid request storms:
      // only fill items that have neither AI tags nor code language nor naming stem.
      if (!hasAITags && !item.code_language && !hasNamingStem) {
        setProcessedItemIds(prev => new Set([...prev, item.id]));
        processedCount++;

        invoke('generate_ai_tags', { content: item.content })
          .then(([aiTags, codeLanguage, aiTitle]) => {
            const updateResult = buildItemUpdateFromAIResult(item, aiTags, codeLanguage, aiTitle);
            if (updateResult) {
              return invoke('update_item', { item: updateResult.updatedItem });
            }
            return null;
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

export const translateClipboardItem = async (itemId, targetLang = null) => {
  return await invoke('translate_clipboard_item', {
    itemId,
    targetLang,
  });
};

import { invoke } from '@tauri-apps/api/core';

// Cache is stored in item.metadata as JSON:
// { share_cache: { [provider]: { url, expires_at } } }
export const getShareCache = (item, provider) => {
  try {
    const meta = JSON.parse(item.metadata || '{}');
    const entry = meta?.share_cache?.[provider];
    if (!entry?.url || !entry?.expires_at) return null;
    if (Date.now() / 1000 > entry.expires_at) return null;
    return entry;
  } catch {
    return null;
  }
};

export const saveShareCache = async (item, provider, url, ttlSeconds) => {
  try {
    const meta = JSON.parse(item.metadata || '{}');
    if (!meta.share_cache) meta.share_cache = {};
    meta.share_cache[provider] = {
      url,
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const updatedItem = {
      ...item,
      metadata: JSON.stringify(meta),
      updated_at: item.updated_at, // keep original updated_at
    };
    await invoke('update_item', { item: updatedItem });
    // Also update local item reference so subsequent calls see the cache
    item.metadata = updatedItem.metadata;
  } catch (error) {
    console.error('save share cache failed:', error);
  }
};

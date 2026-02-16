import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getTags } from '../utils/tagHelpers';
import { generateAITagsForItem, autoGenerateAITags as autoGenerateAITagsSvc } from '../services/aiService';
import { getRecentItemsLight, getMoreItems, copyItemToClipboard, deleteItem as deleteItemSvc } from '../services/clipboardService';
import { initOcrService } from '../services/ocrService';

const PAGE_SIZE = 50;
const MEMORY_PROBE_PREFIX = '[MemoryProbe]';

const toLen = (value) => (typeof value === 'string' ? value.length : 0);

const summarizeItemsForMemory = (items) => {
  let totalContentChars = 0;
  let totalOcrChars = 0;
  let totalNoteChars = 0;
  let maxContentChars = 0;
  let maxOcrChars = 0;
  let longContentItems = 0;
  let longOcrItems = 0;

  for (const item of items) {
    const contentLen = toLen(item?.content);
    const ocrLen = toLen(item?.ocr_text);
    const noteLen = toLen(item?.user_note);

    totalContentChars += contentLen;
    totalOcrChars += ocrLen;
    totalNoteChars += noteLen;

    if (contentLen > maxContentChars) maxContentChars = contentLen;
    if (ocrLen > maxOcrChars) maxOcrChars = ocrLen;
    if (contentLen >= 2000) longContentItems += 1;
    if (ocrLen >= 2000) longOcrItems += 1;
  }

  return {
    items: items.length,
    totalContentChars,
    totalOcrChars,
    totalNoteChars,
    maxContentChars,
    maxOcrChars,
    longContentItems,
    longOcrItems,
  };
};

const logItemsMemoryProbe = (stage, items, extra = {}) => {
  console.log(`${MEMORY_PROBE_PREFIX} ${stage}`, {
    ...summarizeItemsForMemory(items),
    ...extra,
  });
};

const sortByUpdatedAtDesc = (a, b) => {
  const timeDiff = (b?.updated_at || 0) - (a?.updated_at || 0);
  if (timeDiff !== 0) return timeDiff;
  return String(b?.id || '').localeCompare(String(a?.id || ''));
};

const mergeUniqueById = (baseItems, incomingItems) => {
  const map = new Map();
  [...baseItems, ...incomingItems].forEach((item) => {
    if (!item?.id) return;
    const prev = map.get(item.id);
    if (!prev || (item.updated_at || 0) >= (prev.updated_at || 0)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values()).sort(sortByUpdatedAtDesc);
};
const useAppStore = create((set, get) => ({
  // ========== 历史数据 ==========
  items: [],
  loading: true,
  hasMore: true,
  loadingMore: false,
  itemsRevision: 0,
  processedItemIds: new Set(),
  isMemorySuspended: false,

  // ========== 右栏面板状态机 ==========
  // 'collection' | 'preview'
  panelMode: 'collection',
  previewItem: null,

  // ========== 搜索/筛选 ==========
  searchQuery: '',
  debouncedSearchQuery: '',
  selectedType: 'all',
  selectedTags: [],
  showFavoritesOnly: false,
  showPinnedOnly: false,
  showTagFilter: false,
  tagSearchQuery: '',
  selectedDateRange: null,
  showDateFilter: false,
  customDateStart: '',
  customDateEnd: '',

  // ========== 多选状态 ==========
  selectedItemIds: [],

  // ========== UI 状态 ==========
  copiedItemId: null,
  generatingAI: null,
  ocrProcessing: null,
  showSettings: false,
  isAlwaysOnTop: false,
  isMiniMode: false,
  pinBeforeMini: false,

  // ========== 配置 ==========
  aiEnabled: false,
  ocrEnabled: false,
  maxPinnedItems: 3,
  themeMode: 'system',
  isLocked: true,
  hasPassword: false,

  // ========== 备注编辑 ==========
  editingNoteId: null,
  editNote: '',

  // ========== 标签管理 ==========
  addingTagItemId: null,
  newTagInput: '',

  // ========== 编辑弹窗 ==========
  showEditModal: false,
  editModalMode: 'new',
  editingItem: null,
  // ========== 面板 Actions ==========
  setPanelMode: (mode, item = null) => {
    if (mode === 'preview' && item) {
      set({ panelMode: 'preview', previewItem: item });
    } else {
      set({ panelMode: 'collection', previewItem: null });
    }
  },

  switchToCollection: () => {
    set({ panelMode: 'collection', previewItem: null });
  },

  // ========== 数据加载 Actions ==========
  loadItems: async () => {
    try {
      const result = await getRecentItemsLight(PAGE_SIZE);
      const { loading, processedItemIds } = get();
      const mergedItems = mergeUniqueById([], result);
      set((state) => ({
        items: mergedItems,
        hasMore: result.length >= PAGE_SIZE,
        itemsRevision: state.itemsRevision + 1,
      }));
      logItemsMemoryProbe('loadItems', mergedItems, {
        fetched: result.length,
        pageSize: PAGE_SIZE,
      });
      if (!loading) {
        autoGenerateAITagsSvc(result, processedItemIds, (updater) => {
          const current = get().processedItemIds;
          const next = typeof updater === 'function' ? updater(current) : updater;
          set({ processedItemIds: next });
        });
      }

      if (loading) set({ loading: false });
    } catch (error) {
      console.error('加载失败:', error);
      if (get().loading) set({ loading: false });
    }
  },

  loadMore: async () => {
    const { hasMore, loadingMore, items, itemsRevision } = get();
    if (!hasMore || loadingMore) return;
    set({ loadingMore: true });
    const requestOffset = items.length;
    const requestRevision = itemsRevision;
    try {
      const more = await getMoreItems(PAGE_SIZE, requestOffset);
      if (get().itemsRevision !== requestRevision) return;
      let mergedItemsSnapshot = null;
      set((state) => ({
        items: (() => {
          const merged = mergeUniqueById(state.items, more);
          mergedItemsSnapshot = merged;
          return merged;
        })(),
        hasMore: more.length >= PAGE_SIZE,
      }));
      if (mergedItemsSnapshot) {
        logItemsMemoryProbe('loadMore', mergedItemsSnapshot, {
          fetched: more.length,
          offset: requestOffset,
          pageSize: PAGE_SIZE,
          hasMoreAfter: more.length >= PAGE_SIZE,
        });
      }
    } catch (error) {
      console.error('加载更多失败:', error);
    } finally {
      set({ loadingMore: false });
    }
  },

  suspendForMinimize: () => {
    const state = get();
    if (state.isMemorySuspended) return;

    set({
      items: [],
      hasMore: true,
      loadingMore: false,
      itemsRevision: state.itemsRevision + 1,
      processedItemIds: new Set(),
      panelMode: 'collection',
      previewItem: null,
      isMemorySuspended: true,
    });
    console.log('[MemorySuspend] detached heavy list state while minimized');
  },

  resumeFromMinimize: async () => {
    const state = get();
    if (!state.isMemorySuspended) return;

    set({ isMemorySuspended: false, loading: true });
    console.log('[MemorySuspend] restoring list state after window became visible');
    await get().loadItems();
  },

  loadConfigs: async () => {
    try {
      const [aiConfig, ocrConfig, generalConfig, hasLock] = await Promise.all([
        invoke('get_ai_config'),
        invoke('get_ocr_config'),
        invoke('get_general_config'),
        invoke('has_lock_password')
      ]);
      set({
        aiEnabled: aiConfig.enabled || false,
        ocrEnabled: ocrConfig.enabled || false,
        maxPinnedItems: generalConfig.max_pinned_items || 3,
        hasPassword: hasLock,
        isLocked: hasLock,
      });
      if (generalConfig.theme_mode) {
        set({ themeMode: generalConfig.theme_mode });
      }
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  },

  // ========== 剪贴板操作 ==========
  handleCopy: async (item) => {
    try {
      await copyItemToClipboard(item);
      set({ copiedItemId: item.id });
      setTimeout(() => set({ copiedItemId: null }), 1000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  },

  togglePin: async (item) => {
    try {
      const { maxPinnedItems, loadItems } = get();
      await invoke('toggle_pin_item', { id: item.id, maxPinned: maxPinnedItems });
      await loadItems();
    } catch (error) {
      console.error('切换置顶失败:', error);
    }
  },

  toggleFavorite: async (item) => {
    try {
      await invoke('toggle_favorite_item', { id: item.id });
      await get().loadItems();
    } catch (error) {
      console.error('切换收藏失败:', error);
    }
  },

  generateAITags: async (item) => {
    if (!item.content) return;
    set({ generatingAI: item.id });
    try {
      await generateAITagsForItem(item);
      await get().loadItems();
    } catch (error) {
      console.error('AI 标签生成失败:', error);
    } finally {
      set({ generatingAI: null });
    }
  },
  handleOCR: async (item) => {
    if (!item.image_paths) return;
    set({ ocrProcessing: item.id });
    try {
      const paths = JSON.parse(item.image_paths);
      const imagePath = paths.raw || paths.original;
      await invoke('recognize_and_update', { itemId: item.id, imagePath });
      await get().loadItems();
    } catch (error) {
      console.error('OCR 识别失败:', error);
    } finally {
      set({ ocrProcessing: null });
    }
  },

  handleOpenItem: async (item) => {
    try {
      await invoke('open_item', { id: item.id });
    } catch (error) {
      console.error('打开失败:', error);
    }
  },

  deleteItem: async (item) => {
    try {
      await deleteItemSvc(item.id);
      const { items } = get();
      set({
        items: items.filter(i => i.id !== item.id),
        panelMode: 'collection',
        previewItem: null,
      });
    } catch (error) {
      console.error('删除失败:', error);
    }
  },

  // ========== 备注 Actions ==========
  startEditNote: (item) => {
    set({ editingNoteId: item.id, editNote: item.user_note || '' });
  },

  saveNote: async (item) => {
    try {
      const { editNote, loadItems } = get();
      const updatedItem = {
        ...item,
        user_note: editNote,
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await loadItems();
      set({ editingNoteId: null, editNote: '' });
    } catch (error) {
      console.error('保存备注失败:', error);
    }
  },

  cancelNoteEdit: () => {
    set({ editingNoteId: null, editNote: '' });
  },

  // ========== 标签 Actions ==========
  startAddTag: (item) => {
    set({ addingTagItemId: item.id, newTagInput: '' });
  },

  cancelAddTag: () => {
    set({ addingTagItemId: null, newTagInput: '' });
  },

  addTagToItem: async (item, tagToAdd) => {
    try {
      const existingTags = getTags(item.tags);
      if (existingTags.includes(tagToAdd)) {
        get().cancelAddTag();
        return;
      }
      const newTags = [...existingTags, tagToAdd];
      const updatedItem = {
        ...item,
        tags: JSON.stringify(newTags),
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await get().loadItems();
      get().cancelAddTag();
    } catch (error) {
      console.error('添加标签失败:', error);
    }
  },

  // ========== 多选 Actions ==========
  toggleSelectItem: (itemId) => {
    const { selectedItemIds } = get();
    if (selectedItemIds.includes(itemId)) {
      set({ selectedItemIds: selectedItemIds.filter(id => id !== itemId) });
    } else {
      set({ selectedItemIds: [...selectedItemIds, itemId] });
    }
  },

  clearSelection: () => {
    set({ selectedItemIds: [] });
  },

  deleteSelectedItems: async () => {
    const { selectedItemIds, items } = get();
    if (selectedItemIds.length === 0) return;
    try {
      for (const id of selectedItemIds) {
        await deleteItemSvc(id);
      }
      set({
        items: items.filter(i => !selectedItemIds.includes(i.id)),
        selectedItemIds: [],
        panelMode: 'collection',
        previewItem: null,
      });
    } catch (error) {
      console.error('batch delete failed:', error);
    }
  },

  copySelectedItemsMerged: async () => {
    const { selectedItemIds, items } = get();
    if (selectedItemIds.length === 0) return;
    try {
      const idSet = new Set(selectedItemIds);
      const selectedItems = items.filter(i => idSet.has(i.id));
      const merged = selectedItems.map(i => i.content || '').filter(Boolean).join('\n');
      if (!merged) return;
      const tempItem = {
        id: 'temp-merge',
        type_: 'text',
        content: merged,
        is_pinned: false,
        is_favorite: false,
        is_deleted: false,
        tags: '[]',
        metadata: '{}',
        image_paths: null,
        ocr_text: null,
        user_note: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };
      await copyItemToClipboard(tempItem);
      set({ copiedItemId: 'merge-success', selectedItemIds: [] });
      setTimeout(() => set({ copiedItemId: null }), 1000);
    } catch (error) {
      console.error('merge copy failed:', error);
    }
  },

  // ========== 筛选 Actions ==========
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedType: (t) => set({ selectedType: t }),
  setSelectedTags: (tags) => set({ selectedTags: tags }),
  setShowFavoritesOnly: (v) => set({ showFavoritesOnly: v }),
  setShowPinnedOnly: (v) => set({ showPinnedOnly: v }),
  setShowTagFilter: (v) => set({ showTagFilter: v }),
  setTagSearchQuery: (q) => set({ tagSearchQuery: q }),
  setSelectedDateRange: (range) => set({ selectedDateRange: range }),
  setShowDateFilter: (v) => set({ showDateFilter: v }),
  setCustomDateStart: (v) => set({ customDateStart: v }),
  setCustomDateEnd: (v) => set({ customDateEnd: v }),
  clearDateFilter: () => set({ selectedDateRange: null, customDateStart: '', customDateEnd: '', showDateFilter: false }),

  toggleTagFilter: (tag) => {
    const { selectedTags } = get();
    set({
      selectedTags: selectedTags.includes(tag)
        ? selectedTags.filter(t => t !== tag)
        : [...selectedTags, tag]
    });
  },

  handleTagClick: (tag) => {
    const { selectedTags } = get();
    set({
      selectedTags: selectedTags.includes(tag)
        ? selectedTags.filter(t => t !== tag)
        : [...selectedTags, tag]
    });
  },

  // ========== 编辑弹窗 Actions ==========
  openEditModal: (item = null) => {
    if (item) {
      set({ editModalMode: 'edit', editingItem: item, showEditModal: true });
    } else {
      set({ editModalMode: 'new', editingItem: null, showEditModal: true });
    }
  },

  handleEditModalSave: async (data) => {
    const { editModalMode, editingItem, loadItems } = get();
    try {
      if (editModalMode === 'new') {
        await invoke('add_clipboard_item_manual', {
          content: data.content,
          contentType: 'text',
          source: '快速输入',
          autoFavorite: false
        });
        if (data.tags.length > 0 || data.note) {
          await loadItems();
          const newItems = await invoke('get_recent_items', { limit: 100 });
          const newItem = newItems[0];
          if (newItem) {
            const updatedItem = {
              ...newItem,
              user_note: data.note,
              tags: JSON.stringify(data.tags),
              updated_at: Math.floor(Date.now() / 1000)
            };
            await invoke('update_item', { item: updatedItem });
          }
        }
      } else {
        const updatedItem = {
          ...editingItem,
          content: data.content || editingItem.content,
          user_note: data.note,
          tags: JSON.stringify(data.tags),
          updated_at: Math.floor(Date.now() / 1000)
        };
        await invoke('update_item', { item: updatedItem });
      }
      await loadItems();
      set({ showEditModal: false, editingItem: null });
    } catch (error) {
      console.error('保存失败:', error);
    }
  },

  handleEditModalCancel: () => {
    set({ showEditModal: false, editingItem: null });
  },

  // ========== UI Actions ==========
  setShowSettings: (v) => set({ showSettings: v }),
  setIsAlwaysOnTop: (v) => set({ isAlwaysOnTop: v }),
  setIsMiniMode: (v) => set({ isMiniMode: v }),
  setPinBeforeMini: (v) => set({ pinBeforeMini: v }),
  setIsLocked: (v) => set({ isLocked: v }),
  setThemeMode: (v) => set({ themeMode: v }),
  setEditNote: (v) => set({ editNote: v }),
  setNewTagInput: (v) => set({ newTagInput: v }),
  setCopiedItemId: (v) => set({ copiedItemId: v }),
  setDebouncedSearchQuery: (v) => set({ debouncedSearchQuery: v }),

  // ========== 快速笔记 (搜集箱) ==========
  addQuickNote: async (content) => {
    if (!content.trim()) return;
    try {
      const { maxPinnedItems, loadItems } = get();
      // 创建新条目
      await invoke('add_clipboard_item_manual', {
        content: content.trim(),
        contentType: 'text',
        source: '快速笔记',
        autoFavorite: false
      });
      // 获取刚创建的条目并 pin 它
      const newItems = await invoke('get_recent_items', { limit: 1 });
      if (newItems[0]) {
        await invoke('toggle_pin_item', { id: newItems[0].id, maxPinned: maxPinnedItems });
      }
      await loadItems();
    } catch (error) {
      console.error('快速笔记添加失败:', error);
    }
  },

  // ========== 合并复制 ==========
  mergeCopyPinned: async () => {
    try {
      const { items } = get();
      const pinnedItems = items.filter(i => i.is_pinned);
      const merged = pinnedItems.map(i => i.content || '').join('\n\n');
      if (merged) {
        // 构造临时 item 用于复制
        const tempItem = {
          id: 'temp-merge',
          type_: 'text',
          content: merged,
          is_pinned: false,
          is_favorite: false,
          is_deleted: false,
          tags: '[]',
          metadata: '{}',
          image_paths: null,
          ocr_text: null,
          user_note: null,
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        };
        await copyItemToClipboard(tempItem);
        set({ copiedItemId: 'merge-success' });
        setTimeout(() => set({ copiedItemId: null }), 1000);
      }
    } catch (error) {
      console.error('合并复制失败:', error);
    }
  },

  // ========== 清空搜集箱 ==========
  clearAllPinned: async () => {
    try {
      const { items, loadItems } = get();
      const pinnedItems = items.filter(i => i.is_pinned);
      for (const item of pinnedItems) {
        await invoke('toggle_pin_item', { id: item.id, maxPinned: 999 });
      }
      await loadItems();
      set({ panelMode: 'collection', previewItem: null });
    } catch (error) {
      console.error('清空搜集箱失败:', error);
    }
  },
}));

export default useAppStore;

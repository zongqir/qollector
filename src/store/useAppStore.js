import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getTags } from '../utils/tagHelpers';
import { generateAITagsForItem, autoGenerateAITags as autoGenerateAITagsSvc } from '../services/aiService';
import { getRecentItemsLight, getMoreItems, copyItemToClipboard, deleteItem as deleteItemSvc } from '../services/clipboardService';
import { initOcrService } from '../services/ocrService';

const PAGE_SIZE = 50;

const useAppStore = create((set, get) => ({
  // ========== 历史数据 ==========
  items: [],
  loading: true,
  hasMore: true,
  loadingMore: false,
  processedItemIds: new Set(),

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
  showTagFilter: false,
  tagSearchQuery: '',

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
      set({ items: result, hasMore: result.length >= PAGE_SIZE });

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
    const { hasMore, loadingMore, items } = get();
    if (!hasMore || loadingMore) return;
    set({ loadingMore: true });
    try {
      const more = await getMoreItems(PAGE_SIZE, items.length);
      if (more.length < PAGE_SIZE) set({ hasMore: false });
      set({ items: [...items, ...more] });
    } catch (error) {
      console.error('加载更多失败:', error);
    } finally {
      set({ loadingMore: false });
    }
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

  // ========== 筛选 Actions ==========
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedType: (t) => set({ selectedType: t }),
  setSelectedTags: (tags) => set({ selectedTags: tags }),
  setShowFavoritesOnly: (v) => set({ showFavoritesOnly: v }),
  setShowTagFilter: (v) => set({ showTagFilter: v }),
  setTagSearchQuery: (q) => set({ tagSearchQuery: q }),

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

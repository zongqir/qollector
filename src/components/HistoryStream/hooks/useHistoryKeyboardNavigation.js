import { useCallback, useEffect } from 'react';

export default function useHistoryKeyboardNavigation({
  filteredItems,
  focusedIndex,
  setFocusedIndex,
  shouldUseHoverPreview,
  setExpandedPreviewItemId,
  setPanelMode,
  handleCopy,
  handleCopyAndAutoPaste,
  clearExpandedPreview,
  selectedItemIds,
  historyTagShortcutEnabled,
  panelMode,
  setSelectedItemIds,
  toggleSelectItem,
  openBatchTagEditor,
  deleteSelectedItems,
  copySelectedItemsMerged,
  clearSelection,
  selectionAnchorIndexRef,
  historyGrouping,
  virtuosoRef,
  searchInputId = 'history-search-input',
}) {
  const moveFocusedSelection = useCallback((dir) => {
    const total = filteredItems.length;
    if (total === 0) return;

    const next = focusedIndex < 0
      ? (dir === 1 ? 0 : total - 1)
      : Math.max(0, Math.min(total - 1, focusedIndex + dir));

    setFocusedIndex(next);
    virtuosoRef.current?.scrollIntoView({ index: next, behavior: 'auto', align: 'end' });

    const nextItem = filteredItems[next];
    if (!nextItem) return;

    if (shouldUseHoverPreview) {
      setExpandedPreviewItemId(nextItem.id);
      return;
    }

    setPanelMode('preview', nextItem);
  }, [filteredItems, focusedIndex, setFocusedIndex, shouldUseHoverPreview, setExpandedPreviewItemId, setPanelMode, virtuosoRef]);

  const submitFocusedSelection = useCallback(() => {
    if (focusedIndex < 0 || focusedIndex >= filteredItems.length) return false;

    const focusedItem = filteredItems[focusedIndex];
    if (focusedItem.type_ === 'image' || focusedItem.type_ === 'file') {
      handleCopy(focusedItem, 'history');
    } else {
      handleCopyAndAutoPaste(focusedItem, 'history');
    }
    return true;
  }, [focusedIndex, filteredItems, handleCopy, handleCopyAndAutoPaste]);

  const handleSearchInputKeyDown = useCallback((e) => {
    if (e.nativeEvent?.isComposing || e.isComposing) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocusedSelection(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (e.key === 'Enter' && submitFocusedSelection()) {
      e.preventDefault();
    }
  }, [moveFocusedSelection, submitFocusedSelection]);

  const focusSearchInput = useCallback(() => {
    const input = document.getElementById(searchInputId);
    if (!input) return;
    input.focus();
    const length = input.value?.length ?? 0;
    input.setSelectionRange?.(length, length);
  }, [searchInputId]);

  useEffect(() => {
    if (!shouldUseHoverPreview) {
      clearExpandedPreview();
    }
  }, [shouldUseHoverPreview, clearExpandedPreview]);

  useEffect(() => {
    if (selectedItemIds.length > 0) {
      clearExpandedPreview();
    }
  }, [selectedItemIds.length, clearExpandedPreview]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const tag = target?.tagName;

      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      if (target?.closest('.collection-panel') || document.activeElement?.closest?.('.collection-panel')) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocusedSelection(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === '/') {
        e.preventDefault();
        focusSearchInput();
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const groupMap = { '1': 'today', '2': 'yesterday', '3': 'last7', '4': 'older' };
        const targetGroup = groupMap[e.key];
        if (!targetGroup) return;
        const targetIndex = historyGrouping.firstIndexByGroup[targetGroup];
        if (typeof targetIndex !== 'number') return;
        virtuosoRef.current?.scrollToIndex?.({
          index: targetIndex,
          align: 'start',
          behavior: 'smooth',
        });
        setFocusedIndex(targetIndex);
        return;
      }

      if (e.key === 'Enter' && submitFocusedSelection()) {
        e.preventDefault();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        if (filteredItems.length === 0) return;
        e.preventDefault();
        setSelectedItemIds(filteredItems.map(item => item.id));
        setFocusedIndex(0);
        selectionAnchorIndexRef.current = 0;
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 't') {
        if (!historyTagShortcutEnabled) return;
        e.preventDefault();
        if (panelMode === 'preview' && selectedItemIds.length === 0) {
          return;
        }
        if (selectedItemIds.length === 0) {
          const focusedItem = focusedIndex >= 0 && focusedIndex < filteredItems.length
            ? filteredItems[focusedIndex]
            : null;
          if (!focusedItem) return;
          toggleSelectItem(focusedItem.id);
        }
        openBatchTagEditor();
        return;
      }

      if (selectedItemIds.length === 0 && focusedIndex < 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedItems();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelectedItemsMerged(filteredItems);
      } else if (e.key === 'Escape') {
        clearSelection();
        setFocusedIndex(-1);
        if (shouldUseHoverPreview) {
          clearExpandedPreview();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedItemIds.length,
    deleteSelectedItems,
    copySelectedItemsMerged,
    clearSelection,
    historyTagShortcutEnabled,
    panelMode,
    focusedIndex,
    filteredItems,
    setSelectedItemIds,
    toggleSelectItem,
    openBatchTagEditor,
    moveFocusedSelection,
    submitFocusedSelection,
    setFocusedIndex,
    focusSearchInput,
    historyGrouping,
    selectionAnchorIndexRef,
    virtuosoRef,
    shouldUseHoverPreview,
    clearExpandedPreview,
  ]);

  return {
    handleSearchInputKeyDown,
  };
}

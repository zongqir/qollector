import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

function getExternalFilePaths(item) {
  if (item.type_ === 'file' && item.content) {
    return item.content
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  if (item.type_ === 'image' && item.image_paths) {
    try {
      const paths = JSON.parse(item.image_paths);
      const original = paths.original || paths.raw;
      return original ? [original] : [];
    } catch {
      return [];
    }
  }

  return [];
}

function getDragText(item, externalPaths) {
  if (item.type_ === 'text') return item.content || '';
  if (item.type_ === 'file') return item.content || externalPaths.join('\n');
  if (item.type_ === 'image') return item.ocr_text || externalPaths[0] || item.content || '';
  return item.content || '';
}

export default function useHistoryRowInteractions({
  filteredItems,
  selectedItemIds,
  panelMode,
  previewItemId,
  focusedIndex,
  shouldUseHoverPreview,
  hoverPreviewItem,
  selectionAnchorIndexRef,
  supportsNativeExternalDrag,
  setSelectedItemIds,
  setFocusedIndex,
  setPanelMode,
  toggleSelectItem,
  clearSelection,
  setHoverPreview,
  clearHoverPreview,
  handleCopyAndAutoPaste,
  handleCopy,
  switchToCollection,
}) {
  const clickTimerRef = useRef(null);

  useEffect(() => () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const handleCardClick = useCallback((item, index, e) => {
    e.stopPropagation();
    if (typeof index !== 'number' || index < 0 || index >= filteredItems.length) return;

    if (e.shiftKey) {
      e.preventDefault();
      const anchorCandidate = selectionAnchorIndexRef.current >= 0
        ? selectionAnchorIndexRef.current
        : (focusedIndex >= 0 ? focusedIndex : index);
      const anchorIndex = Math.max(0, Math.min(filteredItems.length - 1, anchorCandidate));
      const start = Math.min(anchorIndex, index);
      const end = Math.max(anchorIndex, index);
      const rangeIds = filteredItems.slice(start, end + 1).map(candidate => candidate.id);
      if (rangeIds.length > 0) {
        setSelectedItemIds(rangeIds);
        setFocusedIndex(index);
        selectionAnchorIndexRef.current = anchorIndex;
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const shouldIncludePreviewSelection =
        selectedItemIds.length === 0 &&
        panelMode === 'preview' &&
        previewItemId &&
        previewItemId !== item.id &&
        filteredItems.some(candidate => candidate.id === previewItemId);

      if (shouldIncludePreviewSelection) {
        toggleSelectItem(previewItemId);
      }
      toggleSelectItem(item.id);
      setFocusedIndex(index);
      selectionAnchorIndexRef.current = index;
      return;
    }

    if (selectedItemIds.length > 0) {
      clearSelection();
    }

    selectionAnchorIndexRef.current = index;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    if (shouldUseHoverPreview) {
      if (hoverPreviewItem?.id === item.id) {
        clearHoverPreview();
        return;
      }
      clickTimerRef.current = setTimeout(() => {
        const el = document.querySelector(`[data-item-id="${item.id}"]`);
        const rect = el ? el.getBoundingClientRect() : e.currentTarget.getBoundingClientRect();
        setHoverPreview(item, { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom });
        clickTimerRef.current = null;
      }, 250);
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      setPanelMode('preview', item);
      clickTimerRef.current = null;
    }, 250);
  }, [
    filteredItems,
    selectionAnchorIndexRef,
    focusedIndex,
    setSelectedItemIds,
    setFocusedIndex,
    selectedItemIds.length,
    panelMode,
    previewItemId,
    toggleSelectItem,
    clearSelection,
    shouldUseHoverPreview,
    hoverPreviewItem,
    clearHoverPreview,
    setHoverPreview,
    setPanelMode,
  ]);

  const handleCardDoubleClick = useCallback((item, e) => {
    e.stopPropagation();
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clearHoverPreview();
    if (item.type_ === 'image' || item.type_ === 'file') {
      handleCopy(item, 'history');
    } else {
      handleCopyAndAutoPaste(item, 'history');
    }
  }, [handleCopyAndAutoPaste, handleCopy, clearHoverPreview]);

  const handleStartExternalDrag = useCallback(async (item) => {
    if (!supportsNativeExternalDrag) return;
    const paths = getExternalFilePaths(item);
    if (paths.length === 0) return;

    try {
      await invoke('start_native_file_drag', {
        paths,
        operation: 'copy',
      });
    } catch (error) {
      console.error('native drag out failed:', error);
    }
  }, [supportsNativeExternalDrag]);

  const handleDragStart = useCallback((item, e) => {
    const externalPaths = getExternalFilePaths(item);
    if (supportsNativeExternalDrag && externalPaths.length > 0 && !e.shiftKey) {
      e.preventDefault();
      handleStartExternalDrag(item);
      return;
    }

    const text = getDragText(item, externalPaths);
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.setData('application/x-qollect-item', JSON.stringify({ id: item.id }));
    e.dataTransfer.effectAllowed = 'copyMove';
    switchToCollection();

    const dragEl = document.createElement('div');
    dragEl.textContent = text.substring(0, 40) + (text.length > 40 ? '...' : '');
    dragEl.style.cssText = 'position:absolute;top:-999px;padding:4px 8px;background:#333;color:#fff;border-radius:4px;font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;';
    document.body.appendChild(dragEl);
    e.dataTransfer.setDragImage(dragEl, 0, 0);
    setTimeout(() => document.body.removeChild(dragEl), 0);
  }, [supportsNativeExternalDrag, handleStartExternalDrag, switchToCollection]);

  const handleStreamClick = useCallback(() => {
    if (selectedItemIds.length > 0) {
      clearSelection();
      return;
    }
    if (shouldUseHoverPreview) {
      clearHoverPreview();
      return;
    }
    if (panelMode === 'preview') {
      switchToCollection();
    }
  }, [panelMode, switchToCollection, selectedItemIds.length, clearSelection, shouldUseHoverPreview, clearHoverPreview]);

  return {
    handleCardClick,
    handleCardDoubleClick,
    handleStartExternalDrag,
    handleDragStart,
    handleStreamClick,
  };
}

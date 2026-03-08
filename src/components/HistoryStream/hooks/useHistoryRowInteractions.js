import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { INTERNAL_DRAG_MIME } from '../../../constants/dragDrop';
import { resolveFilenameStemForItem } from '../../../utils/filenameNaming';
import { PREVIEW_CLICK_DELAY_MS, openItemPreview } from '../../../utils/previewInteractionPolicy';

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

function canDragTextAsFile(item) {
  return item?.type_ === 'text'
    && typeof item.content === 'string'
    && item.content.trim().length > 0;
}

export default function useHistoryRowInteractions({
  filteredItems,
  selectedItemIds,
  panelMode,
  previewItemId,
  focusedIndex,
  shouldUseHoverPreview,
  expandedPreviewItemId,
  selectionAnchorIndexRef,
  supportsNativeExternalDrag,
  setSelectedItemIds,
  setFocusedIndex,
  setPanelMode,
  toggleSelectItem,
  clearSelection,
  setExpandedPreviewItemId,
  clearExpandedPreview,
  handleCopyAndAutoPaste,
  handleCopy,
  switchToWorkbench,
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
      e.preventDefault();
      toggleSelectItem(item.id);
      setFocusedIndex(index);
      selectionAnchorIndexRef.current = index;
      return;
    }

    selectionAnchorIndexRef.current = index;
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    if (shouldUseHoverPreview) {
      if (expandedPreviewItemId === item.id) {
        clearExpandedPreview();
        return;
      }
      clickTimerRef.current = setTimeout(() => {
        setExpandedPreviewItemId(item.id);
        clickTimerRef.current = null;
      }, 250);
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      openItemPreview(setPanelMode, item);
      clickTimerRef.current = null;
    }, PREVIEW_CLICK_DELAY_MS);
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
    expandedPreviewItemId,
    clearExpandedPreview,
    setExpandedPreviewItemId,
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
    clearExpandedPreview();
    if (item.type_ === 'image' || item.type_ === 'file') {
      handleCopy(item, 'history');
    } else {
      handleCopyAndAutoPaste(item, 'history');
    }
  }, [handleCopyAndAutoPaste, handleCopy, clearExpandedPreview]);

  const handleStartExternalDrag = useCallback(async (item) => {
    if (!supportsNativeExternalDrag) return;

    try {
      if (canDragTextAsFile(item)) {
        await invoke('start_native_text_drag', {
          content: item.content,
          language: item.code_language || null,
          filenameStem: resolveFilenameStemForItem(item),
          operation: 'copy',
        });
        return;
      }

      const paths = getExternalFilePaths(item);
      if (paths.length === 0) return;

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
    const nativeTextDrag = canDragTextAsFile(item);
    if (supportsNativeExternalDrag && !e.shiftKey && (externalPaths.length > 0 || nativeTextDrag)) {
      e.preventDefault();
      handleStartExternalDrag(item);
      return;
    }

    const text = getDragText(item, externalPaths);
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.setData(INTERNAL_DRAG_MIME, JSON.stringify({ id: item.id }));
    e.dataTransfer.effectAllowed = 'copyMove';
    switchToWorkbench();

    const dragEl = document.createElement('div');
    dragEl.textContent = text.substring(0, 40) + (text.length > 40 ? '...' : '');
    dragEl.style.cssText = 'position:absolute;top:-999px;padding:4px 8px;background:#333;color:#fff;border-radius:4px;font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;';
    document.body.appendChild(dragEl);
    e.dataTransfer.setDragImage(dragEl, 0, 0);
    setTimeout(() => document.body.removeChild(dragEl), 0);
  }, [supportsNativeExternalDrag, handleStartExternalDrag, switchToWorkbench]);

  const handleStreamClick = useCallback(() => {
    if (selectedItemIds.length > 0) {
      clearSelection();
      return;
    }
    if (shouldUseHoverPreview) {
      clearExpandedPreview();
      return;
    }
    if (panelMode === 'preview') {
      switchToWorkbench();
    }
  }, [panelMode, switchToWorkbench, selectedItemIds.length, clearSelection, shouldUseHoverPreview, clearExpandedPreview]);

  return {
    handleCardClick,
    handleCardDoubleClick,
    handleStartExternalDrag,
    handleDragStart,
    handleStreamClick,
  };
}

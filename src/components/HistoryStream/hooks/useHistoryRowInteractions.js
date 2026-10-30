import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { resolveFilenameStemForItem } from '../../../utils/filenameNaming';
import {
  PREVIEW_CLICK_DELAY_MS,
  openItemPreview,
  shouldIgnoreCardDoubleClickTarget,
} from '../../../utils/previewInteractionPolicy';

const HISTORY_DOUBLE_CLICK_FALLBACK_WINDOW_MS = 420;

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
  selectionAnchorIndexRef,
  supportsNativeExternalDrag,
  setSelectedItemIds,
  setFocusedIndex,
  setPanelMode,
  toggleSelectItem,
  clearSelection,
  handleCopyAndAutoPaste,
  switchToWorkbench,
}) {
  const clickTimerRef = useRef(null);
  const lastClickRef = useRef({ itemId: null, timestamp: 0 });

  useEffect(() => () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const triggerHistoryDoubleClickAction = useCallback((item) => {
    handleCopyAndAutoPaste(item, 'history', { bypassInternalSourceProtection: true });
  }, [handleCopyAndAutoPaste]);

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

    const now = Date.now();
    const isFallbackDoubleClick = (
      e.detail === 1
      && lastClickRef.current.itemId === item.id
      && now - lastClickRef.current.timestamp <= HISTORY_DOUBLE_CLICK_FALLBACK_WINDOW_MS
    );
    lastClickRef.current = {
      itemId: item.id,
      timestamp: now,
    };

    if (isFallbackDoubleClick) {
      e.preventDefault();
      triggerHistoryDoubleClickAction(item);
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      openItemPreview(setPanelMode, item);
      clickTimerRef.current = null;
    }, HISTORY_DOUBLE_CLICK_FALLBACK_WINDOW_MS);
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
    setPanelMode,
    triggerHistoryDoubleClickAction,
  ]);

  const handleCardDoubleClick = useCallback((item, e) => {
    const shouldIgnore = shouldIgnoreCardDoubleClickTarget(e.target, e.currentTarget);
    if (shouldIgnore) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    lastClickRef.current = { itemId: null, timestamp: 0 };
    window.getSelection()?.removeAllRanges();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    triggerHistoryDoubleClickAction(item);
  }, [triggerHistoryDoubleClickAction]);

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

  const handleStreamClick = useCallback(() => {
    if (selectedItemIds.length > 0) {
      clearSelection();
      return;
    }
    if (panelMode === 'preview') {
      switchToWorkbench();
    }
  }, [panelMode, switchToWorkbench, selectedItemIds.length, clearSelection]);

  return {
    handleCardClick,
    handleCardDoubleClick,
    handleStartExternalDrag,
    handleStreamClick,
  };
}

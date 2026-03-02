import { useCallback, useEffect, useRef, useState } from 'react';

const DELETE_CONFIRM_TIMEOUT_MS = 2600;

export default function useHistoryContextMenu({
  filteredItems,
  selectedItemIds,
  selectionAnchorIndexRef,
  setSelectedItemIds,
  setFocusedIndex,
}) {
  const historyRootRef = useRef(null);
  const contextMenuRef = useRef(null);
  const deleteConfirmTimerRef = useRef(null);
  const [contextMenuState, setContextMenuState] = useState(null);

  const clearDeleteConfirmTimer = useCallback(() => {
    if (!deleteConfirmTimerRef.current) return;
    clearTimeout(deleteConfirmTimerRef.current);
    deleteConfirmTimerRef.current = null;
  }, []);

  const closeContextMenu = useCallback(() => {
    clearDeleteConfirmTimer();
    setContextMenuState(null);
  }, [clearDeleteConfirmTimer]);

  const openContextMenu = useCallback((item, index, event) => {
    if (!item?.id) return;

    event.preventDefault();
    event.stopPropagation();

    const isMultiContext = selectedItemIds.length > 1 && selectedItemIds.includes(item.id);

    if (!isMultiContext && selectedItemIds.length > 0 && !selectedItemIds.includes(item.id)) {
      setSelectedItemIds([item.id]);
    }

    setFocusedIndex(index);
    selectionAnchorIndexRef.current = index;
    clearDeleteConfirmTimer();

    setContextMenuState({
      item,
      x: event.clientX,
      y: event.clientY,
      isMulti: isMultiContext,
      selectedCount: selectedItemIds.length,
      confirmDeleteFor: null,
    });
  }, [
    selectedItemIds,
    setSelectedItemIds,
    setFocusedIndex,
    selectionAnchorIndexRef,
    clearDeleteConfirmTimer,
  ]);

  const armDeleteConfirm = useCallback((actionKey) => {
    if (!contextMenuState) return false;
    if (contextMenuState.confirmDeleteFor === actionKey) return true;

    clearDeleteConfirmTimer();
    setContextMenuState((prev) => {
      if (!prev) return prev;
      return { ...prev, confirmDeleteFor: actionKey };
    });

    deleteConfirmTimerRef.current = setTimeout(() => {
      setContextMenuState((prev) => {
        if (!prev || prev.confirmDeleteFor !== actionKey) return prev;
        return { ...prev, confirmDeleteFor: null };
      });
      deleteConfirmTimerRef.current = null;
    }, DELETE_CONFIRM_TIMEOUT_MS);

    return false;
  }, [contextMenuState, clearDeleteConfirmTimer]);

  useEffect(() => {
    const menuItemId = contextMenuState?.item?.id;
    if (!menuItemId) return;

    if (contextMenuState?.isMulti) {
      if (selectedItemIds.length < 2 || !selectedItemIds.includes(menuItemId)) {
        closeContextMenu();
        return;
      }

      setContextMenuState((prev) => {
        if (!prev || !prev.isMulti) return prev;
        if (prev.selectedCount === selectedItemIds.length) return prev;
        return { ...prev, selectedCount: selectedItemIds.length };
      });
      return;
    }

    if (filteredItems.some((candidate) => candidate.id === menuItemId)) return;
    closeContextMenu();
  }, [contextMenuState, filteredItems, selectedItemIds, closeContextMenu]);

  useEffect(() => {
    if (!contextMenuState) return undefined;

    const handlePointerDown = (event) => {
      if (contextMenuRef.current?.contains(event.target)) return;
      closeContextMenu();
    };

    const handleWindowResize = () => closeContextMenu();
    const handleWindowBlur = () => closeContextMenu();
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      closeContextMenu();
    };
    const handleScroll = () => closeContextMenu();

    const scroller = historyRootRef.current?.querySelector('.history-stream-scroller');

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleEscape, true);
    scroller?.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleEscape, true);
      scroller?.removeEventListener('scroll', handleScroll);
    };
  }, [contextMenuState, closeContextMenu]);

  useEffect(() => () => clearDeleteConfirmTimer(), [clearDeleteConfirmTimer]);

  return {
    historyRootRef,
    contextMenuRef,
    contextMenuState,
    openContextMenu,
    closeContextMenu,
    armDeleteConfirm,
  };
}

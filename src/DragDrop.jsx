import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import useAppStore from './store/useAppStore';
import './DragDrop.css';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']);
const INTERNAL_DRAG_MIME = 'application/x-clipbox-item';
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';

function normalizeUniquePaths(paths) {
  return Array.from(new Set((paths || []).map(path => path.trim()).filter(Boolean)));
}

function isImagePath(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

function isEditableTarget(target) {
  return target instanceof Element && !!target.closest(EDITABLE_SELECTOR);
}

function getTransferTypes(dataTransfer) {
  if (!dataTransfer?.types) return new Set();
  return new Set(Array.from(dataTransfer.types).map(type => type.toLowerCase()));
}

function canHandleExternalNonFileDrop(event, internalDragActive) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return false;
  if (internalDragActive) return false;
  if (isEditableTarget(event.target)) return false;

  const types = getTransferTypes(dataTransfer);
  const hasFiles = types.has('files') || (dataTransfer.files?.length ?? 0) > 0;
  if (hasFiles) return false;
  if (types.has(INTERNAL_DRAG_MIME)) return false;

  return true;
}

function normalizeTextByMime(raw, mimeType) {
  const normalizedMime = (mimeType || '').toLowerCase();
  if (!raw) return '';

  if (normalizedMime.includes('uri-list')) {
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .join('\n');
  }

  if (normalizedMime.includes('html')) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, 'text/html');
    return doc.body?.textContent?.trim() || '';
  }

  return raw;
}

function getTransferItemString(item) {
  return new Promise((resolve) => {
    try {
      item.getAsString((value) => resolve(value || ''));
    } catch {
      resolve('');
    }
  });
}

async function extractDroppedText(dataTransfer) {
  if (!dataTransfer) return '';

  const plainText = dataTransfer.getData('text/plain') || dataTransfer.getData('text');
  if (plainText && plainText.trim()) {
    return plainText;
  }

  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList && uriList.trim()) {
    return normalizeTextByMime(uriList, 'text/uri-list');
  }

  const html = dataTransfer.getData('text/html');
  if (html && html.trim()) {
    return normalizeTextByMime(html, 'text/html');
  }

  const items = Array.from(dataTransfer.items || []);
  for (const item of items) {
    if (item.kind !== 'string') continue;
    const raw = await getTransferItemString(item);
    const normalized = normalizeTextByMime(raw, item.type);
    if (normalized && normalized.trim()) {
      return normalized;
    }
  }

  return '';
}

function DragDrop({ onItemAdded, onTypeAdded }) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const maxPinnedItems = useAppStore(s => s.maxPinnedItems);
  const switchToCollection = useAppStore(s => s.switchToCollection);

  const onItemAddedRef = useRef(onItemAdded);
  onItemAddedRef.current = onItemAdded;
  const onTypeAddedRef = useRef(onTypeAdded);
  onTypeAddedRef.current = onTypeAdded;

  const maxPinnedItemsRef = useRef(maxPinnedItems);
  maxPinnedItemsRef.current = maxPinnedItems;
  const switchToCollectionRef = useRef(switchToCollection);
  switchToCollectionRef.current = switchToCollection;
  const cleanupRef = useRef(null);
  const fileDragActiveRef = useRef(false);
  const textDragActiveRef = useRef(false);
  const textDragIdleTimerRef = useRef(null);
  const internalDragActiveRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const updateDraggingState = () => {
      setIsDragging(fileDragActiveRef.current || textDragActiveRef.current);
    };

    const setTextDragActive = (active) => {
      if (textDragActiveRef.current === active) return;
      textDragActiveRef.current = active;
      updateDraggingState();
    };

    const clearTextDragTimer = () => {
      if (textDragIdleTimerRef.current) {
        clearTimeout(textDragIdleTimerRef.current);
        textDragIdleTimerRef.current = null;
      }
    };

    const touchTextDrag = () => {
      setTextDragActive(true);
      clearTextDragTimer();
      textDragIdleTimerRef.current = setTimeout(() => {
        setTextDragActive(false);
      }, 120);
    };

    const pinDroppedItem = async (id) => {
      await invoke('pin_item', {
        id,
        maxPinned: maxPinnedItemsRef.current,
      });
    };

    const handleDroppedText = async (content) => {
      const normalized = content.trim();
      if (!normalized) return;

      switchToCollectionRef.current?.();

      const itemId = await invoke('add_clipboard_item_manual', {
        contentType: 'text',
        content: normalized,
        dedupeByHash: true,
      });

      await pinDroppedItem(itemId);
      onItemAddedRef.current?.();
      onTypeAddedRef.current?.('text');
    };

    const setupDropListeners = async () => {
      const appWindow = getCurrentWindow();

      const unlistenTauriDrop = await appWindow.onDragDropEvent(async (event) => {
        if (event.payload.type === 'over') {
          fileDragActiveRef.current = true;
          updateDraggingState();
          return;
        }

        if (event.payload.type === 'leave') {
          fileDragActiveRef.current = false;
          updateDraggingState();
          return;
        }

        if (event.payload.type === 'drop') {
          fileDragActiveRef.current = false;
          updateDraggingState();

          const uniquePaths = normalizeUniquePaths(event.payload.paths);
          if (uniquePaths.length === 0) {
            return;
          }

          switchToCollectionRef.current?.();

          for (const filePath of uniquePaths) {
            if (isImagePath(filePath)) {
              try {
                const itemId = await invoke('add_image_file', {
                  filePath,
                  dedupeByHash: true,
                });
                await pinDroppedItem(itemId);
                onItemAddedRef.current?.();
                onTypeAddedRef.current?.('image');
              } catch (error) {
                console.error('failed to add dropped image file:', error);
              }
              continue;
            }

            try {
              const itemId = await invoke('add_clipboard_item_manual', {
                contentType: 'file',
                content: filePath,
                dedupeByHash: true,
              });
              await pinDroppedItem(itemId);
              onItemAddedRef.current?.();
              onTypeAddedRef.current?.('file');
            } catch (error) {
              console.error('failed to add dropped file path:', error);
            }
          }
        }
      });

      if (disposed) {
        unlistenTauriDrop();
        return;
      }

      const handleNativeDragStart = () => {
        internalDragActiveRef.current = true;
      };

      const handleNativeDragOver = (event) => {
        if (!canHandleExternalNonFileDrop(event, internalDragActiveRef.current)) {
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
        touchTextDrag();
      };

      const handleNativeDrop = async (event) => {
        clearTextDragTimer();
        setTextDragActive(false);
        internalDragActiveRef.current = false;

        if (!canHandleExternalNonFileDrop(event, false)) {
          return;
        }

        event.preventDefault();

        const content = await extractDroppedText(event.dataTransfer);
        if (!content.trim()) {
          return;
        }

        try {
          await handleDroppedText(content);
        } catch (error) {
          console.error('failed to add dropped text:', error);
        }
      };

      const handleNativeDragEnd = () => {
        internalDragActiveRef.current = false;
        clearTextDragTimer();
        setTextDragActive(false);
      };

      const handleWindowBlur = () => {
        internalDragActiveRef.current = false;
        clearTextDragTimer();
        setTextDragActive(false);
      };

      document.addEventListener('dragstart', handleNativeDragStart, true);
      window.addEventListener('dragover', handleNativeDragOver, true);
      window.addEventListener('drop', handleNativeDrop, true);
      window.addEventListener('dragend', handleNativeDragEnd, true);
      window.addEventListener('blur', handleWindowBlur);

      const cleanup = () => {
        unlistenTauriDrop();
        document.removeEventListener('dragstart', handleNativeDragStart, true);
        window.removeEventListener('dragover', handleNativeDragOver, true);
        window.removeEventListener('drop', handleNativeDrop, true);
        window.removeEventListener('dragend', handleNativeDragEnd, true);
        window.removeEventListener('blur', handleWindowBlur);
        clearTextDragTimer();
      };

      if (cleanupRef.current) {
        cleanupRef.current();
      }
      cleanupRef.current = cleanup;
    };

    setupDropListeners().catch((error) => {
      console.error('failed to initialize drag-drop handlers:', error);
    });

    return () => {
      disposed = true;
      fileDragActiveRef.current = false;
      internalDragActiveRef.current = false;
      clearTextDragTimer();
      textDragActiveRef.current = false;
      setIsDragging(false);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  return (
    <>
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <div className="drag-icon">+</div>
            <div className="drag-text">{t('dragDrop.dropHere')}</div>
          </div>
        </div>
      )}
    </>
  );
}

export default DragDrop;

import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import useAppStore from './store/useAppStore';
import { INTERNAL_DRAG_MIME } from './constants/dragDrop';
import { pinItem } from './services/clipboardService';
import './DragDrop.css';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']);
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';

function normalizeUniqueStrings(values) {
  return Array.from(new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)));
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

function canHandleExternalDrop(event, internalDragActive) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return false;
  if (internalDragActive) return false;
  if (document.documentElement.hasAttribute('data-internal-drag')) return false;
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

  const directTypes = [
    'text/plain',
    'text',
    'Text',
    'text/uri-list',
    'URL',
    'text/html',
  ];

  for (const type of directTypes) {
    const raw = dataTransfer.getData(type);
    if (!raw || !raw.trim()) continue;
    const normalized = normalizeTextByMime(raw, type);
    if (normalized && normalized.trim()) {
      return normalized;
    }
  }

  const dynamicTypes = Array.from(dataTransfer.types || []);
  for (const type of dynamicTypes) {
    const raw = dataTransfer.getData(type);
    if (!raw || !raw.trim()) continue;
    const normalized = normalizeTextByMime(raw, type);
    if (normalized && normalized.trim()) {
      return normalized;
    }
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

function DragDrop({ onItemAdded }) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);

  const onItemAddedRef = useRef(onItemAdded);
  onItemAddedRef.current = onItemAdded;

  const cleanupRef = useRef(null);
  const nativeDropDragActiveRef = useRef(false);
  const domDragActiveRef = useRef(false);
  const domDragIdleTimerRef = useRef(null);
  const internalDragActiveRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const updateDraggingState = () => {
      setIsDragging(nativeDropDragActiveRef.current || domDragActiveRef.current);
    };

    const setDomDragActive = (active) => {
      if (domDragActiveRef.current === active) return;
      domDragActiveRef.current = active;
      updateDraggingState();
    };

    const clearDomDragTimer = () => {
      if (domDragIdleTimerRef.current) {
        clearTimeout(domDragIdleTimerRef.current);
        domDragIdleTimerRef.current = null;
      }
    };

    const touchDomDrag = () => {
      setDomDragActive(true);
      clearDomDragTimer();
      domDragIdleTimerRef.current = setTimeout(() => {
        setDomDragActive(false);
      }, 120);
    };

    const addDroppedPathItems = async (paths) => {
      const uniquePaths = normalizeUniqueStrings(paths);
      if (uniquePaths.length === 0) {
        return 0;
      }

      let insertedCount = 0;

      for (const filePath of uniquePaths) {
        if (isImagePath(filePath)) {
          try {
            await invoke('add_image_file', {
              filePath,
              dedupeByHash: true,
            });
            onItemAddedRef.current?.();
            insertedCount += 1;
          } catch (error) {
            console.error('failed to add dropped image file:', error);
          }
          continue;
        }

        try {
          await invoke('add_clipboard_item_manual', {
            contentType: 'file',
            content: filePath,
            autoFavorite: true,
            dedupeByHash: true,
          });
          onItemAddedRef.current?.();
          insertedCount += 1;
        } catch (error) {
          console.error('failed to add dropped file path:', error);
        }
      }

      return insertedCount;
    };

    const handleDroppedText = async (content) => {
      const normalized = content.trim();
      if (!normalized) return false;

      await invoke('add_clipboard_item_manual', {
        contentType: 'text',
        content: normalized,
        autoFavorite: true,
        dedupeByHash: true,
      });

      onItemAddedRef.current?.();
      return true;
    };

    const setupDropListeners = async () => {
      const appWindow = getCurrentWindow();

      const unlistenTauriDrop = await appWindow.onDragDropEvent(async (event) => {
        // Skip Tauri native drag events during internal drag
        if (internalDragActiveRef.current || document.documentElement.hasAttribute('data-internal-drag')) {
          return;
        }

        if (event.payload.type === 'over') {
          nativeDropDragActiveRef.current = true;
          updateDraggingState();
          return;
        }

        if (event.payload.type === 'leave') {
          nativeDropDragActiveRef.current = false;
          updateDraggingState();
          return;
        }

        if (event.payload.type === 'drop') {
          nativeDropDragActiveRef.current = false;
          updateDraggingState();

          const handled = await addDroppedPathItems(event.payload.paths);
          if (handled === 0) {
            console.warn('native file drop did not provide usable absolute paths');
          }
          if (handled > 0) {
            return;
          }
        }
      });

      if (disposed) {
        unlistenTauriDrop();
        return;
      }

      const handleNativeDragStart = () => {
        internalDragActiveRef.current = true;
        document.documentElement.setAttribute('data-internal-drag', 'true');
      };

      const handleNativeDragOver = (event) => {
        // Internal drag: always allow drop, never show overlay
        if (internalDragActiveRef.current || document.documentElement.hasAttribute('data-internal-drag')) {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
          }
          return;
        }

        if (!canHandleExternalDrop(event, false)) {
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
        touchDomDrag();
      };

      const handleNativeDrop = async (event) => {
        clearDomDragTimer();
        setDomDragActive(false);
        internalDragActiveRef.current = false;
        document.documentElement.removeAttribute('data-internal-drag');

        if (!canHandleExternalDrop(event, false)) {
          return;
        }

        event.preventDefault();

        try {
          const content = await extractDroppedText(event.dataTransfer);
          await handleDroppedText(content);
        } catch (error) {
          console.error('failed to process dropped content:', error);
        }
      };

      const handleNativeDragEnd = () => {
        internalDragActiveRef.current = false;
        document.documentElement.removeAttribute('data-internal-drag');
        clearDomDragTimer();
        setDomDragActive(false);
      };

      const handleWindowBlur = () => {
        internalDragActiveRef.current = false;
        clearDomDragTimer();
        setDomDragActive(false);
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
        clearDomDragTimer();
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
      nativeDropDragActiveRef.current = false;
      internalDragActiveRef.current = false;
      document.documentElement.removeAttribute('data-internal-drag');
      clearDomDragTimer();
      domDragActiveRef.current = false;
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

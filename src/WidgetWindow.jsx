import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']);

function isImagePath(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

function normalizeTextByMime(raw, mimeType) {
  const normalizedMime = (mimeType || '').toLowerCase();
  if (!raw) return '';
  if (normalizedMime.includes('uri-list')) {
    return raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).join('\n');
  }
  if (normalizedMime.includes('html')) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    return doc.body?.textContent?.trim() || '';
  }
  return raw;
}

function getTransferItemString(item) {
  return new Promise((resolve) => {
    try { item.getAsString((v) => resolve(v || '')); } catch { resolve(''); }
  });
}

async function extractDroppedText(dataTransfer) {
  if (!dataTransfer) return '';
  const directTypes = ['text/plain', 'text', 'Text', 'text/uri-list', 'URL', 'text/html'];
  for (const type of directTypes) {
    const raw = dataTransfer.getData(type);
    if (!raw?.trim()) continue;
    const normalized = normalizeTextByMime(raw, type);
    if (normalized?.trim()) return normalized;
  }
  const items = Array.from(dataTransfer.items || []);
  for (const item of items) {
    if (item.kind !== 'string') continue;
    const raw = await getTransferItemString(item);
    const normalized = normalizeTextByMime(raw, item.type);
    if (normalized?.trim()) return normalized;
  }
  return '';
}

// state: 'idle' | 'dragging' | 'dropped'
function WidgetWindow() {
  const [state, setState] = useState('idle');
  const restoreTimerRef = useRef(null);
  const cleanupRef = useRef(null);

  const pinDroppedItem = useCallback(async (id) => {
    await invoke('pin_item', { id, maxPinned: 3 });
  }, []);

  const addDroppedPaths = useCallback(async (paths) => {
    const unique = [...new Set(paths.map(p => String(p || '').trim()).filter(Boolean))];
    for (const filePath of unique) {
      try {
        let itemId;
        if (isImagePath(filePath)) {
          itemId = await invoke('add_image_file', { filePath, dedupeByHash: true });
        } else {
          itemId = await invoke('add_clipboard_item_manual', {
            contentType: 'file', content: filePath, dedupeByHash: true,
          });
        }
        await pinDroppedItem(itemId);
      } catch (err) {
        console.error('widget: failed to add dropped path:', err);
      }
    }
  }, [pinDroppedItem]);

  const addDroppedText = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const itemId = await invoke('add_clipboard_item_manual', {
        contentType: 'text', content: trimmed, dedupeByHash: true,
      });
      await pinDroppedItem(itemId);
    } catch (err) {
      console.error('widget: failed to add dropped text:', err);
    }
  }, [pinDroppedItem]);

  const triggerSwallow = useCallback(() => {
    setState('dropped');
    emit('clipboard-changed').catch(() => {});
    restoreTimerRef.current = setTimeout(() => setState('idle'), 700);
  }, []);

  // Tauri native file drop + DOM text drop
  useEffect(() => {
    let disposed = false;
    const appWindow = getCurrentWindow();

    const setup = async () => {
      const unlistenNative = await appWindow.onDragDropEvent(async (event) => {
        if (disposed) return;
        if (event.payload.type === 'over') {
          setState('dragging');
        } else if (event.payload.type === 'leave') {
          setState('idle');
        } else if (event.payload.type === 'drop') {
          await addDroppedPaths(event.payload.paths);
          triggerSwallow();
        }
      });

      if (disposed) { unlistenNative(); return; }

      const onDragOver = (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        setState('dragging');
      };

      const onDragLeave = (e) => {
        if (e.relatedTarget) return;
        setState('idle');
      };

      const onDrop = async (e) => {
        e.preventDefault();
        const text = await extractDroppedText(e.dataTransfer);
        if (text) {
          await addDroppedText(text);
          triggerSwallow();
        } else {
          setState('idle');
        }
      };

      window.addEventListener('dragover', onDragOver, true);
      window.addEventListener('dragleave', onDragLeave, true);
      window.addEventListener('drop', onDrop, true);

      cleanupRef.current = () => {
        unlistenNative();
        window.removeEventListener('dragover', onDragOver, true);
        window.removeEventListener('dragleave', onDragLeave, true);
        window.removeEventListener('drop', onDrop, true);
      };
    };

    setup().catch(err => console.error('widget: setup failed:', err));

    return () => {
      disposed = true;
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      cleanupRef.current?.();
    };
  }, [addDroppedPaths, addDroppedText, triggerSwallow]);

  // Idle-state mousedown starts window drag
  const handleMouseDown = useCallback(async () => {
    if (state !== 'idle') return;
    try {
      await getCurrentWindow().startDragging();
    } catch { /* ignore */ }
  }, [state]);

  const dotClass = `widget-dot ${state}`;

  return (
    <div className="widget-root">
      <div className={dotClass} onMouseDown={handleMouseDown} />
    </div>
  );
}

export default WidgetWindow;

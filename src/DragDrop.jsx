import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import useAppStore from './store/useAppStore';
import './DragDrop.css';

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

  useEffect(() => {
    let unlisten;

    const setupFileDrop = async () => {
      const appWindow = getCurrentWindow();

      unlisten = await appWindow.onDragDropEvent(async (event) => {
        if (event.payload.type === 'over') {
          setIsDragging(true);
        } else if (event.payload.type === 'leave') {
          setIsDragging(false);
        } else if (event.payload.type === 'drop') {
          setIsDragging(false);
          const paths = event.payload.paths;

          const pinDroppedItem = async (id) => {
            await invoke('toggle_pin_item', {
              id,
              maxPinned: maxPinnedItemsRef.current,
            });
          };

          if (paths && paths.length > 0) {
            switchToCollectionRef.current?.();

            for (const filePath of paths) {
              const ext = filePath.split('.').pop().toLowerCase();
              const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];

              if (imageExts.includes(ext)) {
                try {
                  const itemId = await invoke('add_image_file', { filePath });
                  await pinDroppedItem(itemId);
                  onItemAddedRef.current?.();
                  onTypeAddedRef.current?.('image');
                } catch (err) {
                  console.error('添加图片失败:', err);
                }
              } else {
                try {
                  const itemId = await invoke('add_clipboard_item_manual', {
                    contentType: 'file',
                    content: filePath,
                  });
                  await pinDroppedItem(itemId);
                  onItemAddedRef.current?.();
                  onTypeAddedRef.current?.('file');
                } catch (err) {
                  console.error('添加文件失败:', err);
                }
              }
            }
          }
        }
      });
    };

    setupFileDrop();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return (
    <>
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <div className="drag-icon">📥</div>
            <div className="drag-text">{t('dragDrop.dropHere')}</div>
          </div>
        </div>
      )}
    </>
  );
}

export default DragDrop;

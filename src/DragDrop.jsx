import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import './DragDrop.css';

function DragDrop({ onItemAdded, onTypeAdded }) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    let unlisten;

    // 监听 Tauri 的文件拖放事件
    const setupFileDrop = async () => {
      const appWindow = getCurrentWindow();

      unlisten = await appWindow.onDragDropEvent(async (event) => {
        console.log('拖放事件:', event);

        if (event.payload.type === 'over') {
          setIsDragging(true);
        } else if (event.payload.type === 'leave') {
          setIsDragging(false);
        } else if (event.payload.type === 'drop') {
          setIsDragging(false);
          const paths = event.payload.paths;

          if (paths && paths.length > 0) {
            for (const filePath of paths) {
              console.log('处理文件路径:', filePath);

              // 判断文件类型
              const ext = filePath.split('.').pop().toLowerCase();
              const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];

              if (imageExts.includes(ext)) {
                // 图片文件：直接传文件路径
                try {
                  await invoke('add_image_file', { filePath });
                  console.log('图片已添加:', filePath);
                  if (onItemAdded) onItemAdded();
                  if (onTypeAdded) onTypeAdded('image');
                } catch (err) {
                  console.error('添加图片失败:', err);
                }
              } else {
                // 其他文件：保存文件路径
                try {
                  await invoke('add_clipboard_item_manual', {
                    contentType: 'file',
                    content: filePath,
                  });
                  console.log('文件路径已添加:', filePath);
                  if (onItemAdded) onItemAdded();
                  if (onTypeAdded) onTypeAdded('file');
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
  }, [onItemAdded, onTypeAdded, t]);

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

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default DragDrop;

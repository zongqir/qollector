import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './DragDrop.css';

function DragDrop({ onItemAdded }) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    const handleDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current++;
      setIsDragging(true);
    };

    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    };

    const handleDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      // 处理文本
      const text = e.dataTransfer.getData('text/plain');
      if (text && text.trim()) {
        try {
          await invoke('add_clipboard_item_manual', {
            contentType: 'text',
            content: text,
          });
          console.log('文本已添加');
          if (onItemAdded) onItemAdded();
        } catch (err) {
          console.error('添加文本失败:', err);
        }
        return;
      }

      // 处理文件
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          console.log('处理文件:', file.name, file.type, file.size);

          if (file.type.startsWith('image/')) {
            // 图片：读取为 base64
            const reader = new FileReader();
            reader.onload = async (ev) => {
              try {
                const base64 = ev.target.result.split(',')[1];
                await invoke('add_clipboard_item_manual', {
                  contentType: 'image',
                  content: base64,
                });
                console.log('图片已添加');
                if (onItemAdded) onItemAdded();
              } catch (err) {
                console.error('添加图片失败:', err);
              }
            };
            reader.readAsDataURL(file);
          } else {
            // 普通文件：存储文件名
            try {
              await invoke('add_clipboard_item_manual', {
                contentType: 'text',
                content: `[文件] ${file.name} (${formatSize(file.size)})`,
              });
              console.log('文件信息已添加');
              if (onItemAdded) onItemAdded();
            } catch (err) {
              console.error('添加文件失败:', err);
            }
          }
        }
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [onItemAdded]);

  return (
    <>
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <div className="drag-icon">📥</div>
            <div className="drag-text">拖放到这里添加到收集箱</div>
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

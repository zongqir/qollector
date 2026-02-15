import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X, Check, Plus, Pin, PinOff } from 'lucide-react';
import useAppStore from './store/useAppStore';
import './EditModal.css';

const NOTE_COLORS = [
  { id: 'default', bg: 'var(--edit-modal-bg)', dot: '#e2e2e2' },
  { id: 'yellow',  bg: '#fef9e7', dot: '#fce588' },
  { id: 'green',   bg: '#eafaf1', dot: '#82deb0' },
  { id: 'blue',    bg: '#eaf2fa', dot: '#93c5f7' },
  { id: 'pink',    bg: '#fdf2f8', dot: '#f5a6ce' },
  { id: 'purple',  bg: '#f3eefa', dot: '#c4a8f0' },
];

function EditModal({ item, mode, isMiniMode, onSave, onCancel }) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [savedToast, setSavedToast] = useState(false);
  const [isPinned, setIsPinned] = useState(true);
  const [noteColor, setNoteColor] = useState('default');
  const textareaRef = useRef(null);

  // 拖拽状态
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const posInitialized = useRef(false);

  // 取消置顶时错位显示
  useEffect(() => {
    if (!isPinned && !posInitialized.current) {
      posInitialized.current = true;
      setPos({ x: 30, y: 30 });
    }
  }, [isPinned]);

  // 拖拽事件
  const handleDragMouseDown = useCallback((e) => {
    if (isPinned) return;
    draggingRef.current = true;
    offsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    document.body.style.userSelect = 'none';
  }, [isPinned, pos]);

  useEffect(() => {
    const handleMove = (e) => {
      if (!draggingRef.current) return;
      setPos({
        x: e.clientX - offsetRef.current.x,
        y: e.clientY - offsetRef.current.y,
      });
    };
    const handleUp = () => {
      draggingRef.current = false;
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, []);

  useEffect(() => {
    if (mode === 'edit' && item) {
      setContent(item.content || '');
      setNote(item.user_note || '');

      try {
        const parsedTags = item.tags ? JSON.parse(item.tags) : [];
        setTags(parsedTags);
      } catch {
        setTags([]);
      }
    } else {
      setContent('');
      setNote('');
      setTags([]);
    }
  }, [item, mode]);

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleSave = () => {
    onSave({ content, note, tags });
  };

  const handleSaveAndContinue = useCallback(async () => {
    if (!content.trim()) return;
    try {
      await invoke('add_clipboard_item_manual', {
        content: content.trim(),
        contentType: 'text',
        source: '快速输入',
        autoFavorite: false,
      });
      await useAppStore.getState().loadItems();
      setContent('');
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1500);
      textareaRef.current?.focus();
    } catch (error) {
      console.error('保存失败:', error);
    }
  }, [content]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const isNewMode = mode === 'new';
  const canEdit = isNewMode || (item && item.type_ !== 'image');

  if (isNewMode) {
    const currentColor = NOTE_COLORS.find(c => c.id === noteColor) || NOTE_COLORS[0];
    const panelStyle = { '--quick-add-bg': currentColor.bg };

    const panelContent = (
      <>
        <div className="quick-add-header" onMouseDown={handleDragMouseDown}>
          <span className="quick-add-tip">{t('editModal.quickAddTip')}</span>
          <div className="quick-add-header-actions">
            <div className="quick-add-colors">
              {NOTE_COLORS.map(c => (
                <button
                  key={c.id}
                  className={`quick-add-color-dot ${noteColor === c.id ? 'active' : ''}`}
                  style={{ '--dot-color': c.dot }}
                  onClick={() => setNoteColor(c.id)}
                />
              ))}
            </div>
            <button
              className={`quick-add-pin-btn ${isPinned ? 'active' : ''}`}
              onClick={() => setIsPinned(!isPinned)}
              title={isPinned ? t('editModal.unpin') : t('editModal.pin')}
            >
              {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          className="edit-modal-mini-textarea"
          placeholder={t('editModal.contentPlaceholder')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        {savedToast && (
          <div className="quick-add-toast">
            <Check size={14} />
            <span>{t('editModal.savedToast')}</span>
          </div>
        )}
        <div className="edit-modal-mini-footer">
          <button onClick={onCancel} className="quick-add-btn-close" title={t('editModal.cancelHint')}>
            <X size={16} />
          </button>
          <div className="quick-add-actions">
            <button
              onClick={handleSaveAndContinue}
              className="quick-add-btn-continue"
              disabled={!content.trim()}
            >
              <Plus size={15} />
              <span>{t('editModal.saveAndContinue')}</span>
            </button>
            <button
              onClick={handleSave}
              className="quick-add-btn-save"
              disabled={!content.trim()}
            >
              <Check size={15} />
              <span>{t('editModal.saveHint')}</span>
            </button>
          </div>
        </div>
      </>
    );

    if (isPinned) {
      return (
        <div className="edit-modal-mini-fullscreen" style={panelStyle}>
          {panelContent}
        </div>
      );
    }

    return (
      <div
        ref={dragRef}
        className="quick-add-floating"
        style={{ left: pos.x, top: pos.y, ...panelStyle }}
      >
        {panelContent}
      </div>
    );
  }

  return (
    <div className="edit-modal-overlay" onClick={onCancel}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="edit-modal-header">
          <h3>{isNewMode ? t('editModal.newTitle') : t('editModal.editTitle')}</h3>
          <button onClick={onCancel} className="edit-modal-close"><X size={20} /></button>
        </div>

        <div className="edit-modal-body">
          {/* 内容输入 */}
          {canEdit && (
            <div className="edit-modal-field">
              <label className="edit-modal-label">{t('editModal.content')}</label>
              <textarea
                className="edit-modal-textarea edit-modal-textarea-content"
                placeholder={t('editModal.contentPlaceholder')}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                rows={10}
              />
            </div>
          )}

          {/* 备注和标签在一行 */}
          <div className="edit-modal-row">
            {/* 备注输入 */}
            <div className="edit-modal-field edit-modal-field-note">
              <label className="edit-modal-label">{t('editModal.note')}</label>
              <input
                type="text"
                className="edit-modal-input"
                placeholder={t('editModal.notePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            {/* 标签管理 */}
            <div className="edit-modal-field edit-modal-field-tags">
              <label className="edit-modal-label">{t('editModal.tags')}</label>
              <div className="edit-modal-tag-input-wrapper">
                <input
                  type="text"
                  className="edit-modal-tag-input"
                  placeholder={t('editModal.addTagPlaceholder')}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                />
                <button onClick={handleAddTag} className="edit-modal-tag-add-btn">
                  +
                </button>
              </div>
            </div>
          </div>

          {/* 已有标签显示 */}
          {tags.length > 0 && (
            <div className="edit-modal-tags">
              {tags.map((tag, index) => (
                <span key={index} className="edit-modal-tag">
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="edit-modal-tag-remove"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="edit-modal-footer">
          <div className="edit-modal-hints">
            <span className="hint-item">{t('editModal.saveHint')}</span>
            <span className="hint-divider">|</span>
            <span className="hint-item">{t('editModal.cancelHint')}</span>
          </div>
          <div className="edit-modal-actions">
            <button onClick={onCancel} className="edit-modal-btn cancel">
              {t('edit.cancel')}
            </button>
            <button onClick={handleSave} className="edit-modal-btn submit">
              {t('edit.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditModal;

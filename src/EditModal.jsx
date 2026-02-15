import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Plus, Pin, PinOff } from 'lucide-react';
import './EditModal.css';

function EditModal({ item, mode, isMiniMode, onSave, onCancel }) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [savedToast, setSavedToast] = useState(false);
  const [isPinned, setIsPinned] = useState(true);

  // 拖拽状态
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  // 取消置顶时居中初始化位置
  useEffect(() => {
    if (!isPinned && pos.x === 0 && pos.y === 0) {
      const w = Math.min(420, window.innerWidth - 40);
      const h = Math.min(360, window.innerHeight - 40);
      setPos({
        x: Math.round((window.innerWidth - w) / 2),
        y: Math.round((window.innerHeight - h) / 2),
      });
    }
  }, [isPinned]);

  // 拖拽事件
  const handleDragStart = useCallback((e) => {
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

  const handleSaveAndContinue = useCallback(() => {
    if (!content.trim()) return;
    onSave({ content, note, tags });
    setContent('');
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1500);
  }, [content, note, tags, onSave]);

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
    const panelContent = (
      <>
        <div className="quick-add-header" onMouseDown={handleDragStart}>
          <span className="quick-add-tip">{t('editModal.quickAddTip')}</span>
          <button
            className={`quick-add-pin-btn ${isPinned ? 'active' : ''}`}
            onClick={() => setIsPinned(!isPinned)}
            title={isPinned ? t('editModal.unpin') : t('editModal.pin')}
          >
            {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        </div>
        <textarea
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
        <div className="edit-modal-mini-fullscreen">
          {panelContent}
        </div>
      );
    }

    return (
      <>
        <div className="quick-add-backdrop" onClick={onCancel} />
        <div
          ref={dragRef}
          className="quick-add-floating"
          style={{ left: pos.x, top: pos.y }}
        >
          {panelContent}
        </div>
      </>
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

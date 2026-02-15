import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import './EditModal.css';

function EditModal({ item, mode, isMiniMode, onSave, onCancel }) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');

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
      // 新建模式
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

  const handleSave = () => {
    onSave({
      content,
      note,
      tags
    });
  };

  const isNewMode = mode === 'new';
  const canEdit = isNewMode || (item && item.type_ !== 'image');
  const isMiniQuickAdd = isMiniMode && isNewMode;

  if (isMiniQuickAdd) {
    return (
      <div className="edit-modal-mini-fullscreen">
        <textarea
          className="edit-modal-mini-textarea"
          placeholder={t('editModal.contentPlaceholder')}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div className="edit-modal-mini-footer">
          <button onClick={onCancel} className="edit-modal-btn cancel">
            {t('edit.cancel')}
          </button>
          <span className="hint-item">{t('editModal.saveHint')}</span>
          <button onClick={handleSave} className="edit-modal-btn submit" disabled={!content.trim()}>
            {t('edit.save')}
          </button>
        </div>
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

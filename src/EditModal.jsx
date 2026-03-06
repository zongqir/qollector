import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X, Check, Plus, Pin, PinOff, Tag } from 'lucide-react';
import useAppStore from './store/useAppStore';
import { QUICK_INPUT_SOURCE } from './utils/sourceConstants';
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
  const [isTagInputFocused, setIsTagInputFocused] = useState(false);
  const [activeTagSuggestionIndex, setActiveTagSuggestionIndex] = useState(-1);
  const [showContentEditor, setShowContentEditor] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveContinuePending, setSaveContinuePending] = useState(false);
  const [isPinned, setIsPinned] = useState(true);
  const [noteColor, setNoteColor] = useState('default');
  const textareaRef = useRef(null);
  const tagSuggestionsRef = useRef(null);
  const contentEditorRef = useRef(null);
  const items = useAppStore(s => s.items);

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
    setShowContentEditor(false);
    setNewTag('');
    setIsTagInputFocused(false);
    setActiveTagSuggestionIndex(-1);
  }, [item, mode]);

  useEffect(() => {
    if (!showContentEditor) return;
    const timer = setTimeout(() => {
      contentEditorRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 60);
    return () => clearTimeout(timer);
  }, [showContentEditor]);

  const rankedUserTags = useMemo(() => {
    const statsByTag = new Map();
    items.forEach((candidate) => {
      const rankTimestamp = Math.max(candidate.updated_at || 0, candidate.created_at || 0);
      let parsedTags = [];
      try {
        parsedTags = candidate.tags ? JSON.parse(candidate.tags) : [];
      } catch {
        parsedTags = [];
      }
      const uniqueUserTags = new Set(
        parsedTags.filter(tag => typeof tag === 'string' && !tag.startsWith('AI:')),
      );
      uniqueUserTags.forEach((tag) => {
        const normalized = tag.trim();
        if (!normalized) return;
        const existing = statsByTag.get(normalized);
        if (existing) {
          existing.count += 1;
          if (rankTimestamp > existing.lastUsedAt) existing.lastUsedAt = rankTimestamp;
          return;
        }
        statsByTag.set(normalized, { tag: normalized, count: 1, lastUsedAt: rankTimestamp });
      });
    });
    return Array.from(statsByTag.values())
      .sort((a, b) => (
        b.count - a.count
        || b.lastUsedAt - a.lastUsedAt
        || a.tag.localeCompare(b.tag)
      ))
      .map(stat => stat.tag);
  }, [items]);

  const filteredTagSuggestions = useMemo(() => {
    const normalizedQuery = newTag.trim().toLowerCase();
    const existingTags = new Set(tags.map(tag => String(tag).trim().toLowerCase()));
    const availableTags = rankedUserTags.filter(tag => !existingTags.has(tag.toLowerCase()));

    if (!normalizedQuery) return availableTags.slice(0, 8);

    const prefixMatches = [];
    const partialMatches = [];
    availableTags.forEach((tag) => {
      const lowered = tag.toLowerCase();
      if (!lowered.includes(normalizedQuery)) return;
      if (lowered.startsWith(normalizedQuery)) {
        prefixMatches.push(tag);
      } else {
        partialMatches.push(tag);
      }
    });
    return [...prefixMatches, ...partialMatches].slice(0, 8);
  }, [newTag, tags, rankedUserTags]);

  const activeTagSuggestion = activeTagSuggestionIndex >= 0
    ? filteredTagSuggestions[activeTagSuggestionIndex] || null
    : null;

  useEffect(() => {
    if (!isTagInputFocused || filteredTagSuggestions.length === 0) {
      setActiveTagSuggestionIndex(-1);
      return;
    }
    setActiveTagSuggestionIndex((current) => (
      current >= filteredTagSuggestions.length ? filteredTagSuggestions.length - 1 : current
    ));
  }, [isTagInputFocused, filteredTagSuggestions.length]);

  useEffect(() => {
    if (!isTagInputFocused || activeTagSuggestionIndex < 0) return;
    const activeItem = tagSuggestionsRef.current?.querySelector(
      `[data-suggestion-index="${activeTagSuggestionIndex}"]`,
    );
    activeItem?.scrollIntoView?.({ block: 'nearest' });
  }, [isTagInputFocused, activeTagSuggestionIndex]);

  const commitTag = useCallback((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return false;

    const exists = tags.some(tag => String(tag).trim().toLowerCase() === normalized.toLowerCase());
    if (exists) return false;

    setTags(prev => [...prev, normalized]);
    setNewTag('');
    setActiveTagSuggestionIndex(-1);
    return true;
  }, [tags]);

  const handleAddTag = useCallback(() => {
    if (activeTagSuggestion) {
      commitTag(activeTagSuggestion);
      return;
    }
    commitTag(newTag);
  }, [activeTagSuggestion, commitTag, newTag]);

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const buildTagsForSave = useCallback(() => {
    const pendingTag = String(newTag || '').trim();
    if (!pendingTag) return tags;

    const exists = tags.some(tag => String(tag).trim().toLowerCase() === pendingTag.toLowerCase());
    if (exists) return tags;

    return [...tags, pendingTag];
  }, [newTag, tags]);

  const handleSave = useCallback(async () => {
    if (savePending || saveContinuePending) return;
    setSavePending(true);
    try {
      await Promise.resolve(onSave({ content, note, tags: buildTagsForSave() }));
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setSavePending(false);
    }
  }, [buildTagsForSave, content, note, onSave, saveContinuePending, savePending]);

  const handleSaveAndContinue = useCallback(async () => {
    if (!content.trim() || savePending || saveContinuePending) return;
    setSaveContinuePending(true);
    try {
      const itemId = await invoke('add_clipboard_item_manual', {
        content: content.trim(),
        contentType: 'text',
        source: QUICK_INPUT_SOURCE,
        autoFavorite: false,
      });
      if (itemId) {
        const maxPinned = useAppStore.getState().maxPinnedItems;
        await invoke('pin_item', { id: itemId, maxPinned });
      }
      await useAppStore.getState().loadItems();
      setContent('');
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1500);
      textareaRef.current?.focus();
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setSaveContinuePending(false);
    }
  }, [content, saveContinuePending, savePending]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      void handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleTagKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (filteredTagSuggestions.length === 0) return;
      e.preventDefault();
      setActiveTagSuggestionIndex((current) => {
        if (e.key === 'ArrowDown') {
          if (current < 0) return 0;
          return Math.min(current + 1, filteredTagSuggestions.length - 1);
        }
        if (current < 0) return filteredTagSuggestions.length - 1;
        return Math.max(current - 1, 0);
      });
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeTagSuggestion) {
        commitTag(activeTagSuggestion);
        return;
      }
      commitTag(newTag);
      return;
    }

    if (e.key === 'Escape' && activeTagSuggestionIndex >= 0) {
      e.preventDefault();
      setActiveTagSuggestionIndex(-1);
    }
  }, [
    filteredTagSuggestions.length,
    activeTagSuggestion,
    activeTagSuggestionIndex,
    commitTag,
    newTag,
  ]);

  const isNewMode = mode === 'new';
  const canEdit = isNewMode || (item && item.type_ !== 'image');
  const contentPreview = (typeof content === 'string' ? content : '').trim();

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
            <button onClick={onCancel} className="quick-add-close-btn" title={t('editModal.cancelHint')}>
              <X size={14} />
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
          <div className="quick-add-actions">
            <button
              onClick={handleSaveAndContinue}
              className="quick-add-btn-continue"
              disabled={!content.trim() || savePending || saveContinuePending}
            >
              <Plus size={15} />
              <span>{t('editModal.saveAndContinue')}</span>
            </button>
            <button
              onClick={handleSave}
              className="quick-add-btn-save"
              disabled={!content.trim() || savePending || saveContinuePending}
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
      <div className={`edit-modal ${showContentEditor ? 'content-expanded' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="edit-modal-header">
          <h3>{isNewMode ? t('editModal.newTitle') : t('editModal.editTitle')}</h3>
          <button onClick={onCancel} className="edit-modal-close"><X size={20} /></button>
        </div>

        <div className="edit-modal-body">
          <div className="edit-modal-field edit-modal-field-note-primary">
            <label className="edit-modal-label">{t('editModal.note')}</label>
            <textarea
              className="edit-modal-textarea edit-modal-textarea-note"
              placeholder={t('editModal.notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              rows={6}
            />
            <div className="edit-modal-field-hint">{t('editModal.notePrimaryHint')}</div>
          </div>

          <div className="edit-modal-field edit-modal-field-tags">
            <label className="edit-modal-label">{t('editModal.tags')}</label>
            <div className="edit-modal-tag-input-wrapper">
              <input
                type="text"
                className="edit-modal-tag-input"
                placeholder={t('editModal.addTagPlaceholder')}
                value={newTag}
                onChange={(e) => {
                  setNewTag(e.target.value);
                  setActiveTagSuggestionIndex(-1);
                }}
                onKeyDown={handleTagKeyDown}
                onFocus={() => setIsTagInputFocused(true)}
                onBlur={() => {
                  setTimeout(() => setIsTagInputFocused(false), 120);
                }}
              />
              <button onClick={handleAddTag} className="edit-modal-tag-add-btn">
                +
              </button>
            </div>
            {isTagInputFocused && filteredTagSuggestions.length > 0 && (
              <div className="edit-modal-tag-suggestions" ref={tagSuggestionsRef}>
                {filteredTagSuggestions.map((tag, index) => (
                  <button
                    key={tag}
                    type="button"
                    data-suggestion-index={index}
                    className={`edit-modal-tag-suggestion-item ${activeTagSuggestionIndex === index ? 'active' : ''}`}
                    onMouseEnter={() => setActiveTagSuggestionIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commitTag(tag)}
                  >
                    <Tag size={12} className="edit-modal-tag-suggestion-icon" />
                    <span>{tag}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

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

          {canEdit && (
            <div ref={contentEditorRef} className="edit-modal-field edit-modal-field-content-secondary">
              <div className="edit-modal-content-toggle-row">
                <label className="edit-modal-label">{t('editModal.contentOptional')}</label>
                <button
                  type="button"
                  className="edit-modal-content-toggle-btn"
                  onClick={() => setShowContentEditor(prev => !prev)}
                >
                  {showContentEditor ? t('editModal.collapseContentEditor') : t('editModal.expandContentEditor')}
                </button>
              </div>

              {!showContentEditor ? (
                <div className="edit-modal-content-preview">
                  {contentPreview || t('editModal.contentSecondaryHint')}
                </div>
              ) : (
                <textarea
                  className="edit-modal-textarea edit-modal-textarea-content"
                  placeholder={t('editModal.contentPlaceholder')}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={8}
                />
              )}
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
            <button
              onClick={handleSave}
              className="edit-modal-btn submit"
              disabled={savePending || saveContinuePending}
            >
              {t('editModal.savePrimary')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditModal;

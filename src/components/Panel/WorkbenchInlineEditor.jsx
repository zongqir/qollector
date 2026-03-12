import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Star, Tag, X } from 'lucide-react';
import { formatHistoryCardTime, getContentPreview } from '../../utils/formatters';
import { getTags, hasReservedTagPrefix } from '../../utils/tagHelpers';

function WorkbenchInlineEditor({
  items,
  activeItemId,
  onActiveItemChange,
  onItemPatched,
  onRefreshItems,
  onToggleFavorite,
}) {
  const { t, i18n } = useTranslation();
  const [noteDraft, setNoteDraft] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeItemId) || items[0] || null,
    [items, activeItemId],
  );
  const userTags = useMemo(
    () => getTags(activeItem?.tags).filter((tag) => !String(tag).startsWith('AI:')),
    [activeItem?.tags],
  );

  useEffect(() => {
    setNoteDraft(activeItem?.user_note || '');
    setTagInput('');
    setFeedback(null);
  }, [activeItem?.id, activeItem?.user_note]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const hasNoteChanges = useMemo(
    () => String(activeItem?.user_note || '') !== noteDraft,
    [activeItem?.user_note, noteDraft],
  );

  const persistItem = useCallback(async (nextFields) => {
    if (!activeItem) return false;
    const updatedItem = {
      ...activeItem,
      ...nextFields,
      updated_at: Math.floor(Date.now() / 1000),
    };
    await invoke('update_item', { item: updatedItem });
    onItemPatched?.(updatedItem);
    onRefreshItems?.();
    return true;
  }, [activeItem, onItemPatched, onRefreshItems]);

  const handleSaveNote = useCallback(async () => {
    if (!activeItem || busy) return;
    if (!hasNoteChanges) return;
    setBusy(true);
    try {
      await persistItem({ user_note: noteDraft });
      setFeedback({ type: 'success', text: t('edit.save') });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setFeedback({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
    } finally {
      setBusy(false);
    }
  }, [activeItem, busy, hasNoteChanges, noteDraft, persistItem, t]);

  const handleToggleFavorite = useCallback(async () => {
    if (!activeItem || favoritePending) return;
    setFavoritePending(true);
    const nextFavoriteStateFallback = !activeItem.is_favorite;

    try {
      const result = onToggleFavorite
        ? await onToggleFavorite(activeItem)
        : await invoke('toggle_favorite_item', { id: activeItem.id }).then(() => nextFavoriteStateFallback);
      const nextFavoriteState = typeof result === 'boolean' ? result : nextFavoriteStateFallback;
      onItemPatched?.({
        ...activeItem,
        is_favorite: nextFavoriteState,
        favorite_order: nextFavoriteState ? 1 : null,
        updated_at: Math.floor(Date.now() / 1000),
      });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setFeedback({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
    } finally {
      setFavoritePending(false);
    }
  }, [activeItem, favoritePending, onItemPatched, onToggleFavorite, t]);

  const handleAddTag = useCallback(async () => {
    if (!activeItem || busy) return;
    const normalizedTag = tagInput.trim();
    if (!normalizedTag) {
      setFeedback({ type: 'warning', text: t('multiSelect.addTagEmpty') });
      return;
    }
    if (hasReservedTagPrefix(normalizedTag)) {
      setFeedback({ type: 'error', text: t('multiSelect.addTagReservedPrefix') });
      return;
    }
    if (userTags.includes(normalizedTag)) {
      setFeedback({ type: 'warning', text: t('multiSelect.addTagNoChanges') });
      return;
    }

    setBusy(true);
    try {
      const nextTags = JSON.stringify([...userTags, normalizedTag]);
      await persistItem({ tags: nextTags });
      setTagInput('');
      setFeedback({ type: 'success', text: t('multiSelect.addTagSuccess', { count: 1, tag: normalizedTag }) });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setFeedback({ type: 'error', text: t('multiSelect.addTagFailed', { error: message }) });
    } finally {
      setBusy(false);
    }
  }, [activeItem, busy, tagInput, userTags, persistItem, t]);

  const handleRemoveTag = useCallback(async (tagToRemove) => {
    if (!activeItem || busy) return;
    if (!tagToRemove) return;

    setBusy(true);
    try {
      const nextTags = JSON.stringify(userTags.filter((tag) => tag !== tagToRemove));
      await persistItem({ tags: nextTags });
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setFeedback({ type: 'error', text: t('workbench.actionFailed', { error: message }) });
    } finally {
      setBusy(false);
    }
  }, [activeItem, busy, userTags, persistItem, t]);

  if (!activeItem) return null;

  return (
    <div className="workbench-inline-editor">
      <div className="workbench-inline-editor-header">
        <div className="workbench-inline-editor-title-group">
          <div className="workbench-inline-editor-title">{t('item.editNoteAndTags')}</div>
          <div className="workbench-inline-editor-active-time">
            {formatHistoryCardTime(activeItem.updated_at, i18n.language, Date.now(), t('item.justNow'))}
          </div>
        </div>
        <div className="workbench-inline-editor-actions">
          <button
            type="button"
            className={`workbench-inline-header-btn favorite ${activeItem.is_favorite ? 'is-active' : ''}`}
            onClick={handleToggleFavorite}
            disabled={favoritePending}
            title={activeItem.is_favorite ? t('item.unfavorite') : t('item.favorite')}
            aria-label={activeItem.is_favorite ? t('item.unfavorite') : t('item.favorite')}
          >
            {favoritePending ? (
              <Loader2 size={13} className="workbench-feedback-spinner" />
            ) : (
              <Star size={13} fill={activeItem.is_favorite ? 'currentColor' : 'none'} />
            )}
            <span>{activeItem.is_favorite ? t('item.favorited') : t('item.favorite')}</span>
          </button>
          <button
            type="button"
            className="workbench-inline-header-btn save"
            onClick={handleSaveNote}
            disabled={busy || !hasNoteChanges}
            title={t('edit.save')}
            aria-label={t('edit.save')}
          >
            {busy ? <Loader2 size={13} className="workbench-feedback-spinner" /> : <Check size={13} />}
            <span>{t('edit.save')}</span>
          </button>
        </div>
      </div>

      {items.length > 1 && (
        <div className="workbench-inline-editor-switcher">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`workbench-inline-editor-switch-item ${item.id === activeItem.id ? 'active' : ''}`}
              onClick={() => onActiveItemChange?.(item.id)}
              disabled={busy}
            >
              {getContentPreview(item.content || item.user_note || item.ocr_text || t('workbench.exportEmptyLine'))}
            </button>
          ))}
        </div>
      )}

      <div className="workbench-inline-note-row">
        <textarea
          className="workbench-inline-note-input"
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder={t('edit.notePlaceholder')}
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              handleSaveNote();
            }
          }}
        />
      </div>

      <div className="workbench-inline-tags-row">
        <div className="workbench-inline-tags-list">
          {userTags.length === 0 ? (
            <span className="workbench-inline-tags-empty">{t('multiSelect.addTagHint')}</span>
          ) : (
            userTags.map((tag) => (
              <span key={tag} className="workbench-inline-tag-chip">
                <span>{tag}</span>
                <button
                  type="button"
                  className="workbench-inline-tag-remove"
                  onClick={() => handleRemoveTag(tag)}
                  title={t('item.removeTag')}
                  aria-label={t('item.removeTag')}
                  disabled={busy}
                >
                  <X size={11} />
                </button>
              </span>
            ))
          )}
        </div>
        <div className="workbench-inline-tag-input-row">
          <Tag size={13} />
          <input
            type="text"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddTag();
              }
            }}
            placeholder={t('multiSelect.addTagPlaceholder')}
            disabled={busy}
          />
          <button type="button" onClick={handleAddTag} disabled={busy || !tagInput.trim()}>
            {t('item.confirmTag')}
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`workbench-inline-feedback ui-feedback ${feedback.type}`} role="status" aria-live="polite">
          {feedback.text}
        </div>
      )}
    </div>
  );
}

export default WorkbenchInlineEditor;

import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Tag, X } from 'lucide-react';
import { formatHistoryCardTime, getContentPreview } from '../../utils/formatters';
import { getTags, hasReservedTagPrefix } from '../../utils/tagHelpers';

function WorkbenchInlineEditor({
  items,
  activeItemId,
  onActiveItemChange,
  onItemPatched,
  onRefreshItems,
}) {
  const { t, i18n } = useTranslation();
  const [noteDraft, setNoteDraft] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
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
    const normalizedCurrent = String(activeItem.user_note || '');
    if (normalizedCurrent === noteDraft) return;
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
  }, [activeItem, busy, noteDraft, persistItem, t]);

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
        <div className="workbench-inline-editor-title">{t('item.editNoteAndTags')}</div>
        <div className="workbench-inline-editor-active-time">
          {formatHistoryCardTime(activeItem.updated_at, i18n.language, Date.now(), t('item.justNow'))}
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
        />
        <button
          type="button"
          className="workbench-inline-save-btn"
          onClick={handleSaveNote}
          disabled={busy}
        >
          {busy ? <Loader2 size={13} className="workbench-feedback-spinner" /> : <Check size={13} />}
          <span>{t('edit.save')}</span>
        </button>
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Copy,
  ExternalLink,
  Inbox,
  PencilLine,
  Plus,
  Star,
  X,
} from 'lucide-react';
import {
  formatHistoryCardTime,
  getContentPreview,
  getFileList,
  getFileName,
  getLinkPreviewTitle,
  parseUrl,
} from '../../utils/formatters';
import { getImageThumbnail } from '../../utils/imageHelpers';
import { getSourceApp, getTags } from '../../utils/tagHelpers';

const normalizeTag = (value) => (typeof value === 'string' ? value.trim() : '');

const getUserTags = (item) => getTags(item?.tags).filter(tag => !tag.startsWith('AI:'));

function CollectionBoard({
  items,
  timeTick,
  copiedItemId,
  copyFeedbackSource,
  onCopy,
  onTogglePin,
  onToggleFavorite,
  onOpenPreview,
  onOpenItem,
  onOpenEditModal,
  onAddTagToItem,
  maxPinnedItems,
}) {
  const { t, i18n } = useTranslation();
  const [selectedCollectionTags, setSelectedCollectionTags] = useState([]);
  const [activeItemId, setActiveItemId] = useState(null);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [draftTag, setDraftTag] = useState('');
  const [tagEditorBusy, setTagEditorBusy] = useState(false);
  const [tagEditorFeedback, setTagEditorFeedback] = useState('');

  const itemsById = useMemo(() => {
    const map = new Map();
    items.forEach((item) => map.set(item.id, item));
    return map;
  }, [items]);

  const allCollectionTags = useMemo(() => {
    const set = new Set();
    items.forEach((item) => {
      getUserTags(item).forEach((tag) => set.add(tag));
    });
    return Array.from(set).sort((left, right) => (
      left.localeCompare(right, i18n.language || undefined, { sensitivity: 'base' })
    ));
  }, [items, i18n.language]);

  useEffect(() => {
    if (items.length === 0) {
      setActiveItemId(null);
      return;
    }
    if (activeItemId && itemsById.has(activeItemId)) return;
    setActiveItemId(items[0].id);
  }, [items, itemsById, activeItemId]);

  useEffect(() => {
    setSelectedCollectionTags((current) => {
      if (current.length === 0) return current;
      const allowed = new Set(allCollectionTags);
      const next = current.filter(tag => allowed.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [allCollectionTags]);

  const activeItem = activeItemId ? itemsById.get(activeItemId) : null;

  const filteredItems = useMemo(() => {
    if (selectedCollectionTags.length === 0) return items;
    return items.filter((item) => {
      const tags = getUserTags(item);
      return selectedCollectionTags.some(tag => tags.includes(tag));
    });
  }, [items, selectedCollectionTags]);

  const toggleRailTag = useCallback((tag) => {
    const normalized = normalizeTag(tag);
    if (!normalized) return;
    setSelectedCollectionTags((current) => {
      if (current.includes(normalized)) {
        return current.filter(candidate => candidate !== normalized);
      }
      return [...current, normalized];
    });
  }, []);

  const handleOpenTagEditor = useCallback(() => {
    if (!activeItem) {
      setTagEditorFeedback(t('collection.pickCardFirst'));
      return;
    }
    setTagEditorFeedback('');
    setShowTagEditor(true);
  }, [activeItem, t]);

  const closeTagEditor = useCallback(() => {
    setShowTagEditor(false);
    setDraftTag('');
    setTagEditorBusy(false);
    setTagEditorFeedback('');
  }, []);

  const submitTag = useCallback(async () => {
    const normalized = normalizeTag(draftTag);
    if (!normalized || !activeItem || tagEditorBusy) return;
    const existingTags = getUserTags(activeItem);
    if (existingTags.includes(normalized)) {
      setTagEditorFeedback(t('multiSelect.addTagNoChanges'));
      return;
    }
    setTagEditorBusy(true);
    try {
      await onAddTagToItem?.(activeItem, normalized);
      setSelectedCollectionTags((current) => (
        current.includes(normalized) ? current : [...current, normalized]
      ));
      closeTagEditor();
    } catch (error) {
      const message = typeof error === 'string' ? error : String(error?.message || error || '');
      setTagEditorFeedback(t('multiSelect.addTagFailed', { error: message || 'Unknown error' }));
      setTagEditorBusy(false);
    }
  }, [activeItem, closeTagEditor, draftTag, onAddTagToItem, t, tagEditorBusy]);

  const handleTagInputKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTagEditor();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitTag();
    }
  }, [closeTagEditor, submitTag]);

  const renderCardBody = useCallback((item) => {
    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div className="collection-card-image">
          <img src={getImageThumbnail(item.image_paths)} alt="" loading="lazy" />
          {item.ocr_text && (
            <div className="collection-card-image-ocr">{getContentPreview(item.ocr_text, 140)}</div>
          )}
        </div>
      );
    }

    if (item.type_ === 'link') {
      const parsed = parseUrl(item.content || '');
      if (parsed) {
        const title = getLinkPreviewTitle(item) || parsed.domain;
        return (
          <div className="collection-card-link">
            <div className="collection-card-link-title">{title}</div>
            <div className="collection-card-link-meta">{parsed.domain}{parsed.path || ''}</div>
          </div>
        );
      }
    }

    if (item.type_ === 'file') {
      const files = getFileList(item.content || '');
      const visibleFiles = files.slice(0, 3);
      return (
        <div className="collection-card-files">
          {visibleFiles.map((filePath) => (
            <div key={filePath} className="collection-card-file-item">{getFileName(filePath)}</div>
          ))}
          {files.length > visibleFiles.length && (
            <div className="collection-card-file-more">+{files.length - visibleFiles.length}</div>
          )}
        </div>
      );
    }

    return (
      <div className="collection-card-text">
        {getContentPreview(item.content || item.user_note || item.ocr_text || '')}
      </div>
    );
  }, []);

  return (
    <section className="collection-board" onClick={(event) => event.stopPropagation()}>
      <div className="collection-tag-rail-wrap">
        <div className="collection-tag-rail" role="toolbar" aria-label={t('collection.title')}>
          <button
            type="button"
            className={`collection-tag-chip ${selectedCollectionTags.length === 0 ? 'active' : ''}`}
            onClick={() => setSelectedCollectionTags([])}
          >
            {t('collection.allTags')}
          </button>
          {allCollectionTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`collection-tag-chip ${selectedCollectionTags.includes(tag) ? 'active' : ''}`}
              onClick={() => toggleRailTag(tag)}
            >
              {tag}
            </button>
          ))}
          <button
            type="button"
            className="collection-tag-chip add"
            onClick={handleOpenTagEditor}
            title={t('item.addTag')}
            aria-label={t('item.addTag')}
          >
            <Plus size={12} />
          </button>
          {showTagEditor && (
            <div className="collection-tag-editor" onClick={(event) => event.stopPropagation()}>
              <input
                type="text"
                value={draftTag}
                onChange={(event) => setDraftTag(event.target.value)}
                onKeyDown={handleTagInputKeyDown}
                placeholder={t('collection.addTagPlaceholder')}
                autoFocus
              />
              <button
                type="button"
                className="confirm"
                onClick={() => void submitTag()}
                disabled={tagEditorBusy || !normalizeTag(draftTag)}
                title={t('collection.confirmAddTag')}
                aria-label={t('collection.confirmAddTag')}
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                className="cancel"
                onClick={closeTagEditor}
                title={t('collection.cancelAddTag')}
                aria-label={t('collection.cancelAddTag')}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="collection-tag-rail-meta">
          <span>{t('collection.tagFilterHint')}</span>
          {activeItem && (
            <span className="collection-active-item">
              {t('collection.activeCardHint')}
            </span>
          )}
          {tagEditorFeedback && (
            <span className="collection-tag-feedback">{tagEditorFeedback}</span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="collection-empty" role="status" aria-live="polite">
          <div className="collection-empty-title">{t('collection.emptyTitle')}</div>
          <div className="collection-empty-hint">{t('collection.emptyHint')}</div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="collection-empty" role="status" aria-live="polite">
          <div className="collection-empty-title">{t('collection.noTagMatch')}</div>
          <div className="collection-empty-hint">{t('collection.emptyHint')}</div>
        </div>
      ) : (
        <div className="collection-grid">
          {filteredItems.map((item) => {
            const itemTags = getUserTags(item);
            const sourceApp = getSourceApp(item.metadata);
            const isCopied = copiedItemId === item.id
              && (copyFeedbackSource === 'collection' || copyFeedbackSource === 'history');
            const canOpenNative = item.type_ === 'link' || item.type_ === 'file';
            return (
              <article
                key={item.id}
                className={`collection-card ${activeItemId === item.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveItemId(item.id);
                  onOpenPreview?.(item);
                }}
              >
                <div className="collection-card-head">
                  <div className="collection-card-meta">
                    <span className="collection-card-time">
                      {formatHistoryCardTime(item.updated_at, i18n.language, timeTick, t('item.justNow'))}
                    </span>
                    <span className="collection-card-source" title={sourceApp}>{sourceApp}</span>
                  </div>
                  <div className="collection-card-actions">
                    <button
                      type="button"
                      className={isCopied ? 'copied' : ''}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCopy?.(item);
                      }}
                      title={isCopied ? t('item.copied') : t('item.copy')}
                      aria-label={isCopied ? t('item.copied') : t('item.copy')}
                    >
                      {isCopied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    {canOpenNative && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenItem?.(item);
                        }}
                        title={item.type_ === 'link' ? t('item.openLink') : t('item.openFile')}
                        aria-label={item.type_ === 'link' ? t('item.openLink') : t('item.openFile')}
                      >
                        <ExternalLink size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className={item.is_pinned ? 'active' : ''}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePin?.(item);
                      }}
                      title={item.is_pinned ? t('item.unpin') : t('item.pin', { max: maxPinnedItems || 10 })}
                      aria-label={item.is_pinned ? t('item.unpin') : t('item.pin', { max: maxPinnedItems || 10 })}
                    >
                      <Inbox size={13} />
                    </button>
                    <button
                      type="button"
                      className={item.is_favorite ? 'active favorite' : 'favorite'}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleFavorite?.(item);
                      }}
                      title={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
                      aria-label={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
                    >
                      <Star size={13} fill={item.is_favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenEditModal?.(item);
                      }}
                      title={t('item.editNoteAndTag')}
                      aria-label={t('item.editNoteAndTag')}
                    >
                      <PencilLine size={13} />
                    </button>
                  </div>
                </div>
                <div className="collection-card-body">
                  {renderCardBody(item)}
                </div>
                {itemTags.length > 0 && (
                  <div className="collection-card-tags">
                    {itemTags.slice(0, 6).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className={`collection-card-tag ${selectedCollectionTags.includes(tag) ? 'active' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleRailTag(tag);
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                    {itemTags.length > 6 && (
                      <span className="collection-card-tag more">+{itemTags.length - 6}</span>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default CollectionBoard;

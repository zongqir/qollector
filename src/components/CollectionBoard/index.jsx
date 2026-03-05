import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  FileText,
  Folder,
  Inbox,
  LayoutGrid,
  List,
  Palette,
  Plus,
  Search,
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
import { searchItems } from '../../services/clipboardService';
import { getSourceApp, getTags } from '../../utils/tagHelpers';
import {
  CARD_BACKGROUND_DEFAULT_ID,
  CARD_BACKGROUND_PRESETS,
  getCardBackgroundIdFromMetadata,
  getCardBackgroundPreset,
} from '../../utils/cardBackgrounds';

const normalizeTag = (value) => (typeof value === 'string' ? value.trim() : '');

const getUserTags = (item) => getTags(item?.tags).filter(tag => !tag.startsWith('AI:'));
const COLLECTION_VIEW_MODE_KEY = 'qollect-collection-view-mode-v1';
const COLLECTION_VIEW_MODE_CARDS = 'cards';
const COLLECTION_VIEW_MODE_LIST = 'list';
const COLLECTION_QUERY_PAGE_SIZE = 200;

// Keep same file visual language as Workbench to reduce cognitive switching cost.
const FileIconLazy = lazy(() =>
  import('react-file-icon').then(module => ({
    default: ({ extension, ...props }) => {
      const { FileIcon, defaultStyles } = module;
      return <FileIcon extension={extension} {...(defaultStyles[extension] || {})} {...props} />;
    }
  }))
);

const getExt = (filename) => {
  const parts = String(filename || '').split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
};

const isFolderPath = (path) => {
  const raw = String(path || '');
  if (!raw) return false;
  if (raw.endsWith('/') || raw.endsWith('\\')) return true;
  const name = raw.split(/[/\\]/).pop() || '';
  return !name.includes('.');
};

const readCollectionViewMode = () => {
  if (typeof window === 'undefined') return COLLECTION_VIEW_MODE_CARDS;
  try {
    const stored = String(localStorage.getItem(COLLECTION_VIEW_MODE_KEY) || '').trim().toLowerCase();
    if (stored === COLLECTION_VIEW_MODE_LIST || stored === COLLECTION_VIEW_MODE_CARDS) {
      return stored;
    }
  } catch (error) {
    console.warn('[CollectionBoard] read view mode failed:', error);
  }
  return COLLECTION_VIEW_MODE_CARDS;
};

function CollectionBoard({
  items,
  searchQuery,
  selectedType,
  selectedDateRange,
  showPinnedOnly,
  timeTick,
  onTogglePin,
  onToggleFavorite,
  onSetCardBackground,
  onOpenPreview,
  onOpenContextMenu,
  onVisibleItemsChange,
  onAddTagToItem,
  maxPinnedItems,
}) {
  const { t, i18n } = useTranslation();
  const [selectedCollectionTags, setSelectedCollectionTags] = useState([]);
  const [activeItemId, setActiveItemId] = useState(null);
  const [collectionTagQuery, setCollectionTagQuery] = useState('');
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [draftTag, setDraftTag] = useState('');
  const [tagEditorBusy, setTagEditorBusy] = useState(false);
  const [tagEditorFeedback, setTagEditorFeedback] = useState('');
  const [openColorPickerItemId, setOpenColorPickerItemId] = useState(null);
  const [collectionViewMode, setCollectionViewMode] = useState(() => readCollectionViewMode());
  const [backendLimit, setBackendLimit] = useState(COLLECTION_QUERY_PAGE_SIZE);
  const [backendItems, setBackendItems] = useState([]);
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendError, setBackendError] = useState('');
  const colorPickerRef = useRef(null);

  const normalizedSearchQuery = useMemo(
    () => (typeof searchQuery === 'string' ? searchQuery.trim() : ''),
    [searchQuery],
  );
  const normalizedSelectedType = useMemo(
    () => (typeof selectedType === 'string' ? selectedType.trim() : 'all'),
    [selectedType],
  );
  const selectedDateSignature = useMemo(() => (
    selectedDateRange
      ? `${selectedDateRange.start ?? ''}:${selectedDateRange.end ?? ''}`
      : ''
  ), [selectedDateRange]);

  const selectedTagSignature = useMemo(
    () => [...selectedCollectionTags].sort((left, right) => left.localeCompare(right)).join('\u0001'),
    [selectedCollectionTags],
  );

  useEffect(() => {
    setBackendLimit(COLLECTION_QUERY_PAGE_SIZE);
  }, [selectedTagSignature, normalizedSearchQuery, normalizedSelectedType, selectedDateSignature, showPinnedOnly]);

  useEffect(() => {
    let cancelled = false;
    setBackendLoading(true);
    setBackendError('');
    const filters = {
      is_favorite: true,
      ...(showPinnedOnly ? { is_pinned: true } : {}),
      ...(selectedCollectionTags.length > 0 ? { tag_filter: selectedCollectionTags } : {}),
    };
    if (normalizedSelectedType !== 'all' && normalizedSelectedType !== 'code') {
      filters.type_filter = normalizedSelectedType;
    }
    searchItems(normalizedSearchQuery, backendLimit, filters)
      .then((results) => {
        if (cancelled) return;
        setBackendItems(Array.isArray(results) ? results : []);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = typeof error === 'string' ? error : String(error?.message || error || '');
        setBackendError(message);
        setBackendItems([]);
      })
      .finally(() => {
        if (!cancelled) setBackendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    backendLimit,
    selectedCollectionTags,
    showPinnedOnly,
    normalizedSelectedType,
    normalizedSearchQuery,
  ]);

  const collectionItems = useMemo(() => (
    backendItems.filter((item) => {
      if (normalizedSelectedType === 'code' && !item.code_language) {
        return false;
      }
      if (selectedDateRange) {
        if (selectedDateRange.start != null && item.created_at < selectedDateRange.start) return false;
        if (selectedDateRange.end != null && item.created_at > selectedDateRange.end) return false;
      }
      return true;
    })
  ), [backendItems, normalizedSelectedType, selectedDateRange]);
  const tagsSourceItems = useMemo(() => {
    const merged = new Map();
    [...items, ...collectionItems].forEach((item) => {
      if (!item?.id) return;
      merged.set(item.id, item);
    });
    return Array.from(merged.values());
  }, [items, collectionItems]);

  const itemsById = useMemo(() => {
    const map = new Map();
    collectionItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [collectionItems]);

  const allCollectionTags = useMemo(() => {
    const set = new Set();
    tagsSourceItems.forEach((item) => {
      getUserTags(item).forEach((tag) => set.add(tag));
    });
    return Array.from(set).sort((left, right) => (
      left.localeCompare(right, i18n.language || undefined, { sensitivity: 'base' })
    ));
  }, [tagsSourceItems, i18n.language]);

  const collectionTagCounts = useMemo(() => {
    const counts = new Map();
    tagsSourceItems.forEach((item) => {
      getUserTags(item).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return counts;
  }, [tagsSourceItems]);

  const normalizedTagQuery = useMemo(
    () => collectionTagQuery.trim().toLowerCase(),
    [collectionTagQuery],
  );

  const visibleCollectionTags = useMemo(() => {
    if (!normalizedTagQuery) return allCollectionTags;
    return allCollectionTags.filter(tag => tag.toLowerCase().includes(normalizedTagQuery));
  }, [allCollectionTags, normalizedTagQuery]);

  useEffect(() => {
    if (collectionItems.length === 0) {
      setActiveItemId(null);
      return;
    }
    if (activeItemId && itemsById.has(activeItemId)) return;
    setActiveItemId(collectionItems[0].id);
  }, [collectionItems, itemsById, activeItemId]);

  useEffect(() => {
    setSelectedCollectionTags((current) => {
      if (current.length === 0) return current;
      const allowed = new Set(allCollectionTags);
      const next = current.filter(tag => allowed.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [allCollectionTags]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(COLLECTION_VIEW_MODE_KEY, collectionViewMode);
    } catch (error) {
      console.warn('[CollectionBoard] persist view mode failed:', error);
    }
  }, [collectionViewMode]);

  useEffect(() => {
    if (!openColorPickerItemId) return undefined;
    const handlePointerDown = (event) => {
      if (colorPickerRef.current?.contains(event.target)) return;
      setOpenColorPickerItemId(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [openColorPickerItemId]);

  useEffect(() => {
    if (!openColorPickerItemId) return;
    if (itemsById.has(openColorPickerItemId)) return;
    setOpenColorPickerItemId(null);
  }, [openColorPickerItemId, itemsById]);

  useEffect(() => {
    onVisibleItemsChange?.(collectionItems);
  }, [collectionItems, onVisibleItemsChange]);

  const activeItem = activeItemId ? itemsById.get(activeItemId) : null;
  const hasCollectionFilter = selectedCollectionTags.length > 0
    || normalizedSearchQuery.length > 0
    || normalizedSelectedType !== 'all'
    || Boolean(showPinnedOnly)
    || Boolean(selectedDateRange);

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

  const canLoadMore = !backendLoading && backendItems.length >= backendLimit;
  const handleCollectionGridScroll = useCallback((event) => {
    if (!canLoadMore) return;
    const target = event.currentTarget;
    const remaining = target.scrollHeight - (target.scrollTop + target.clientHeight);
    if (remaining > 120) return;
    setBackendLimit(current => current + COLLECTION_QUERY_PAGE_SIZE);
  }, [canLoadMore]);

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

  const handleBackgroundSelect = useCallback((item, backgroundId) => {
    if (!item) return;
    onSetCardBackground?.(item, backgroundId);
    setOpenColorPickerItemId(null);
  }, [onSetCardBackground]);

  const handleOpenContextMenuFromKeyboard = useCallback((item, index, keyboardEvent) => {
    if (!item || !onOpenContextMenu) return;
    const rect = keyboardEvent.currentTarget?.getBoundingClientRect?.();
    const clientX = rect ? Math.round(rect.left + Math.min(rect.width - 12, 28)) : 0;
    const clientY = rect ? Math.round(rect.top + Math.min(rect.height - 12, 28)) : 0;
    onOpenContextMenu(item, index, {
      preventDefault: () => keyboardEvent.preventDefault(),
      stopPropagation: () => keyboardEvent.stopPropagation(),
      clientX,
      clientY,
    });
  }, [onOpenContextMenu]);

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
      const isSingle = files.length === 1;
      const visibleFiles = files.slice(0, isSingle ? 1 : 3);
      return (
        <div className={`collection-card-files ${isSingle ? 'single-file' : ''}`}>
          {visibleFiles.map((filePath, index) => {
            const name = getFileName(filePath);
            const isFolder = isFolderPath(filePath);
            const ext = getExt(name);
            return (
              <div key={`${filePath}-${index}`} className="collection-card-file-item">
                {isFolder ? (
                  <Folder size={isSingle ? 26 : 18} color="#f5c542" fill="#f5c542" className="file-icon" />
                ) : (
                  <Suspense fallback={<FileText size={isSingle ? 26 : 18} className="file-icon" />}>
                    <div className="file-icon" style={{ width: isSingle ? 26 : 18 }}>
                      <FileIconLazy extension={ext} />
                    </div>
                  </Suspense>
                )}
                <span className="file-name" title={name}>{name}</span>
                {!isFolder && ext && <span className="file-ext">{ext}</span>}
              </div>
            );
          })}
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
        <div className="collection-toolbar-row">
          <div className="collection-tag-rail" role="toolbar" aria-label={t('collection.title')}>
            <div className="collection-tag-search" onClick={(event) => event.stopPropagation()}>
              <Search size={12} />
              <input
                type="text"
                value={collectionTagQuery}
                onChange={(event) => setCollectionTagQuery(event.target.value)}
                placeholder={t('collection.searchTagsPlaceholder')}
                aria-label={t('collection.searchTagsPlaceholder')}
              />
              {collectionTagQuery && (
                <button
                  type="button"
                  className="collection-tag-search-clear"
                  onClick={() => setCollectionTagQuery('')}
                  title={t('toolbar.clearFilter')}
                  aria-label={t('toolbar.clearFilter')}
                >
                  <X size={11} />
                </button>
              )}
            </div>
            <button
              type="button"
              className={`collection-tag-chip ${selectedCollectionTags.length === 0 ? 'active' : ''}`}
              onClick={() => setSelectedCollectionTags([])}
            >
              {t('collection.allTags')}
              <span className="collection-tag-chip-count">{allCollectionTags.length}</span>
            </button>
            {visibleCollectionTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`collection-tag-chip ${selectedCollectionTags.includes(tag) ? 'active' : ''}`}
                onClick={() => toggleRailTag(tag)}
              >
                {tag}
                <span className="collection-tag-chip-count">{collectionTagCounts.get(tag) || 0}</span>
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
          <div className="collection-view-toggle" role="group" aria-label={t('collection.viewToggle')}>
            <button
              type="button"
              className={collectionViewMode === COLLECTION_VIEW_MODE_CARDS ? 'active' : ''}
              onClick={() => setCollectionViewMode(COLLECTION_VIEW_MODE_CARDS)}
              title={t('collection.viewCards')}
              aria-label={t('collection.viewCards')}
              aria-pressed={collectionViewMode === COLLECTION_VIEW_MODE_CARDS}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              type="button"
              className={collectionViewMode === COLLECTION_VIEW_MODE_LIST ? 'active' : ''}
              onClick={() => setCollectionViewMode(COLLECTION_VIEW_MODE_LIST)}
              title={t('collection.viewList')}
              aria-label={t('collection.viewList')}
              aria-pressed={collectionViewMode === COLLECTION_VIEW_MODE_LIST}
            >
              <List size={13} />
            </button>
          </div>
        </div>
        <div className="collection-tag-rail-meta">
          <span>{t('collection.tagFilterHint')}</span>
          <span>{t('collection.countLabel', { count: collectionItems.length })}</span>
          {selectedCollectionTags.length > 0 && (
            <span>{t('collection.selectedTagsCount', { count: selectedCollectionTags.length })}</span>
          )}
          {activeItem && (
            <span className="collection-active-item">
              {t('collection.activeCardHint')}
            </span>
          )}
          <span>{t('collection.contextMenuHint')}</span>
          {selectedCollectionTags.length > 0 && (
            <button
              type="button"
              className="collection-clear-tags-btn"
              onClick={() => setSelectedCollectionTags([])}
            >
              {t('collection.clearTagFilter')}
            </button>
          )}
          {tagEditorFeedback && (
            <span className="collection-tag-feedback">{tagEditorFeedback}</span>
          )}
          {backendError && (
            <span className="collection-tag-feedback">{t('collection.queryFailed')}</span>
          )}
        </div>
      </div>

      {backendLoading && collectionItems.length === 0 ? (
        <div className="collection-loading" role="status" aria-live="polite">
          <div className="loading-spinner"></div>
          <div className="loading-text">{t('search.searching')}</div>
        </div>
      ) : collectionItems.length === 0 && !hasCollectionFilter ? (
        <div className="collection-empty" role="status" aria-live="polite">
          <div className="collection-empty-title">{t('collection.emptyTitle')}</div>
          <div className="collection-empty-hint">{t('collection.emptyHint')}</div>
        </div>
      ) : collectionItems.length === 0 ? (
        <div className="collection-empty" role="status" aria-live="polite">
          <div className="collection-empty-title">{t('collection.noTagMatch')}</div>
          <div className="collection-empty-hint">{t('collection.emptyHint')}</div>
        </div>
      ) : (
        <div
          className={`collection-grid ${collectionViewMode === COLLECTION_VIEW_MODE_LIST ? 'list-mode' : ''}`}
          onScroll={handleCollectionGridScroll}
        >
          {collectionItems.map((item, index) => {
            const itemTags = getUserTags(item);
            const sourceApp = getSourceApp(item.metadata);
            const cardBackground = getCardBackgroundPreset(getCardBackgroundIdFromMetadata(item.metadata));
            const hasCustomCardBackground = cardBackground.id !== CARD_BACKGROUND_DEFAULT_ID;
            const showColorPicker = openColorPickerItemId === item.id;
            return (
              <article
                key={item.id}
                className={`
                  collection-card
                  ${collectionViewMode === COLLECTION_VIEW_MODE_LIST ? 'list-mode' : ''}
                  ${activeItemId === item.id ? 'active' : ''}
                  ${hasCustomCardBackground ? 'custom-bg' : ''}
                `.trim()}
                style={hasCustomCardBackground ? { '--collection-card-accent': cardBackground.accent } : undefined}
                role="button"
                tabIndex={0}
                aria-label={t('collection.activeCardHint')}
                aria-pressed={activeItemId === item.id}
                onClick={() => {
                  setActiveItemId(item.id);
                  setOpenColorPickerItemId(null);
                  onOpenPreview?.(item);
                }}
                onContextMenu={(event) => {
                  setActiveItemId(item.id);
                  onOpenContextMenu?.(item, index, event);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveItemId(item.id);
                    onOpenPreview?.(item);
                    return;
                  }
                  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault();
                    handleOpenContextMenuFromKeyboard(item, index, event);
                  }
                }}
              >
                <div className="collection-card-head">
                  <div className="collection-card-meta">
                    <span className="collection-card-time">
                      {formatHistoryCardTime(item.updated_at, i18n.language, timeTick, t('item.justNow'))}
                    </span>
                    <span className="collection-card-source" title={sourceApp}>{sourceApp}</span>
                  </div>
                  <div className="collection-card-actions" ref={showColorPicker ? colorPickerRef : null}>
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
                      className={hasCustomCardBackground ? 'active color' : 'color'}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setOpenColorPickerItemId((current) => (
                          current === item.id ? null : item.id
                        ));
                      }}
                      title={t('item.cardBackground.button')}
                      aria-label={t('item.cardBackground.button')}
                    >
                      <Palette size={13} />
                    </button>
                    {showColorPicker && (
                      <div
                        className="collection-card-color-picker"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {CARD_BACKGROUND_PRESETS.map((preset) => {
                          const isActive = preset.id === cardBackground.id;
                          const isDefault = preset.id === CARD_BACKGROUND_DEFAULT_ID;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              className={`collection-card-color-dot ${isActive ? 'active' : ''} ${isDefault ? 'default' : ''}`}
                              style={!isDefault ? { '--card-color-dot': preset.dot } : undefined}
                              title={t(preset.labelKey)}
                              aria-label={t(preset.labelKey)}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleBackgroundSelect(item, preset.id);
                              }}
                            >
                              {isDefault && <span className="collection-card-color-dot-reset"></span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
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
          {backendLoading && (
            <div className="collection-load-more-hint">{t('collection.loadingMore')}</div>
          )}
        </div>
      )}
    </section>
  );
}

export default CollectionBoard;

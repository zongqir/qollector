import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpDown,
  Check,
  Code,
  FileText,
  Folder,
  GripVertical,
  Image,
  Link,
  Palette,
  Plus,
  Search,
  Star,
  Type,
  X,
  Copy,
  Languages,
  Terminal,
  Clock3,
} from 'lucide-react';
import {
  formatHistoryCardTime,
  getContentPreview,
  getFileList,
  getFileName,
  getLinkPreviewTitle,
  parseUrl,
  isDateTimeCandidate,
} from '../../utils/formatters';
import { isCurlCommand } from '../../utils/curlParser';
import { getImageThumbnail } from '../../utils/imageHelpers';
import {
  getCollectionFavoriteItems,
  getUserTags as getUserTagsSvc,
  reorderCollectionFavoriteItems,
  searchItems,
} from '../../services/clipboardService';
import { getTranslationFromMetadata } from '../../utils/translationHelpers';
import useAppStore from '../../store/useAppStore';
import { getSourceApp, getTags } from '../../utils/tagHelpers';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CARD_BACKGROUND_DEFAULT_ID,
  CARD_BACKGROUND_PRESETS,
  getCardBackgroundIdFromMetadata,
  getCardBackgroundPreset,
  withCardBackgroundInMetadata,
} from '../../utils/cardBackgrounds';
import {
  PREVIEW_CLICK_DELAY_MS,
  SORT_MODE_LONG_PRESS_MOVE_PX,
  SORT_MODE_LONG_PRESS_MS,
  shouldIgnoreCardDoubleClickTarget,
  shouldIgnoreLongPressTarget,
} from '../../utils/previewInteractionPolicy';
import { getCardTagPreviewLimit } from '../../utils/cardDensity';
import {
  PanelSummaryActionButton,
  PanelSummaryBadge,
  PanelSummaryFeedback,
  PanelSummaryRow,
  PanelSummaryText,
} from '../shared/PanelSummaryRow';

const normalizeTag = (value) => (typeof value === 'string' ? value.trim() : '');

const getUserTags = (item) => getTags(item?.tags).filter(tag => !tag.startsWith('AI:'));
const COLLECTION_QUERY_PAGE_SIZE = 200;
const COLLECTION_SEARCH_DEBOUNCE_MS = 260;
const OPEN_ENDED_DATE_MAX_TS = 253402300799;

// Keep same file visual language as Workbench to reduce cognitive switching cost.
const FileIconLazy = lazy(() =>
  import('react-file-icon').then(module => ({
    default: ({ extension, ...props }) => {
      const { FileIcon, defaultStyles } = module;
      return <FileIcon extension={extension} {...(defaultStyles[extension] || {})} {...props} />;
    }
  }))
);
const CodeBlock = lazy(() => import('../CodeBlock/CodeBlock'));

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

const CardTypeIcon = ({ type, hasCodeLanguage, isCurl, isDateTime, hasTranslation }) => {
  const size = 11;
  if (isCurl) return <Terminal size={size} />;
  if (hasCodeLanguage) return <Code size={size} />;
  if (isDateTime && (type === 'text' || !type)) return <Clock3 size={size} />;
  if (hasTranslation && (type === 'text' || !type)) return <Languages size={size} />;
  switch (type) {
    case 'image': return <Image size={size} />;
    case 'file': return <FileText size={size} />;
    case 'link': return <Link size={size} />;
    default: return <Type size={size} />;
  }
};

function SortableCollectionItem({ id, disabled, className, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const sortableAttributes = { ...attributes };
  delete sortableAttributes.role;
  delete sortableAttributes.tabIndex;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 200 : 'auto',
    touchAction: 'none',
  };

  return (
    <div ref={setNodeRef} className={className} style={style} {...sortableAttributes} {...listeners}>
      {children}
    </div>
  );
}

function StaticCollectionItem({ className, children }) {
  return <div className={className}>{children}</div>;
}

function CollectionBoard({
  searchQuery,
  selectedType,
  selectedDateRange,
  itemsRevision = 0,
  isMiniMode = false,
  timeTick,
  selectedItemIds = [],
  onToggleFavorite,
  onSetCardBackground,
  onOpenPreview,
  onOpenContextMenu,
  onVisibleItemsChange,
  onAddTagToItem,
  onCopy,
  onCopyAndAutoPaste,
  onSetSelectedItemIds,
  onToggleSelectItem,
}) {
  const { t, i18n } = useTranslation();
  const [selectedCollectionTags, setSelectedCollectionTags] = useState([]);
  const [translatedItemIds, setTranslatedItemIds] = useState(() => new Set());
  const [copiedTranslationItemId, setCopiedTranslationItemId] = useState(null);
  const [activeItemId, setActiveItemId] = useState(null);
  const [collectionTagQuery, setCollectionTagQuery] = useState('');
  const [debouncedCollectionTagQuery, setDebouncedCollectionTagQuery] = useState('');
  const [backendCollectionUserTags, setBackendCollectionUserTags] = useState([]);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [draftTag, setDraftTag] = useState('');
  const [tagEditorBusy, setTagEditorBusy] = useState(false);
  const [tagEditorFeedback, setTagEditorFeedback] = useState('');
  const [openColorPickerItemId, setOpenColorPickerItemId] = useState(null);
  const [collectionSortMode, setCollectionSortMode] = useState(false);
  const [collectionSortAnchorItemId, setCollectionSortAnchorItemId] = useState(null);
  const [backendLimit, setBackendLimit] = useState(COLLECTION_QUERY_PAGE_SIZE);
  const [backendItems, setBackendItems] = useState([]);
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendFiltering, setBackendFiltering] = useState(false);
  const [backendError, setBackendError] = useState('');
  const [backendFilterError, setBackendFilterError] = useState('');
  const [collectionRefreshNonce, setCollectionRefreshNonce] = useState(0);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [backendFilteredFavoriteIds, setBackendFilteredFavoriteIds] = useState(null);
  const [showSortEntryToast, setShowSortEntryToast] = useState(false);
  const colorPickerRef = useRef(null);
  const collectionGridRef = useRef(null);
  const collectionCardRefsRef = useRef(new Map());
  const collectionSortAnchorRef = useRef(null);
  const collectionSortLongPressTimerRef = useRef(null);
  const collectionSortEntryToastTimerRef = useRef(null);
  const collectionCardClickTimerRef = useRef(null);
  const collectionSortLongPressPointerRef = useRef({ pointerId: null, x: 0, y: 0 });
  const suppressNextCardClickRef = useRef(false);
  const isCollectionSortMode = !isMiniMode && collectionSortMode;
  const shouldUseDndLayout = !isMiniMode && isCollectionSortMode;
  const effectiveSelectedCollectionTags = useMemo(
    () => (isMiniMode ? [] : selectedCollectionTags),
    [isMiniMode, selectedCollectionTags],
  );

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
    () => [...effectiveSelectedCollectionTags].sort((left, right) => left.localeCompare(right)).join('\u0001'),
    [effectiveSelectedCollectionTags],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(normalizedSearchQuery);
    }, COLLECTION_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [normalizedSearchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCollectionTagQuery(collectionTagQuery.trim());
    }, 180);
    return () => clearTimeout(timer);
  }, [collectionTagQuery]);

  useEffect(() => {
    setBackendLimit(COLLECTION_QUERY_PAGE_SIZE);
  }, [selectedTagSignature, normalizedSearchQuery, normalizedSelectedType, selectedDateSignature]);

  useEffect(() => {
    let cancelled = false;
    setBackendLoading(true);
    setBackendError('');
    setBackendFilterError('');
    getCollectionFavoriteItems()
      .then((results) => {
        if (cancelled) return;
        setBackendItems(Array.isArray(results) ? results : []);
        setBackendError('');
      })
      .catch((error) => {
        if (cancelled) return;
        const message = typeof error === 'string' ? error : String(error?.message || error || '');
        setBackendError(message);
        setBackendFilterError('');
        setBackendItems([]);
      })
      .finally(() => {
        if (!cancelled) setBackendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemsRevision, collectionRefreshNonce]);

  useEffect(() => {
    let cancelled = false;
    getUserTagsSvc(debouncedCollectionTagQuery, 200, { onlyFavorite: true })
      .then((tags) => {
        if (cancelled) return;
        if (!Array.isArray(tags)) {
          setBackendCollectionUserTags([]);
          return;
        }
        setBackendCollectionUserTags(
          tags.filter(tag => typeof tag === 'string' && tag.trim() && !tag.startsWith('AI:')),
        );
      })
      .catch((error) => {
        console.error('[CollectionBoard] load favorite user tags failed:', error);
        if (!cancelled) setBackendCollectionUserTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedCollectionTagQuery, backendItems]);

  const collectionBackendFilterRequest = useMemo(() => {
    const query = debouncedSearchQuery.trim();
    const filters = { is_favorite: true };

    if (normalizedSelectedType === 'code') {
      filters.require_code_language = true;
    } else if (normalizedSelectedType !== 'all') {
      filters.type_filter = normalizedSelectedType;
    }
    if (effectiveSelectedCollectionTags.length > 0) {
      filters.tag_filter = Array.from(new Set(effectiveSelectedCollectionTags));
    }

    const rangeStart = Number(selectedDateRange?.start);
    const rangeEnd = Number(selectedDateRange?.end);
    const hasStart = Number.isFinite(rangeStart);
    const hasEnd = Number.isFinite(rangeEnd);
    if (hasStart || hasEnd) {
      filters.date_range = {
        start: hasStart ? rangeStart : 0,
        end: hasEnd ? rangeEnd : OPEN_ENDED_DATE_MAX_TS,
      };
    }

    const shouldQueryBackend = query.length > 0
      || normalizedSelectedType !== 'all'
      || effectiveSelectedCollectionTags.length > 0
      || hasStart
      || hasEnd;

    return {
      query,
      filters,
      shouldQueryBackend,
    };
  }, [
    debouncedSearchQuery,
    normalizedSelectedType,
    effectiveSelectedCollectionTags,
    selectedDateRange,
  ]);

  useEffect(() => {
    if (!collectionBackendFilterRequest.shouldQueryBackend) {
      setBackendFilteredFavoriteIds(null);
      setBackendFiltering(false);
      setBackendFilterError('');
      return;
    }

    let cancelled = false;
    setBackendFiltering(true);
    const limit = Math.max(COLLECTION_QUERY_PAGE_SIZE, Math.min(6000, backendItems.length + 400));
    searchItems(collectionBackendFilterRequest.query, limit, collectionBackendFilterRequest.filters)
      .then((results) => {
        if (cancelled) return;
        const ids = new Set((Array.isArray(results) ? results : []).map((item) => item.id));
        setBackendFilteredFavoriteIds(ids);
        setBackendFilterError('');
      })
      .catch((error) => {
        console.error('[CollectionBoard] backend filter search failed:', error);
        if (!cancelled) {
          const message = typeof error === 'string' ? error : String(error?.message || error || '');
          setBackendFilteredFavoriteIds(null);
          setBackendFilterError(message || t('collection.queryFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) setBackendFiltering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    collectionBackendFilterRequest,
    backendItems.length,
    itemsRevision,
    t,
    collectionRefreshNonce,
  ]);

  const orderedFavoriteItems = useMemo(
    () => backendItems.filter(item => item.is_favorite !== false),
    [backendItems],
  );

  const allFavoriteItems = useMemo(() => {
    if (!(backendFilteredFavoriteIds instanceof Set)) {
      return orderedFavoriteItems;
    }
    return orderedFavoriteItems.filter((item) => backendFilteredFavoriteIds.has(item.id));
  }, [orderedFavoriteItems, backendFilteredFavoriteIds]);

  const collectionItems = useMemo(
    () => allFavoriteItems.slice(0, backendLimit),
    [allFavoriteItems, backendLimit],
  );
  const tagsSourceItems = useMemo(
    () => orderedFavoriteItems,
    [orderedFavoriteItems],
  );

  const itemsById = useMemo(() => {
    const map = new Map();
    collectionItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [collectionItems]);
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const selectedCollectionTagSet = useMemo(
    () => new Set(selectedCollectionTags),
    [selectedCollectionTags],
  );
  const collectionItemIds = useMemo(
    () => collectionItems.map((item) => item.id),
    [collectionItems],
  );

  const collectionAvailableTags = useMemo(() => {
    const availableSet = new Set();
    tagsSourceItems.forEach((item) => {
      getUserTags(item).forEach((tag) => availableSet.add(tag));
    });
    return Array.from(availableSet).sort((left, right) => (
      left.localeCompare(right, i18n.language || undefined, { sensitivity: 'base' })
    ));
  }, [tagsSourceItems, i18n.language]);

  const allCollectionTags = useMemo(() => {
    const seenBackendTags = new Set();
    const normalizedBackendTags = [];
    backendCollectionUserTags.forEach((tag) => {
      if (typeof tag !== 'string') return;
      const normalized = tag.trim();
      if (!normalized || seenBackendTags.has(normalized)) return;
      seenBackendTags.add(normalized);
      normalizedBackendTags.push(normalized);
    });

    if (normalizedBackendTags.length > 0) {
      return normalizedBackendTags;
    }
    if (!debouncedCollectionTagQuery) {
      return collectionAvailableTags;
    }
    return [];
  }, [collectionAvailableTags, backendCollectionUserTags, debouncedCollectionTagQuery]);

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
      const allowed = new Set(collectionAvailableTags);
      const next = current.filter(tag => allowed.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [collectionAvailableTags]);


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
  const truncatedCollectionQuery = useMemo(() => {
    if (!normalizedSearchQuery) return '';
    return normalizedSearchQuery.length > 16
      ? `${normalizedSearchQuery.slice(0, 16)}…`
      : normalizedSearchQuery;
  }, [normalizedSearchQuery]);

  const collectionFilterSummaryParts = useMemo(() => {
    const parts = [];
    if (truncatedCollectionQuery) {
      parts.push(t('toolbar.keywordFilterActive', { query: truncatedCollectionQuery }));
    }
    if (normalizedSelectedType !== 'all') {
      parts.push(t('search.empty.filterType', { type: t(`search.typeFilter.${normalizedSelectedType}`) }));
    }
    if (selectedDateRange) {
      parts.push(t('toolbar.dateFilterActive'));
    }
    return parts;
  }, [
    normalizedSelectedType,
    selectedDateRange,
    t,
    truncatedCollectionQuery,
  ]);
  const hasCollectionFilterSummary = collectionFilterSummaryParts.length > 0;
  const hasCollectionFilter = effectiveSelectedCollectionTags.length > 0
    || normalizedSearchQuery.length > 0
    || normalizedSelectedType !== 'all'
    || Boolean(selectedDateRange);
  const collectionTagPreviewLimit = getCardTagPreviewLimit('collection', {
    isMiniMode,
    isListMode: true,
  });

  const renderCollectionCardFooter = (item, itemTags) => {
    const userNote = typeof item?.user_note === 'string' ? item.user_note.trim() : '';
    const visibleTags = itemTags.slice(0, collectionTagPreviewLimit);
    const hiddenTagsCount = Math.max(itemTags.length - collectionTagPreviewLimit, 0);
    if (!userNote && (isMiniMode || itemTags.length === 0)) return null;

    return (
      <div className="collection-card-footer panel-card-footer">
        {userNote && (
          <div className="collection-card-note panel-card-note" title={userNote}>
            {userNote}
          </div>
        )}
        {!isMiniMode && visibleTags.length > 0 && (
          <div className="collection-card-tags panel-card-tags">
            {visibleTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`collection-card-tag panel-card-tag ${selectedCollectionTagSet.has(tag) ? 'active' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleRailTag(tag);
                }}
              >
                {tag}
              </button>
            ))}
            {hiddenTagsCount > 0 && (
              <span className="collection-card-tag panel-card-tag more">+{hiddenTagsCount}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  const setCollectionCardRef = useCallback((id, node) => {
    if (!id) return;
    if (node) {
      collectionCardRefsRef.current.set(id, node);
      return;
    }
    collectionCardRefsRef.current.delete(id);
  }, []);

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

  const isBackendBusy = backendLoading || backendFiltering;
  const backendStateError = backendFilterError || backendError;
  const shouldShowCollectionMetaRow = isBackendBusy
    || hasCollectionFilterSummary
    || Boolean(tagEditorFeedback)
    || Boolean(backendStateError);
  const canLoadMore = !isBackendBusy && allFavoriteItems.length > collectionItems.length;
  const handleCollectionGridScroll = useCallback((event) => {
    if (!canLoadMore) return;
    const target = event.currentTarget;
    const remaining = target.scrollHeight - (target.scrollTop + target.clientHeight);
    if (remaining > 120) return;
    setBackendLimit(current => current + COLLECTION_QUERY_PAGE_SIZE);
  }, [canLoadMore]);

  const handleCollectionTagRailWheel = useCallback((event) => {
    const target = event.currentTarget;
    if (!target) return;

    const canScrollHorizontally = target.scrollWidth > target.clientWidth + 4;
    if (!canScrollHorizontally) return;

    const delta = Math.abs(event.deltaX) > 0.5 ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 0.5) return;

    target.scrollLeft += delta;
    event.preventDefault();
  }, []);

  const collectionDragEnabled = collectionItems.length > 1 && shouldUseDndLayout;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleCollectionDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = backendItems.findIndex(item => item.id === active.id);
    const newIndex = backendItems.findIndex(item => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextOrderedItems = arrayMove(backendItems, oldIndex, newIndex);
    setBackendItems(nextOrderedItems);
    const orderedIds = nextOrderedItems
      .filter(item => item.is_favorite !== false)
      .map(item => item.id);
    reorderCollectionFavoriteItems(orderedIds).catch(async (error) => {
      console.error('[CollectionBoard] persist favorite order failed:', error);
      try {
        const latest = await getCollectionFavoriteItems();
        setBackendItems(Array.isArray(latest) ? latest : []);
      } catch (refreshError) {
        console.error('[CollectionBoard] refresh favorite items after reorder failed:', refreshError);
      }
    });
  }, [backendItems]);

  const handleRetryCollectionLoad = useCallback(() => {
    setBackendError('');
    setBackendFilterError('');
    setCollectionRefreshNonce((current) => current + 1);
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

  const patchCollectionItem = useCallback((targetId, patch) => {
    if (!targetId) return;
    setBackendItems((current) => current.map((candidate) => (
      candidate.id === targetId ? { ...candidate, ...patch } : candidate
    )));
  }, []);

  const handleToggleFavorite = useCallback(async (item) => {
    if (!item?.id) return;
    let nextFavoriteState = !item.is_favorite;
    try {
      const result = await onToggleFavorite?.(item);
      if (typeof result === 'boolean') {
        nextFavoriteState = result;
      }
      // Keep the card visible in current collection session even after un-favorite,
      // and only update star state immediately.
      patchCollectionItem(item.id, { is_favorite: nextFavoriteState });
      return nextFavoriteState;
    } catch (error) {
      console.error('[CollectionBoard] toggle favorite failed:', error);
      return item.is_favorite;
    }
  }, [onToggleFavorite, patchCollectionItem]);

  const handleSetCardBackground = useCallback(async (item, backgroundId) => {
    if (!item?.id) return;
    const metadata = withCardBackgroundInMetadata(item.metadata, backgroundId);
    const updatedAt = Math.floor(Date.now() / 1000);
    try {
      await onSetCardBackground?.(item, backgroundId);
      patchCollectionItem(item.id, {
        metadata,
        updated_at: updatedAt,
      });
    } catch (error) {
      console.error('[CollectionBoard] set card background failed:', error);
    }
  }, [onSetCardBackground, patchCollectionItem]);

  const handleBackgroundSelect = useCallback((item, backgroundId) => {
    if (!item) return;
    setOpenColorPickerItemId(null);
    void handleSetCardBackground(item, backgroundId);
  }, [handleSetCardBackground]);

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
    }, 'collection');
  }, [onOpenContextMenu]);


  const clearCollectionSortLongPressTimer = useCallback(() => {
    if (collectionSortLongPressTimerRef.current) {
      clearTimeout(collectionSortLongPressTimerRef.current);
      collectionSortLongPressTimerRef.current = null;
    }
  }, []);

  const clearCollectionCardClickTimer = useCallback(() => {
    if (collectionCardClickTimerRef.current) {
      clearTimeout(collectionCardClickTimerRef.current);
      collectionCardClickTimerRef.current = null;
    }
  }, []);

  const showCollectionSortEntryToast = useCallback(() => {
    setShowSortEntryToast(true);
    if (collectionSortEntryToastTimerRef.current) {
      clearTimeout(collectionSortEntryToastTimerRef.current);
    }
    collectionSortEntryToastTimerRef.current = setTimeout(() => {
      setShowSortEntryToast(false);
      collectionSortEntryToastTimerRef.current = null;
    }, 1300);
  }, []);

  const handleCollectionCardPointerUp = useCallback(() => {
    clearCollectionSortLongPressTimer();
    collectionSortLongPressPointerRef.current.pointerId = null;
  }, [clearCollectionSortLongPressTimer]);

  const handleCollectionCardPointerMove = useCallback((event) => {
    if (!collectionSortLongPressTimerRef.current) return;
    const state = collectionSortLongPressPointerRef.current;
    if (state.pointerId != null && event.pointerId !== state.pointerId) return;
    const dx = Math.abs((event.clientX || 0) - state.x);
    const dy = Math.abs((event.clientY || 0) - state.y);
    if (dx > SORT_MODE_LONG_PRESS_MOVE_PX || dy > SORT_MODE_LONG_PRESS_MOVE_PX) {
      clearCollectionSortLongPressTimer();
    }
  }, [clearCollectionSortLongPressTimer]);

  const handleCollectionCardPointerDown = useCallback((item, event) => {
    if (!item?.id) return;
    if (isMiniMode || isCollectionSortMode) return;
    if (event.button !== 0) return;
    if (shouldIgnoreLongPressTarget(event.target)) {
      return;
    }

    clearCollectionSortLongPressTimer();
    collectionSortLongPressPointerRef.current = {
      pointerId: event.pointerId ?? null,
      x: event.clientX || 0,
      y: event.clientY || 0,
    };
    collectionSortLongPressTimerRef.current = setTimeout(() => {
      collectionSortLongPressTimerRef.current = null;
      suppressNextCardClickRef.current = true;
      setActiveItemId(item.id);
      setOpenColorPickerItemId(null);
      const pointerState = collectionSortLongPressPointerRef.current;
      const card = collectionCardRefsRef.current.get(item.id);
      if (card) {
        const rect = card.getBoundingClientRect();
        const gridRect = collectionGridRef.current?.getBoundingClientRect?.();
        const offsetYRatio = rect.height > 0
          ? Math.min(1, Math.max(0, (pointerState.y - rect.top) / rect.height))
          : 0.5;
        collectionSortAnchorRef.current = {
          itemId: item.id,
          pointerClientY: pointerState.y,
          offsetYRatio,
          pointerYInGrid: gridRect ? (pointerState.y - gridRect.top) : null,
        };
      } else {
        collectionSortAnchorRef.current = null;
      }
      setCollectionSortAnchorItemId(item.id);
      setCollectionSortMode(true);
      showCollectionSortEntryToast();
    }, SORT_MODE_LONG_PRESS_MS);
  }, [
    clearCollectionSortLongPressTimer,
    isCollectionSortMode,
    isMiniMode,
    showCollectionSortEntryToast,
  ]);

  const handleFinishCollectionSortMode = useCallback(() => {
    setCollectionSortMode(false);
    setCollectionSortAnchorItemId(null);
    setShowSortEntryToast(false);
    clearCollectionSortLongPressTimer();
    collectionSortLongPressPointerRef.current.pointerId = null;
    collectionSortAnchorRef.current = null;
  }, [clearCollectionSortLongPressTimer]);

  const handleCollectionCardClick = useCallback((item, event) => {
    if (suppressNextCardClickRef.current) {
      suppressNextCardClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    clearCollectionCardClickTimer();
    setActiveItemId(item.id);
    setOpenColorPickerItemId(null);
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      onToggleSelectItem?.(item.id);
      return;
    }
    if (selectedItemIds.length > 0) {
      event.preventDefault();
      onToggleSelectItem?.(item.id);
      return;
    }
    if (isCollectionSortMode) {
      return;
    }
    collectionCardClickTimerRef.current = setTimeout(() => {
      collectionCardClickTimerRef.current = null;
      onOpenPreview?.(item);
    }, PREVIEW_CLICK_DELAY_MS);
  }, [clearCollectionCardClickTimer, isCollectionSortMode, onOpenPreview, onToggleSelectItem, selectedItemIds.length]);

  const handleCollectionCardDoubleClick = useCallback((item, event) => {
    if (!item?.id) return;
    if (shouldIgnoreCardDoubleClickTarget(event.target, event.currentTarget)) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearCollectionSortLongPressTimer();
    clearCollectionCardClickTimer();
    collectionSortLongPressPointerRef.current.pointerId = null;
    setActiveItemId(item.id);
    setOpenColorPickerItemId(null);
    window.getSelection()?.removeAllRanges();

    if (isCollectionSortMode) return;
    onCopyAndAutoPaste?.(item, 'collection', { bypassInternalSourceProtection: true });
  }, [
    clearCollectionSortLongPressTimer,
    clearCollectionCardClickTimer,
    isCollectionSortMode,
    onCopyAndAutoPaste,
  ]);

  const handleCollectionCardContextMenu = useCallback((item, index, event) => {
    clearCollectionSortLongPressTimer();
    clearCollectionCardClickTimer();
    collectionSortLongPressPointerRef.current.pointerId = null;
    setActiveItemId(item.id);
    if (!selectedItemIdSet.has(item.id)) {
      onSetSelectedItemIds?.([item.id]);
    }
    onOpenContextMenu?.(item, index, event, 'collection');
  }, [
    clearCollectionSortLongPressTimer,
    clearCollectionCardClickTimer,
    onOpenContextMenu,
    onSetSelectedItemIds,
    selectedItemIdSet,
  ]);

  const handleCollectionCardKeyDown = useCallback((item, index, event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      clearCollectionCardClickTimer();
      setActiveItemId(item.id);
      setOpenColorPickerItemId(null);
      if (event.shiftKey) {
        onOpenPreview?.(item);
        return;
      }
      if (isCollectionSortMode) {
        return;
      }
      if (item.type_ === 'image' || item.type_ === 'file') {
        onCopy?.(item, 'collection');
        return;
      }
      onCopyAndAutoPaste?.(item, 'collection');
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      clearCollectionCardClickTimer();
      setActiveItemId(item.id);
      setOpenColorPickerItemId(null);
      onOpenPreview?.(item);
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      handleOpenContextMenuFromKeyboard(item, index, event);
    }
  }, [
    clearCollectionCardClickTimer,
    handleOpenContextMenuFromKeyboard,
    isCollectionSortMode,
    onCopy,
    onCopyAndAutoPaste,
    onOpenPreview,
  ]);

  useEffect(() => (
    () => {
      clearCollectionSortLongPressTimer();
    }
  ), [clearCollectionSortLongPressTimer]);

  useEffect(() => (
    () => {
      clearCollectionCardClickTimer();
    }
  ), [clearCollectionCardClickTimer]);

  useEffect(() => (
    () => {
      if (collectionSortEntryToastTimerRef.current) {
        clearTimeout(collectionSortEntryToastTimerRef.current);
        collectionSortEntryToastTimerRef.current = null;
      }
    }
  ), []);

  useEffect(() => {
    if (!isCollectionSortMode) return undefined;
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handleFinishCollectionSortMode();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleFinishCollectionSortMode, isCollectionSortMode]);

  const handleCollectionCardPointerDownCapture = useCallback((event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, input, textarea, select, a, [data-longpress-ignore="true"]')) {
      event.stopPropagation();
    }
  }, []);

  const handleCollectionCardPointerHandlers = useMemo(() => ({
    onPointerDown: (event, item) => handleCollectionCardPointerDown(item, event),
    onPointerMove: handleCollectionCardPointerMove,
    onPointerUp: handleCollectionCardPointerUp,
    onPointerCancel: handleCollectionCardPointerUp,
    onPointerLeave: handleCollectionCardPointerUp,
  }), [handleCollectionCardPointerDown, handleCollectionCardPointerMove, handleCollectionCardPointerUp]);

  const handleCollectionCardCommonEvents = useMemo(() => ({
    onContextMenu: (item, index, event) => handleCollectionCardContextMenu(item, index, event),
    onKeyDown: (item, index, event) => handleCollectionCardKeyDown(item, index, event),
  }), [handleCollectionCardContextMenu, handleCollectionCardKeyDown]);

  const handleCollectionCardClickEvent = useCallback((item, event) => {
    handleCollectionCardClick(item, event);
  }, [handleCollectionCardClick]);

  const isCollectionListMode = true;

  const getCardPointerProps = useCallback((item) => ({
    onPointerDown: (event) => handleCollectionCardPointerHandlers.onPointerDown(event, item),
    onPointerMove: handleCollectionCardPointerHandlers.onPointerMove,
    onPointerUp: handleCollectionCardPointerHandlers.onPointerUp,
    onPointerCancel: handleCollectionCardPointerHandlers.onPointerCancel,
    onPointerLeave: handleCollectionCardPointerHandlers.onPointerLeave,
  }), [handleCollectionCardPointerHandlers]);

  const getCardCommonProps = useCallback((item, index) => ({
    onClick: (event) => handleCollectionCardClickEvent(item, event),
    onDoubleClick: (event) => handleCollectionCardDoubleClick(item, event),
    onContextMenu: (event) => handleCollectionCardCommonEvents.onContextMenu(item, index, event),
    onKeyDown: (event) => handleCollectionCardCommonEvents.onKeyDown(item, index, event),
    onPointerDownCapture: handleCollectionCardPointerDownCapture,
    ...getCardPointerProps(item),
  }), [
    getCardPointerProps,
    handleCollectionCardClickEvent,
    handleCollectionCardDoubleClick,
    handleCollectionCardCommonEvents,
    handleCollectionCardPointerDownCapture,
  ]);

  useLayoutEffect(() => {
    if (!isCollectionSortMode) return;
    const anchor = collectionSortAnchorRef.current;
    if (!anchor) return;

    let rafId = 0;
    let attemptCount = 0;
    const maxAttempts = 60;
    const applyAnchorCompensation = () => {
      const grid = collectionGridRef.current;
      const card = collectionCardRefsRef.current.get(anchor.itemId);
      if (!grid || !card) {
        collectionSortAnchorRef.current = null;
        return;
      }

      const gridRect = grid.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const ratioY = Math.min(1, Math.max(0, anchor.offsetYRatio ?? 0.5));
      const desiredY = anchor.pointerYInGrid != null
        ? gridRect.top + anchor.pointerYInGrid
        : anchor.pointerClientY;
      const currentY = cardRect.top + (cardRect.height * ratioY);
      const deltaY = currentY - desiredY;

      if (Math.abs(deltaY) > 0.5) {
        const prevScrollTop = grid.scrollTop;
        grid.scrollTop += deltaY;
        const reachedBoundary = Math.abs(grid.scrollTop - prevScrollTop) < 0.5;
        if (reachedBoundary) {
          collectionSortAnchorRef.current = null;
          return;
        }
      }

      const pointerYInGrid = desiredY - gridRect.top;
      const cardTopInGrid = cardRect.top - gridRect.top;
      const cardBottomInGrid = cardRect.bottom - gridRect.top;
      const verticalSearchHit = pointerYInGrid >= cardTopInGrid - 14 && pointerYInGrid <= cardBottomInGrid + 14;

      attemptCount += 1;
      if (attemptCount < maxAttempts && (!verticalSearchHit || Math.abs(deltaY) > 0.35)) {
        rafId = requestAnimationFrame(applyAnchorCompensation);
        return;
      }
      collectionSortAnchorRef.current = null;
    };

    rafId = requestAnimationFrame(applyAnchorCompensation);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isCollectionSortMode]);

  const renderCardBody = useCallback((item) => {
    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div className="collection-card-image panel-card-content-image">
          <img className="panel-card-content-image-media" src={getImageThumbnail(item.image_paths)} alt="" loading="lazy" />
          {item.ocr_text && (
            <div className="collection-card-image-ocr panel-card-image-ocr">{getContentPreview(item.ocr_text, 140)}</div>
          )}
        </div>
      );
    }

    if (item.type_ === 'link') {
      const parsed = parseUrl(item.content || '');
      if (parsed) {
        const title = getLinkPreviewTitle(item) || parsed.domain;
        return (
          <div className="collection-card-link panel-card-content-link">
            <div className="collection-card-link-title panel-card-link-title">{title}</div>
            <div className="collection-card-link-meta panel-card-link-meta">{parsed.domain}{parsed.path || ''}</div>
          </div>
        );
      }
    }

    if (item.type_ === 'file') {
      const files = getFileList(item.content || '');
      const visibleCount = isMiniMode ? 1 : 2;
      const visibleFiles = files.slice(0, visibleCount);
      return (
        <div className="collection-card-files panel-card-content-files">
          {visibleFiles.map((filePath, index) => {
            const name = getFileName(filePath);
            const isFolder = isFolderPath(filePath);
            const ext = getExt(name);
            return (
              <div key={`${filePath}-${index}`} className="collection-card-file-item panel-card-file-item">
                {isFolder ? (
                  <Folder size={14} color="#f5c542" fill="#f5c542" className="file-icon panel-card-file-icon" />
                ) : (
                  <Suspense fallback={<FileText size={14} className="file-icon panel-card-file-icon" />}>
                    <div className="file-icon panel-card-file-icon" style={{ width: 14 }}>
                      <FileIconLazy extension={ext} />
                    </div>
                  </Suspense>
                )}
                <span className="file-name panel-card-file-name" title={name}>{name}</span>
                {!isFolder && ext && <span className="file-ext panel-card-file-ext">{ext}</span>}
              </div>
            );
          })}
          {files.length > visibleFiles.length && (
            <div className="collection-card-file-more panel-card-file-more">+{files.length - visibleFiles.length}</div>
          )}
        </div>
      );
    }

    if (item.code_language && item.content) {
      return (
        <Suspense fallback={<div className="collection-card-text panel-card-content-text">{getContentPreview(item.content || '')}</div>}>
          <CodeBlock code={item.content} language={item.code_language} maxLines={isCollectionListMode ? 3 : 6} compact />
        </Suspense>
      );
    }

    const translation = getTranslationFromMetadata(item.metadata);
    if (translatedItemIds.has(item.id) && translation?.text) {
      return (
        <div className="collection-card-text panel-card-content-text collection-card-translated">
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', fontSize: '10px', color: 'var(--primary-color)', fontWeight: 500 }}>
            <Languages size={10} />
            <span>{t('item.translatedText')} ({translation.source_lang} ➔ {translation.target_lang})</span>
          </div>
          {getContentPreview(translation.text)}
        </div>
      );
    }

    return (
      <div className="collection-card-text panel-card-content-text">
        {getContentPreview(item.content || item.user_note || item.ocr_text || '')}
      </div>
    );
  }, [isCollectionListMode, translatedItemIds, t]);

  const renderCollectionCard = (item, index) => {
    const itemTags = getUserTags(item);
    const sourceApp = getSourceApp(item.metadata);
    const translation = getTranslationFromMetadata(item.metadata);
    const isTranslated = translatedItemIds.has(item.id);
    const cardBackground = getCardBackgroundPreset(getCardBackgroundIdFromMetadata(item.metadata));
    const hasCustomCardBackground = cardBackground.id !== CARD_BACKGROUND_DEFAULT_ID;
    const showColorPicker = openColorPickerItemId === item.id;
    const isSelected = selectedItemIdSet.has(item.id);
    const selectionClassName = isSelected
      ? (selectedItemIds.length > 1 ? 'multi-selected' : 'selected')
      : '';

    const isCurl = item.type_ === 'text' && Boolean(item.content) && isCurlCommand(item.content);
    const isDateTime = item.type_ === 'text' && Boolean(item.content) && isDateTimeCandidate(item.content);

    return (
      <article
        ref={(node) => setCollectionCardRef(item.id, node)}
        className={`
          collection-card
          panel-card-shell
          list-mode
          ${activeItemId === item.id ? 'active' : ''}
          ${selectionClassName}
          ${isCollectionSortMode ? 'sort-mode' : ''}
          ${isCollectionSortMode && collectionSortAnchorItemId === item.id ? 'sort-anchor' : ''}
          ${hasCustomCardBackground ? 'custom-bg' : ''}
        `.trim()}
        style={hasCustomCardBackground ? { '--collection-card-accent': cardBackground.accent } : undefined}
        role="button"
        tabIndex={0}
        aria-label={t('collection.activeCardHint')}
        aria-pressed={activeItemId === item.id || isSelected}
        {...getCardCommonProps(item, index)}
      >
        <div className="collection-card-head panel-card-header">
          <div className="collection-card-head-left panel-card-head-main">
            {isCollectionSortMode && (
              <span className="collection-sort-grip" aria-hidden="true" title={t('collection.dragHandle')}>
                <GripVertical size={12} />
              </span>
            )}
            <span className="collection-card-type-icon panel-card-type-icon" aria-hidden="true">
              <CardTypeIcon
                type={item.type_}
                hasCodeLanguage={Boolean(item.code_language)}
                isCurl={isCurl}
                isDateTime={isDateTime}
                hasTranslation={Boolean(translation)}
              />
            </span>
            <div className="collection-card-meta panel-card-meta">
              <span className="collection-card-time panel-card-time">
                {formatHistoryCardTime(item.updated_at, i18n.language, timeTick, t('item.justNow'))}
              </span>
              {sourceApp && (
                <span className="collection-card-source panel-card-source" title={sourceApp}>{sourceApp}</span>
              )}
            </div>
          </div>
          <div className="collection-card-actions panel-card-actions panel-card-actions--hover-reveal" ref={showColorPicker ? colorPickerRef : null}>
            {translation && (
              <button
                type="button"
                className={`panel-card-action-btn ${isTranslated ? 'is-active translate' : 'translate'}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setTranslatedItemIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  });
                }}
                title={isTranslated ? t('item.showOriginal') : t('item.showTranslation')}
                aria-label={isTranslated ? t('item.showOriginal') : t('item.showTranslation')}
              >
                <Languages size={12} />
              </button>
            )}
            {translation && (
              <button
                type="button"
                className="panel-card-action-btn copy-trans"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  navigator.clipboard.writeText(translation.text);
                  setCopiedTranslationItemId(item.id);
                  setTimeout(() => setCopiedTranslationItemId(null), 1500);
                }}
                title={t('item.copyTranslation')}
                aria-label={t('item.copyTranslation')}
              >
                {copiedTranslationItemId === item.id ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
            <button
              type="button"
              className={`panel-card-action-btn ${item.is_favorite ? 'is-active favorite' : 'favorite'}`}
              onClick={(event) => {
                event.stopPropagation();
                void handleToggleFavorite(item);
              }}
              title={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
              aria-label={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
            >
              <Star size={12} fill={item.is_favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className={`panel-card-action-btn ${hasCustomCardBackground ? 'is-active color' : 'color'}`}
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
              <Palette size={12} />
            </button>
            {showColorPicker && (
              <div
                className="compact-card-color-picker"
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
                      className={`compact-card-color-dot ${isActive ? 'active' : ''} ${isDefault ? 'default' : ''}`}
                      style={!isDefault ? { '--card-color-dot': preset.dot } : undefined}
                      title={t(preset.labelKey)}
                      aria-label={t(preset.labelKey)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleBackgroundSelect(item, preset.id);
                      }}
                    >
                      {isDefault && <span className="compact-card-color-dot-reset"></span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="collection-card-body panel-card-body">
          {renderCardBody(item)}
        </div>
        {renderCollectionCardFooter(item, itemTags)}
      </article>
    );
  };

  return (
    <section className={`collection-board ${isMiniMode ? 'mini-list-only' : ''}`.trim()} onClick={(event) => event.stopPropagation()}>
      {!isMiniMode && (
        <div className="collection-tag-rail-wrap">
          <div className="collection-toolbar-row">
            <div
              className="collection-tag-rail"
              role="toolbar"
              aria-label={t('collection.title')}
              onWheel={handleCollectionTagRailWheel}
            >
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
                title={selectedCollectionTags.length > 0 ? t('collection.clearTagFilter') : undefined}
              >
                {t('collection.allTags')}
                <span className="collection-tag-chip-count">{allCollectionTags.length}</span>
              </button>
              {visibleCollectionTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`collection-tag-chip ${selectedCollectionTagSet.has(tag) ? 'active' : ''}`}
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
          </div>
        {isCollectionSortMode && (
          <div className="collection-sort-banner" role="status" aria-live="polite">
            <span className="collection-sort-banner-text">{t('collection.sortModeHint')}</span>
            <span className="collection-sort-banner-key">Esc</span>
            <button
              type="button"
              className="collection-sort-toggle active"
              onClick={handleFinishCollectionSortMode}
              title={t('collection.finishSortMode')}
              aria-label={t('collection.finishSortMode')}
              aria-pressed
            >
              <ArrowUpDown size={12} />
              <span>{t('collection.finishSortMode')}</span>
            </button>
          </div>
        )}
        {shouldShowCollectionMetaRow && (
          <PanelSummaryRow className="collection-tag-rail-meta">
            {isBackendBusy && (
              <PanelSummaryBadge className="is-busy panel-summary-item--status">{t('search.searching')}</PanelSummaryBadge>
            )}
            {hasCollectionFilterSummary && (
              <PanelSummaryText className="collection-filter-summary panel-summary-item--primary">
                {collectionFilterSummaryParts.join(' · ')}
              </PanelSummaryText>
            )}
            {tagEditorFeedback && (
              <PanelSummaryFeedback className="collection-tag-feedback panel-summary-item--feedback">{tagEditorFeedback}</PanelSummaryFeedback>
            )}
            {backendStateError && (
              <PanelSummaryFeedback className="collection-tag-feedback panel-summary-item--feedback" title={backendStateError}>
                {t('collection.queryFailed')}
              </PanelSummaryFeedback>
            )}
          </PanelSummaryRow>
        )}
        </div>
      )}

      {isBackendBusy && collectionItems.length === 0 ? (
        <div className="collection-loading state-panel state-panel--loading panel-state-stack" role="status" aria-live="polite">
          <div className="loading-spinner"></div>
          <div className="loading-text state-panel__text panel-state-text">{t('search.searching')}</div>
        </div>
      ) : backendStateError && collectionItems.length === 0 ? (
        <div className="collection-empty error state-panel state-panel--error panel-state-stack" role="status" aria-live="polite">
          <div className="collection-empty-title state-panel__title panel-state-title">{t('collection.queryFailed')}</div>
          <div className="collection-empty-hint state-panel__hint panel-state-text">{backendStateError}</div>
          <button
            type="button"
            className="collection-retry-btn state-retry-btn panel-state-action-btn"
            onClick={handleRetryCollectionLoad}
          >
            {t('collection.retryLoad')}
          </button>
        </div>
      ) : collectionItems.length === 0 && !hasCollectionFilter ? (
        <div className="collection-empty state-panel panel-state-stack" role="status" aria-live="polite">
          <div className="collection-empty-title state-panel__title panel-state-title">{t('collection.emptyTitle')}</div>
          <div className="collection-empty-hint state-panel__hint panel-state-text">{t('collection.emptyHint')}</div>
        </div>
      ) : collectionItems.length === 0 ? (
        <div className="collection-empty state-panel panel-state-stack" role="status" aria-live="polite">
          <div className="collection-empty-title state-panel__title panel-state-title">{t('collection.noTagMatch')}</div>
          <div className="collection-empty-hint state-panel__hint panel-state-text">{t('collection.emptyHint')}</div>
        </div>
      ) : (
        <div
          ref={collectionGridRef}
          className="collection-grid list-mode"
          onScroll={handleCollectionGridScroll}
        >
          {shouldUseDndLayout ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleCollectionDragEnd}
            >
              <SortableContext items={collectionItemIds} strategy={rectSortingStrategy}>
                {collectionItems.map((item, index) => (
                  <SortableCollectionItem key={item.id} id={item.id} disabled={!collectionDragEnabled} className="collection-grid-item">
                    {renderCollectionCard(item, index)}
                  </SortableCollectionItem>
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            <>
              {collectionItems.map((item, index) => (
                <StaticCollectionItem key={item.id} className="collection-grid-item">
                  {renderCollectionCard(item, index)}
                </StaticCollectionItem>
              ))}
            </>
          )}
          {isBackendBusy && (
            <div className="collection-load-more-hint">{t('collection.loadingMore')}</div>
          )}
        </div>
      )}
      {showSortEntryToast && (
        <div className="collection-entry-toast" role="status" aria-live="polite">
          {t('collection.releaseThenDragHint')}
        </div>
      )}
    </section>
  );
}

export default memo(CollectionBoard);

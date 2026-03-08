import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Star, Inbox, Settings, Type, Image, File, Link, Braces, Layers } from 'lucide-react';
import { parseSystemTag } from '../utils/tagHelpers';
import useEscapeDismiss from './hooks/useEscapeDismiss';
import useClickOutsideDismiss from './hooks/useClickOutsideDismiss';
import useFilterDropdownCoordinator from './hooks/useFilterDropdownCoordinator';
import TagFilterControl from './shared/TagFilterControl';
import SavedViewControl from './shared/SavedViewControl';
import TypeFilterControl from './shared/TypeFilterControl';
import DateFilterControl from './shared/DateFilterControl';
import {
  PanelSummaryActionButton,
  PanelSummaryBadge,
  PanelSummaryFeedback,
  PanelSummaryRow,
  PanelSummaryText,
} from './shared/PanelSummaryRow';

function SearchBar({
  searchQuery, onSearchChange,
  selectedType, onTypeChange,
  showFavoritesOnly, onToggleFavorites,
  showPinnedOnly, onTogglePinned,
  isMiniMode,
  selectedTags, onClearTags,
  showTagFilter, onToggleTagFilter,
  allTags, filteredTagsList,
  tagSearchQuery, onTagSearchChange,
  onToggleTag,
  onOpenSettings,
  selectedDateRange, showDateFilter, onToggleDateFilter,
  onClearDateFilter, onSelectDatePreset,
  customDateStart, customDateEnd,
  onCustomDateStartChange, onCustomDateEndChange,
  onApplyCustomDateRange,
  onSearchKeyDown,
  savedFilterViews,
  activeFilterViewId,
  onSaveCurrentView,
  onApplySavedView,
  onDeleteSavedView,
  onClearActiveSavedView,
  resultCount,
  filterBusy = false,
  filterError = '',
}) {
  const { t } = useTranslation();
  const searchInputRef = useRef(null);
  const tagListboxRef = useRef(null);
  const tagWrapperRef = useRef(null);
  const dateWrapperRef = useRef(null);
  const typeWrapperRef = useRef(null);
  const savedViewWrapperRef = useRef(null);
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [showSavedViews, setShowSavedViews] = useState(false);
  const [savedViewName, setSavedViewName] = useState('');

  useEffect(() => {
    const focusSearchInput = () => {
      const input = searchInputRef.current;
      if (!input) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) {
        return;
      }
      input.focus();
      const cursor = input.value?.length ?? 0;
      input.setSelectionRange(cursor, cursor);
    };

    const timer = window.setTimeout(focusSearchInput, 0);
    window.addEventListener('focus', focusSearchInput);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', focusSearchInput);
    };
  }, []);

  useClickOutsideDismiss({
    isOpen: showTagFilter,
    wrapperRef: tagWrapperRef,
    onDismiss: onToggleTagFilter,
  });
  useClickOutsideDismiss({
    isOpen: showDateFilter,
    wrapperRef: dateWrapperRef,
    onDismiss: onToggleDateFilter,
  });
  useClickOutsideDismiss({
    isOpen: showTypeFilter,
    wrapperRef: typeWrapperRef,
    onDismiss: () => setShowTypeFilter(false),
  });
  useClickOutsideDismiss({
    isOpen: showSavedViews,
    wrapperRef: savedViewWrapperRef,
    onDismiss: () => setShowSavedViews(false),
  });

  const datePresets = [
    { key: 'today', label: t('toolbar.dateToday'), badge: t('toolbar.dateBadgeToday') },
    { key: 'yesterday', label: t('toolbar.dateYesterday'), badge: t('toolbar.dateBadgeYesterday') },
    { key: '7d', label: t('toolbar.dateLast7Days'), badge: t('toolbar.dateBadgeLast7Days') },
    { key: '30d', label: t('toolbar.dateLast30Days'), badge: t('toolbar.dateBadgeLast30Days') },
    { key: 'custom', label: t('toolbar.dateCustomRange'), badge: t('toolbar.dateBadgeCustomRange') },
  ];

  const dateBadgeText = selectedDateRange
    ? (selectedDateRange.preset === 'custom'
      ? t('toolbar.dateBadgeCustomRange')
      : datePresets.find(p => p.key === selectedDateRange.preset)?.badge || '')
    : '';
  const selectedDatePreset = selectedDateRange?.preset || null;

  const typeOptions = [
    { key: 'all', icon: <Layers size={14} /> },
    { key: 'text', icon: <Type size={14} /> },
    { key: 'image', icon: <Image size={14} /> },
    { key: 'file', icon: <File size={14} /> },
    { key: 'link', icon: <Link size={14} /> },
    { key: 'code', icon: <Braces size={14} /> },
  ];
  const selectedTypeOption = typeOptions.find(({ key }) => key === selectedType) || typeOptions[0];
  const datePresetOptions = datePresets.map(({ key, label }) => ({ key, label }));
  const typeFilterOptions = typeOptions.map(({ key, icon }) => ({ key, icon }));
  const parsedTagOptions = useMemo(() => (
    filteredTagsList
      .map((tag) => {
        const parsed = parseSystemTag(tag, {
          sourcePrefix: t('tag.source'),
          typePrefix: t('tag.type'),
        });
        return {
          key: tag,
          tag,
          kind: parsed.kind,
          displayTag: parsed.displayText,
          isAITag: parsed.kind === 'ai',
          isSourceTag: parsed.kind === 'source',
          isUserTag: parsed.kind !== 'ai' && parsed.kind !== 'source',
        };
      })
      .filter((option) => option.kind !== 'type')
  ), [filteredTagsList, t]);
  const visibleTagOptions = parsedTagOptions.slice(0, 20);
  const savedViews = Array.isArray(savedFilterViews) ? savedFilterViews : [];
  const activeSavedView = savedViews.find(view => view.id === activeFilterViewId) || null;
  const hasSelectedTags = selectedTags.length > 0;
  const hasSelectedDate = Boolean(selectedDateRange);
  const hasActiveSavedView = Boolean(activeSavedView);
  const hasSelectedType = selectedType !== 'all';
  const hasFavoritesOnly = Boolean(showFavoritesOnly);
  const hasPinnedOnly = Boolean(showPinnedOnly);
  const normalizedFilterError = typeof filterError === 'string' ? filterError.trim() : '';
  const normalizedSearchQuery = useMemo(
    () => (typeof searchQuery === 'string' ? searchQuery.trim() : ''),
    [searchQuery],
  );
  const normalizedResultCount = useMemo(() => {
    const parsed = Number(resultCount);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.trunc(parsed));
  }, [resultCount]);
  const truncatedSearchQuery = useMemo(() => (
    normalizedSearchQuery.length > 18
      ? `${normalizedSearchQuery.slice(0, 18)}...`
      : normalizedSearchQuery
  ), [normalizedSearchQuery]);
  const filterSummaryParts = useMemo(() => {
    const parts = [];
    if (truncatedSearchQuery) {
      parts.push(t('toolbar.keywordFilterActive', { query: truncatedSearchQuery }));
    }
    if (hasSelectedType) {
      parts.push(t('search.empty.filterType', { type: t(`search.typeFilter.${selectedType}`) }));
    }
    if (hasSelectedTags) {
      parts.push(t('search.empty.filterTags', { count: selectedTags.length }));
    }
    if (hasSelectedDate) {
      parts.push(t('toolbar.dateFilterActive'));
    }
    if (hasFavoritesOnly) {
      parts.push(t('search.empty.filterFavorites'));
    }
    if (hasPinnedOnly) {
      parts.push(t('search.empty.filterPinned'));
    }
    if (hasActiveSavedView) {
      parts.push(t('search.savedViews.using', { name: activeSavedView.name }));
    }
    return parts;
  }, [
    activeSavedView,
    hasActiveSavedView,
    hasFavoritesOnly,
    hasPinnedOnly,
    hasSelectedDate,
    hasSelectedTags,
    hasSelectedType,
    selectedType,
    selectedTags.length,
    t,
    truncatedSearchQuery,
  ]);
  const shouldShowFilterSummary = !isMiniMode
    && !hasFavoritesOnly
    && (filterSummaryParts.length > 0 || filterBusy || Boolean(normalizedFilterError));
  const handleClearFilterSummary = useCallback(() => {
    if (normalizedSearchQuery) onSearchChange?.('');
    if (hasSelectedType) onTypeChange?.('all');
    if (hasSelectedTags) onClearTags?.();
    if (hasSelectedDate) onClearDateFilter?.();
    if (hasFavoritesOnly) onToggleFavorites?.();
    if (hasPinnedOnly) onTogglePinned?.();
    if (hasActiveSavedView) onClearActiveSavedView?.();
  }, [
    hasActiveSavedView,
    hasFavoritesOnly,
    hasPinnedOnly,
    normalizedSearchQuery,
    hasSelectedDate,
    hasSelectedTags,
    hasSelectedType,
    onSearchChange,
    onClearActiveSavedView,
    onClearDateFilter,
    onClearTags,
    onToggleFavorites,
    onTogglePinned,
    onTypeChange,
  ]);
  const tagDropdownId = 'search-tag-filter-dropdown';
  const tagListboxId = `${tagDropdownId}-options`;
  const dateDropdownId = 'search-date-filter-dropdown';
  const typeDropdownId = 'search-type-filter-dropdown';
  const savedViewDropdownId = 'search-saved-view-dropdown';

  const closeTagFilter = useCallback(() => {
    if (showTagFilter) {
      onToggleTagFilter?.();
    }
  }, [showTagFilter, onToggleTagFilter]);

  const closeDateFilter = useCallback(() => {
    if (showDateFilter) {
      onToggleDateFilter?.();
    }
  }, [showDateFilter, onToggleDateFilter]);

  const closeTypeFilter = useCallback(() => {
    if (showTypeFilter) {
      setShowTypeFilter(false);
    }
  }, [showTypeFilter]);

  const closeSavedViews = useCallback(() => {
    if (showSavedViews) {
      setShowSavedViews(false);
    }
  }, [showSavedViews]);

  const coordinatedDropdowns = useMemo(() => ({
    saved: {
      isOpen: showSavedViews,
      open: () => setShowSavedViews(true),
      close: closeSavedViews,
    },
    type: {
      isOpen: showTypeFilter,
      open: () => setShowTypeFilter(true),
      close: closeTypeFilter,
    },
    date: {
      isOpen: showDateFilter,
      open: onToggleDateFilter,
      close: closeDateFilter,
    },
    tag: {
      isOpen: showTagFilter,
      open: onToggleTagFilter,
      close: closeTagFilter,
    },
  }), [
    showSavedViews,
    closeSavedViews,
    showTypeFilter,
    closeTypeFilter,
    showDateFilter,
    onToggleDateFilter,
    closeDateFilter,
    showTagFilter,
    onToggleTagFilter,
    closeTagFilter,
  ]);

  const {
    hasOpenDropdown,
    toggleDropdown,
    dismissOpenDropdowns,
  } = useFilterDropdownCoordinator(coordinatedDropdowns);

  useEscapeDismiss(hasOpenDropdown, dismissOpenDropdowns);

  const toggleTagFilter = useCallback(() => {
    toggleDropdown('tag');
  }, [toggleDropdown]);

  const toggleDateFilter = useCallback(() => {
    toggleDropdown('date');
  }, [toggleDropdown]);

  const toggleTypeFilter = useCallback(() => {
    toggleDropdown('type');
  }, [toggleDropdown]);

  const toggleSavedViews = useCallback(() => {
    toggleDropdown('saved');
  }, [toggleDropdown]);

  const handleTagSearchInputKeyDown = useCallback((event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (visibleTagOptions.length === 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') {
      tagListboxRef.current?.focusLast?.();
      return;
    }
    tagListboxRef.current?.focusFirst?.();
  }, [visibleTagOptions.length]);

  const handleSaveView = () => {
    const normalizedName = savedViewName.trim();
    if (!normalizedName) return;
    const result = onSaveCurrentView?.(normalizedName);
    if (result?.ok) {
      setSavedViewName('');
    }
  };

  return (
    <header className="header" onClick={(e) => e.stopPropagation()}>
      {/* 主行：搜索 + 收藏 + 标签筛选 + 类型筛选 + 设置 */}
      <div className="header-row">
        <div className="search-box">
          <input
            id="history-search-input"
            ref={searchInputRef}
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="search-input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="clear-search"
              aria-label={t('toolbar.clearFilter')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          onClick={onToggleFavorites}
          className={`header-icon-btn ${showFavoritesOnly ? 'active fav-active' : ''}`}
          title={showFavoritesOnly ? t('toolbar.showAll') : t('toolbar.showFavorites')}
          aria-label={showFavoritesOnly ? t('toolbar.showAll') : t('toolbar.showFavorites')}
          aria-pressed={showFavoritesOnly}
        >
          <Star size={15} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
        </button>

        {isMiniMode && (
          <button
            onClick={onTogglePinned}
            className={`header-icon-btn pin-filter-btn ${showPinnedOnly ? 'active pin-active' : ''}`}
            title={showPinnedOnly ? t('toolbar.showAll') : t('toolbar.showPinned')}
            aria-label={showPinnedOnly ? t('toolbar.showAll') : t('toolbar.showPinned')}
            aria-pressed={showPinnedOnly}
          >
            <Inbox size={15} fill={showPinnedOnly ? 'currentColor' : 'none'} />
          </button>
        )}

        {allTags.length > 0 && (
          <TagFilterControl
            wrapperRef={tagWrapperRef}
            isOpen={showTagFilter}
            onToggle={toggleTagFilter}
            onClose={closeTagFilter}
            controlsId={tagDropdownId}
            listboxId={tagListboxId}
            listboxRef={tagListboxRef}
            selectedTags={selectedTags}
            tagSearchQuery={tagSearchQuery}
            onTagSearchChange={onTagSearchChange}
            onTagSearchInputKeyDown={handleTagSearchInputKeyDown}
            visibleTagOptions={visibleTagOptions}
            totalTagOptionsCount={parsedTagOptions.length}
            onToggleTag={onToggleTag}
            onClearTags={onClearTags}
            labelText={t('toolbar.filterTags')}
            searchPlaceholderText={t('toolbar.searchTags')}
            noTagsFoundText={t('toolbar.noTagsFound')}
            moreTagsHintText={(count) => t('toolbar.moreTagsHint', { count })}
            clearAllText={t('toolbar.clearAll')}
          />
        )}

        <DateFilterControl
          wrapperRef={dateWrapperRef}
          isOpen={showDateFilter}
          onToggle={toggleDateFilter}
          onClose={closeDateFilter}
          controlsId={dateDropdownId}
          hasSelection={Boolean(selectedDateRange)}
          badgeText={dateBadgeText}
          dateFilterText={t('toolbar.dateFilter')}
          datePresetOptions={datePresetOptions}
          selectedDatePreset={selectedDatePreset}
          onSelectDatePreset={onSelectDatePreset}
          selectedDateRange={selectedDateRange}
          customDateStart={customDateStart}
          customDateEnd={customDateEnd}
          onCustomDateStartChange={onCustomDateStartChange}
          onCustomDateEndChange={onCustomDateEndChange}
          onApplyCustomDateRange={onApplyCustomDateRange}
          onClearDateFilter={onClearDateFilter}
          dateStartText={t('toolbar.dateStart')}
          dateEndText={t('toolbar.dateEnd')}
          dateApplyText={t('toolbar.dateApply')}
          clearDateFilterText={t('toolbar.clearDateFilter')}
        />

        <SavedViewControl
          wrapperRef={savedViewWrapperRef}
          isOpen={showSavedViews}
          onToggle={toggleSavedViews}
          onClose={closeSavedViews}
          controlsId={savedViewDropdownId}
          savedViews={savedViews}
          activeFilterViewId={activeFilterViewId}
          activeSavedView={activeSavedView}
          savedViewName={savedViewName}
          onSavedViewNameChange={setSavedViewName}
          onSaveView={handleSaveView}
          onApplySavedView={onApplySavedView}
          onDeleteSavedView={onDeleteSavedView}
          onClearActiveSavedView={onClearActiveSavedView}
          titleText={t('search.savedViews.title')}
          namePlaceholderText={t('search.savedViews.namePlaceholder')}
          saveCurrentText={t('search.savedViews.saveCurrent')}
          emptyText={t('search.savedViews.empty')}
          activeText={t('search.savedViews.active')}
          deleteText={t('search.savedViews.delete')}
          clearActiveText={t('search.savedViews.clearActive')}
        />

        {!isMiniMode && (
          <div className="type-filter-group">
            {typeOptions.map(({ key, icon }) => (
              <button
                key={key}
                onClick={() => onTypeChange(key)}
                className={`type-filter-btn ${selectedType === key ? 'active' : ''}`}
                title={t(`search.typeFilter.${key}`)}
                aria-label={t(`search.typeFilter.${key}`)}
                aria-pressed={selectedType === key}
              >
                {icon}
              </button>
            ))}
          </div>
        )}

        <TypeFilterControl
          wrapperRef={typeWrapperRef}
          wrapperClassName={isMiniMode ? 'mini-type-filter' : ''}
          isOpen={showTypeFilter}
          onToggle={toggleTypeFilter}
          onClose={closeTypeFilter}
          controlsId={typeDropdownId}
          selectedType={selectedType}
          selectedTypeIcon={selectedTypeOption.icon}
          options={typeFilterOptions}
          onSelectType={(key) => {
            onTypeChange(key);
            setShowTypeFilter(false);
          }}
          typeLabelText={t('toolbar.filterType')}
          getOptionLabel={(key) => t(`search.typeFilter.${key}`)}
        />

        <button onClick={onOpenSettings} className="header-icon-btn settings-btn" title={t('settings.title')} aria-label={t('settings.title')}>
          <Settings size={15} />
        </button>
      </div>

      {shouldShowFilterSummary && (
        <PanelSummaryRow className={`filter-status ${hasActiveSavedView ? 'saved-view-status' : ''}`.trim()}>
          {filterBusy && (
            <PanelSummaryBadge className="is-busy panel-summary-item--status">{t('search.searching')}</PanelSummaryBadge>
          )}
          {normalizedResultCount !== null && (
            <PanelSummaryBadge className="panel-summary-item--count">{t('toolbar.resultCount', { count: normalizedResultCount })}</PanelSummaryBadge>
          )}
          {filterSummaryParts.length > 0 && (
            <PanelSummaryText className="filter-status-text panel-summary-item--primary">
              {filterSummaryParts.join(' · ')}
            </PanelSummaryText>
          )}
          {normalizedFilterError && (
            <PanelSummaryFeedback className="panel-summary-item--feedback" role="status" ariaLive="polite" title={normalizedFilterError}>
              {t('search.queryFailed')}
            </PanelSummaryFeedback>
          )}
          {filterSummaryParts.length > 0 && (
            <PanelSummaryActionButton onClick={handleClearFilterSummary} className="clear-filter-btn panel-summary-item--action" title={t('toolbar.clearAll')}>
              <X size={12} /> {t('toolbar.clearFilter')}
            </PanelSummaryActionButton>
          )}
        </PanelSummaryRow>
      )}
    </header>
  );
}

export default SearchBar;

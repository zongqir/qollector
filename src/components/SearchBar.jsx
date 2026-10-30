import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, X, Star, Settings, Type, Image, File, Link, Braces, Layers } from 'lucide-react';
import { parseSystemTag } from '../utils/tagHelpers';
import useEscapeDismiss from './hooks/useEscapeDismiss';
import useClickOutsideDismiss from './hooks/useClickOutsideDismiss';
import useFilterDropdownCoordinator from './hooks/useFilterDropdownCoordinator';
import TagFilterControl from './shared/TagFilterControl';
import TypeFilterControl from './shared/TypeFilterControl';
import {
  PanelSummaryActionButton,
  PanelSummaryBadge,
  PanelSummaryFeedback,
  PanelSummaryRow,
  PanelSummaryText,
} from './shared/PanelSummaryRow';

function SearchBar({
  searchQuery, onSearchChange,
  recentSearches = [], onApplyRecentSearch, onClearRecentSearches, onRemoveRecentSearch,
  selectedType, onTypeChange,
  showFavoritesOnly, onToggleFavorites,
  isMiniMode,
  selectedTags, onClearTags,
  showTagFilter, onToggleTagFilter, onCloseTagFilter,
  allTags, filteredTagsList,
  tagSearchQuery, onTagSearchChange,
  onToggleTag,
  onOpenSettings,
  onSearchKeyDown,
  resultCount,
  filterBusy = false,
  filterError = '',
}) {
  const { t } = useTranslation();
  const searchInputRef = useRef(null);
  const searchBoxRef = useRef(null);
  const shouldToggleRecentSearchesOnClickRef = useRef(false);
  const tagListboxRef = useRef(null);
  const tagWrapperRef = useRef(null);
  const typeWrapperRef = useRef(null);
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [showRecentSearches, setShowRecentSearches] = useState(false);
  const [activeRecentSearchIndex, setActiveRecentSearchIndex] = useState(-1);

  useClickOutsideDismiss({
    isOpen: showRecentSearches,
    wrapperRef: searchBoxRef,
    onDismiss: () => {
      setShowRecentSearches(false);
      setActiveRecentSearchIndex(-1);
    },
  });
  useClickOutsideDismiss({
    isOpen: showTagFilter,
    wrapperRef: tagWrapperRef,
    onDismiss: () => {
      if (onCloseTagFilter) {
        onCloseTagFilter();
      } else if (showTagFilter) {
        onToggleTagFilter?.();
      }
    },
  });
  useClickOutsideDismiss({
    isOpen: showTypeFilter,
    wrapperRef: typeWrapperRef,
    onDismiss: () => setShowTypeFilter(false),
  });

  const typeOptions = [
    { key: 'all', icon: <Layers size={14} /> },
    { key: 'text', icon: <Type size={14} /> },
    { key: 'image', icon: <Image size={14} /> },
    { key: 'file', icon: <File size={14} /> },
    { key: 'link', icon: <Link size={14} /> },
    { key: 'code', icon: <Braces size={14} /> },
  ];
  const selectedTypeOption = typeOptions.find(({ key }) => key === selectedType) || typeOptions[0];
  const typeFilterOptions = typeOptions.map(({ key, icon }) => ({ key, icon }));
  const parsedTagOptions = useMemo(() => (
    filteredTagsList
      .filter((tag) => typeof tag === 'string' && !tag.startsWith('AI:'))
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
          isSourceTag: parsed.kind === 'source',
          isUserTag: parsed.kind !== 'source',
        };
      })
      .filter((option) => option.kind !== 'type' && option.kind !== 'ai')
  ), [filteredTagsList, t]);
  const visibleTagOptions = parsedTagOptions.slice(0, 20);
  const hasSelectedTags = selectedTags.length > 0;
  const hasSelectedType = selectedType !== 'all';
  const hasFavoritesOnly = Boolean(showFavoritesOnly);
  const normalizedFilterError = typeof filterError === 'string' ? filterError.trim() : '';
  const normalizedSearchQuery = useMemo(
    () => (typeof searchQuery === 'string' ? searchQuery.trim() : ''),
    [searchQuery],
  );
  const normalizedRecentSearches = useMemo(() => (
    Array.isArray(recentSearches)
      ? recentSearches
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
      : []
  ), [recentSearches]);
  const canShowRecentSearches = normalizedSearchQuery.length === 0 && normalizedRecentSearches.length > 0;
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
    if (hasFavoritesOnly) {
      parts.push(t('search.empty.filterFavorites'));
    }
    return parts;
  }, [
    hasFavoritesOnly,
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
    if (hasFavoritesOnly) onToggleFavorites?.();
  }, [
    hasFavoritesOnly,
    normalizedSearchQuery,
    hasSelectedTags,
    hasSelectedType,
    onSearchChange,
    onClearTags,
    onToggleFavorites,
    onTypeChange,
  ]);
  const tagDropdownId = 'search-tag-filter-dropdown';
  const tagListboxId = `${tagDropdownId}-options`;
  const typeDropdownId = 'search-type-filter-dropdown';

  const closeTagFilter = useCallback(() => {
    if (onCloseTagFilter) {
      onCloseTagFilter();
    } else if (showTagFilter) {
      onToggleTagFilter?.();
    }
  }, [showTagFilter, onToggleTagFilter, onCloseTagFilter]);

  const closeTypeFilter = useCallback(() => {
    if (showTypeFilter) {
      setShowTypeFilter(false);
    }
  }, [showTypeFilter]);
  const closeRecentSearches = useCallback(() => {
    setShowRecentSearches(false);
    setActiveRecentSearchIndex(-1);
  }, []);
  const openRecentSearches = useCallback(() => {
    if (!canShowRecentSearches) return;
    setShowRecentSearches(true);
  }, [canShowRecentSearches]);

  const coordinatedDropdowns = useMemo(() => ({
    type: {
      isOpen: showTypeFilter,
      open: () => setShowTypeFilter(true),
      close: closeTypeFilter,
    },
    tag: {
      isOpen: showTagFilter,
      open: onToggleTagFilter,
      close: closeTagFilter,
    },
    recentSearches: {
      isOpen: showRecentSearches,
      open: openRecentSearches,
      close: closeRecentSearches,
    },
  }), [
    showTypeFilter,
    closeTypeFilter,
    showTagFilter,
    onToggleTagFilter,
    closeTagFilter,
    showRecentSearches,
    openRecentSearches,
    closeRecentSearches,
  ]);

  useEffect(() => {
    if (!showRecentSearches) {
      setActiveRecentSearchIndex(-1);
      return;
    }
    if (!canShowRecentSearches) {
      closeRecentSearches();
      return;
    }
    setActiveRecentSearchIndex((current) => (
      current >= normalizedRecentSearches.length ? normalizedRecentSearches.length - 1 : current
    ));
  }, [
    canShowRecentSearches,
    closeRecentSearches,
    normalizedRecentSearches.length,
    showRecentSearches,
  ]);

  const {
    hasOpenDropdown,
    toggleDropdown,
    dismissOpenDropdowns,
  } = useFilterDropdownCoordinator(coordinatedDropdowns);

  useEscapeDismiss(hasOpenDropdown, dismissOpenDropdowns);

  // 1) 重新打开主窗口（获得 focus / 变为可见）或窗口切走（blur / 隐藏）时，收起搜索下拉框并聚焦输入框
  useEffect(() => {
    const handleWindowFocusOrVisible = () => {
      dismissOpenDropdowns();
      const input = searchInputRef.current;
      if (!input) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) {
        return;
      }
      input.focus();
      const cursor = input.value?.length ?? 0;
      input.setSelectionRange?.(cursor, cursor);
    };

    const handleWindowBlurOrHide = () => {
      dismissOpenDropdowns();
    };

    const handleVisibilityChange = () => {
      dismissOpenDropdowns();
    };

    const timer = window.setTimeout(handleWindowFocusOrVisible, 0);
    window.addEventListener('focus', handleWindowFocusOrVisible);
    window.addEventListener('blur', handleWindowBlurOrHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', handleWindowFocusOrVisible);
      window.removeEventListener('blur', handleWindowBlurOrHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [dismissOpenDropdowns]);

  // 2) mini 模式切换（窗口缩小或放大）时，自动收起下拉框
  useEffect(() => {
    dismissOpenDropdowns();
  }, [isMiniMode, dismissOpenDropdowns]);

  // 3) 窗口尺寸变化（resize / 缩放）时，自动收起下拉框
  useEffect(() => {
    let resizeTimer = null;
    const handleResize = () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        dismissOpenDropdowns();
      }, 50);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [dismissOpenDropdowns]);

  // 4) 视图切换（历史流 vs 收藏区）时，自动收起下拉框
  useEffect(() => {
    dismissOpenDropdowns();
  }, [showFavoritesOnly, dismissOpenDropdowns]);

  // 5) 下拉框展开时，外部列表滚动（鼠标滚轮）自动收起下拉框
  useEffect(() => {
    if (!hasOpenDropdown) return;
    const handleWheel = (event) => {
      if (
        searchBoxRef.current?.contains(event.target) ||
        tagWrapperRef.current?.contains(event.target) ||
        typeWrapperRef.current?.contains(event.target)
      ) {
        return;
      }
      dismissOpenDropdowns();
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [hasOpenDropdown, dismissOpenDropdowns]);

  const toggleTagFilter = useCallback(() => {
    toggleDropdown('tag');
  }, [toggleDropdown]);

  const toggleTypeFilter = useCallback(() => {
    toggleDropdown('type');
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

  const applyRecentSearch = useCallback((query) => {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return;
    onApplyRecentSearch?.(normalizedQuery);
    closeRecentSearches();
    window.requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      const cursor = normalizedQuery.length;
      input.setSelectionRange?.(cursor, cursor);
    });
  }, [closeRecentSearches, onApplyRecentSearch]);

  const handleSearchInputChange = useCallback((event) => {
    const nextValue = event.target.value;
    onSearchChange?.(nextValue);
    if (nextValue.trim()) {
      closeRecentSearches();
      return;
    }
    openRecentSearches();
  }, [closeRecentSearches, onSearchChange, openRecentSearches]);

  const handleSearchInputMouseDown = useCallback(() => {
    const input = searchInputRef.current;
    shouldToggleRecentSearchesOnClickRef.current = Boolean(
      input
      && document.activeElement === input
      && canShowRecentSearches
      && showRecentSearches
    );
  }, [canShowRecentSearches, showRecentSearches]);

  const handleSearchInputClick = useCallback(() => {
    if (shouldToggleRecentSearchesOnClickRef.current) {
      closeRecentSearches();
      shouldToggleRecentSearchesOnClickRef.current = false;
      return;
    }
    openRecentSearches();
  }, [closeRecentSearches, openRecentSearches]);

  const handleSearchInputKeyDown = useCallback((event) => {
    if (event.nativeEvent?.isComposing || event.isComposing) return;

    if (canShowRecentSearches) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setShowRecentSearches(true);
        setActiveRecentSearchIndex((current) => {
          if (current < 0) return 0;
          return Math.min(current + 1, normalizedRecentSearches.length - 1);
        });
        return;
      }

      if (event.key === 'ArrowUp' && showRecentSearches) {
        event.preventDefault();
        setActiveRecentSearchIndex((current) => {
          if (current <= 0) return normalizedRecentSearches.length - 1;
          return current - 1;
        });
        return;
      }

      if (event.key === 'Enter' && showRecentSearches && activeRecentSearchIndex >= 0) {
        event.preventDefault();
        applyRecentSearch(normalizedRecentSearches[activeRecentSearchIndex]);
        return;
      }
    }

    if (event.key === 'Escape' && showRecentSearches) {
      event.preventDefault();
      closeRecentSearches();
      return;
    }

    onSearchKeyDown?.(event);
  }, [
    activeRecentSearchIndex,
    applyRecentSearch,
    canShowRecentSearches,
    closeRecentSearches,
    normalizedRecentSearches,
    onSearchKeyDown,
    showRecentSearches,
  ]);

  return (
    <header className="header" onClick={(e) => e.stopPropagation()}>
      {/* 主行：搜索 + 收藏 + 标签筛选 + 类型筛选 + 设置 */}
      <div className="header-row">
        <div className="search-box" ref={searchBoxRef}>
          <input
            id="history-search-input"
            ref={searchInputRef}
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={handleSearchInputChange}
            onMouseDown={handleSearchInputMouseDown}
            onClick={handleSearchInputClick}
            onKeyDown={handleSearchInputKeyDown}
            className="search-input"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {showRecentSearches && canShowRecentSearches && (
            <div className="search-recent-dropdown" role="listbox" aria-label={t('search.recent.title')}>
              <div className="search-recent-header">
                <div className="search-recent-title">
                  <Clock3 size={12} />
                  <span>{t('search.recent.title')}</span>
                </div>
                <button
                  type="button"
                  className="search-recent-clear-btn"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onClearRecentSearches?.();
                    closeRecentSearches();
                  }}
                >
                  {t('search.recent.clearAll')}
                </button>
              </div>
              <div className="search-recent-list">
                {normalizedRecentSearches.map((query, index) => (
                  <div
                    key={query}
                    className={`search-recent-item ${activeRecentSearchIndex === index ? 'active' : ''}`}
                  >
                    <button
                      type="button"
                      className="search-recent-apply-btn"
                      onMouseEnter={() => setActiveRecentSearchIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyRecentSearch(query)}
                    >
                      <Clock3 size={12} />
                      <span className="search-recent-query">{query}</span>
                    </button>
                    <button
                      type="button"
                      className="search-recent-remove-btn"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onRemoveRecentSearch?.(query);
                        if (normalizedRecentSearches.length <= 1) {
                          closeRecentSearches();
                        }
                      }}
                      title={t('search.recent.remove')}
                      aria-label={t('search.recent.remove')}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                dismissOpenDropdowns();
              }}
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
        <PanelSummaryRow className="filter-status">
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

import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Star, Inbox, Tag, ChevronDown, ChevronUp, Settings, Type, Image, File, Link, Braces, Check, Layers, Calendar, PanelRightOpen } from 'lucide-react';

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
  collectionPanelEnabled, onToggleCollectionPanel,
}) {
  const { t } = useTranslation();
  const tagWrapperRef = useRef(null);
  const dateWrapperRef = useRef(null);

  useEffect(() => {
    if (!showTagFilter) return;
    const handleClickOutside = (e) => {
      if (tagWrapperRef.current && !tagWrapperRef.current.contains(e.target)) {
        onToggleTagFilter();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showTagFilter, onToggleTagFilter]);

  useEffect(() => {
    if (!showDateFilter) return;
    const handleClickOutside = (e) => {
      if (dateWrapperRef.current && !dateWrapperRef.current.contains(e.target)) {
        onToggleDateFilter();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDateFilter, onToggleDateFilter]);

  const datePresets = [
    { key: 'today', label: t('toolbar.dateToday'), badge: '1d' },
    { key: 'yesterday', label: t('toolbar.dateYesterday'), badge: '1d' },
    { key: '7d', label: t('toolbar.dateLast7Days'), badge: '7d' },
    { key: '30d', label: t('toolbar.dateLast30Days'), badge: '30d' },
    { key: 'custom', label: t('toolbar.dateCustomRange'), badge: '...' },
  ];

  const dateBadgeText = selectedDateRange
    ? (selectedDateRange.preset === 'custom' ? '...' : datePresets.find(p => p.key === selectedDateRange.preset)?.badge || '')
    : '';

  const typeOptions = [
    { key: 'all', icon: <Layers size={14} /> },
    { key: 'text', icon: <Type size={14} /> },
    { key: 'image', icon: <Image size={14} /> },
    { key: 'file', icon: <File size={14} /> },
    { key: 'link', icon: <Link size={14} /> },
    { key: 'code', icon: <Braces size={14} /> },
  ];

  return (
    <header className="header" onClick={(e) => e.stopPropagation()}>
      {/* 主行：搜索 + 收藏 + 标签筛选 + 类型筛选 + 设置 */}
      <div className="header-row">
        <div className="search-box">
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} className="clear-search">
              <X size={14} />
            </button>
          )}
        </div>

        <button
          onClick={onToggleFavorites}
          className={`header-icon-btn ${showFavoritesOnly ? 'active fav-active' : ''}`}
          title={showFavoritesOnly ? t('toolbar.showAll') : t('toolbar.showFavorites')}
        >
          <Star size={15} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
        </button>

        {isMiniMode && (
          <button
            onClick={onTogglePinned}
            className={`header-icon-btn pin-filter-btn ${showPinnedOnly ? 'active pin-active' : ''}`}
            title={showPinnedOnly ? t('toolbar.showAll') : t('toolbar.showPinned')}
          >
            <Inbox size={15} fill={showPinnedOnly ? 'currentColor' : 'none'} />
          </button>
        )}

        {allTags.length > 0 && (
          <div className="tag-select-wrapper" ref={tagWrapperRef}>
            <button
              onClick={onToggleTagFilter}
              className={`header-icon-btn ${selectedTags.length > 0 ? 'active' : ''}`}
              title={t('toolbar.filterTags')}
            >
              <Tag size={15} />
              {selectedTags.length > 0 && (
                <span className="icon-btn-badge">{selectedTags.length}</span>
              )}
            </button>
            {showTagFilter && (
              <div className="tag-dropdown">
                <div className="tag-dropdown-search">
                  <input
                    type="text"
                    placeholder={t('toolbar.searchTags')}
                    value={tagSearchQuery}
                    onChange={(e) => onTagSearchChange(e.target.value)}
                    className="tag-search-input"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="tag-dropdown-list">
                  {filteredTagsList.length > 0 ? (
                    <>
                      {filteredTagsList.slice(0, 20).map(tag => {
                        const isAITag = tag.startsWith('AI:');
                        const isSourceTag = tag.startsWith('来源:');
                        const isTypeTag = tag.startsWith('类型:');
                        const isUserTag = !isAITag && !isSourceTag && !isTypeTag;
                        const displayTag = isAITag ? tag.substring(3) :
                                          isSourceTag ? tag.substring(3) :
                                          isTypeTag ? tag.substring(3) :
                                          tag;
                        return (
                          <div
                            key={tag}
                            onClick={() => onToggleTag(tag)}
                            className={`tag-dropdown-item ${selectedTags.includes(tag) ? 'selected' : ''}`}
                          >
                            <span className="tag-check">{selectedTags.includes(tag) ? <Check size={14} /> : ''}</span>
                            <span className={`tag-text ${isAITag ? 'ai-tag-text' : ''} ${isUserTag ? 'user-tag-text' : ''} ${isSourceTag ? 'source-tag-text' : ''} ${isTypeTag ? 'type-tag-text' : ''}`}>
                              {isTypeTag && <span className="type-badge">T</span>}
                              {isAITag && <span className="ai-badge">AI</span>}
                              {isUserTag && <span className="user-badge">M</span>}
                              {isSourceTag && <span className="source-badge">S</span>}
                              {displayTag}
                            </span>
                          </div>
                        );
                      })}
                      {filteredTagsList.length > 20 && (
                        <div className="tag-dropdown-more-hint">
                          {t('toolbar.moreTagsHint', { count: filteredTagsList.length - 20 })}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="tag-dropdown-empty">{t('toolbar.noTagsFound')}</div>
                  )}
                </div>
                {selectedTags.length > 0 && (
                  <div className="tag-dropdown-footer">
                    <button onClick={onClearTags} className="clear-selection-btn">
                      {t('toolbar.clearAll')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="date-select-wrapper" ref={dateWrapperRef}>
          <button
            onClick={onToggleDateFilter}
            className={`header-icon-btn ${selectedDateRange ? 'active' : ''}`}
            title={t('toolbar.dateFilter')}
          >
            <Calendar size={15} />
            {selectedDateRange && (
              <span className="icon-btn-badge">{dateBadgeText}</span>
            )}
          </button>
          {showDateFilter && (
            <div className="date-dropdown">
              <div className="date-dropdown-presets">
                {datePresets.map(({ key, label }) => (
                  <div
                    key={key}
                    onClick={() => onSelectDatePreset(key)}
                    className={`date-dropdown-item ${selectedDateRange?.preset === key ? 'selected' : ''}`}
                  >
                    <span className="date-check">
                      {selectedDateRange?.preset === key ? <Check size={14} /> : ''}
                    </span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              {selectedDateRange?.preset === 'custom' && (
                <div className="date-dropdown-custom">
                  <div className="date-input-row">
                    <label>{t('toolbar.dateStart')}</label>
                    <input
                      type="text"
                      placeholder="YYYY-MM-DD"
                      value={customDateStart}
                      onChange={(e) => onCustomDateStartChange(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="date-input-row">
                    <label>{t('toolbar.dateEnd')}</label>
                    <input
                      type="text"
                      placeholder="YYYY-MM-DD"
                      value={customDateEnd}
                      onChange={(e) => onCustomDateEndChange(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <button
                    className="date-apply-btn"
                    disabled={!customDateStart && !customDateEnd}
                    onClick={onApplyCustomDateRange}
                  >
                    {t('toolbar.dateApply')}
                  </button>
                </div>
              )}
              {selectedDateRange && (
                <div className="date-dropdown-footer">
                  <button onClick={onClearDateFilter} className="clear-selection-btn">
                    {t('toolbar.clearDateFilter')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="type-filter-group">
          {typeOptions.map(({ key, icon }) => (
            <button
              key={key}
              onClick={() => onTypeChange(key)}
              className={`type-filter-btn ${selectedType === key ? 'active' : ''}`}
              title={t(`search.typeFilter.${key}`)}
            >
              {icon}
            </button>
          ))}
        </div>

        <button onClick={onOpenSettings} className="header-icon-btn settings-btn" title={t('settings.title')}>
          <Settings size={15} />
        </button>

        {!collectionPanelEnabled && !isMiniMode && (
          <button
            onClick={onToggleCollectionPanel}
            className="header-icon-btn"
            title={t('collection.showPanel')}
          >
            <PanelRightOpen size={15} />
          </button>
        )}
      </div>

      {/* 筛选状态提示（仅在有标签筛选时显示） */}
      {selectedTags.length > 0 && (
        <div className="filter-status">
          <span className="filter-status-text">
            {t('toolbar.filteringBy', { count: selectedTags.length })}
          </span>
          <button onClick={onClearTags} className="clear-filter-btn" title={t('toolbar.clearAll')}>
            <X size={12} /> {t('toolbar.clearFilter')}
          </button>
        </div>
      )}

      {selectedDateRange && (
        <div className="filter-status">
          <span className="filter-status-text">
            {t('toolbar.dateFilterActive')}
          </span>
          <button onClick={onClearDateFilter} className="clear-filter-btn" title={t('toolbar.clearDateFilter')}>
            <X size={12} /> {t('toolbar.clearDateFilter')}
          </button>
        </div>
      )}
    </header>
  );
}

export default SearchBar;

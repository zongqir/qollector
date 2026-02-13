import { useTranslation } from 'react-i18next';

function SearchBar({
  searchQuery, onSearchChange,
  selectedType, onTypeChange,
  showFavoritesOnly, onToggleFavorites,
  selectedTags, onClearTags,
  showTagFilter, onToggleTagFilter,
  allTags, filteredTagsList,
  tagSearchQuery, onTagSearchChange,
  onToggleTag,
  onOpenSettings,
}) {
  const { t } = useTranslation();

  return (
    <header className="header">
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
            ✕
          </button>
        )}
      </div>

      {selectedTags.length > 0 && (
        <div className="filter-status">
          <span className="filter-status-text">
            {t('toolbar.filteringBy', { count: selectedTags.length })}
          </span>
          <button
            onClick={onClearTags}
            className="clear-filter-btn"
            title={t('toolbar.clearAll')}
          >
            ✕ {t('toolbar.clearFilter')}
          </button>
        </div>
      )}

      <div className="type-filter-group">
        {['all', 'text', 'image', 'file', 'link'].map(type => {
          const icons = { all: '', text: '📝 ', image: '🖼️ ', file: '📁 ', link: '🔗 ' };
          return (
            <button
              key={type}
              onClick={() => onTypeChange(type)}
              className={`type-filter-btn ${selectedType === type ? 'active' : ''}`}
            >
              {icons[type]}{t(`search.typeFilter.${type}`)}
            </button>
          );
        })}
      </div>

      <button
        onClick={onToggleFavorites}
        className={`favorites-filter-btn ${showFavoritesOnly ? 'active' : ''}`}
        title={showFavoritesOnly ? t('toolbar.showAll') : t('toolbar.showFavorites')}
      >
        ⭐
      </button>

      {allTags.length > 0 && (
        <div className="tag-select-wrapper">
          <button
            onClick={onToggleTagFilter}
            className={`tag-select-btn ${selectedTags.length > 0 ? 'has-selection' : ''}`}
          >
            <span className="tag-icon">🏷️</span>
            <span className="tag-label">
              {selectedTags.length > 0 ? t('toolbar.selectedTags', { count: selectedTags.length }) : t('toolbar.filterTags')}
            </span>
            <span className="dropdown-arrow">{showTagFilter ? '▲' : '▼'}</span>
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
                  filteredTagsList.map(tag => {
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
                        <span className="tag-check">{selectedTags.includes(tag) ? '✓' : ''}</span>
                        <span className={`tag-text ${isAITag ? 'ai-tag-text' : ''} ${isUserTag ? 'user-tag-text' : ''} ${isSourceTag ? 'source-tag-text' : ''} ${isTypeTag ? 'type-tag-text' : ''}`}>
                          {isTypeTag && <span className="type-badge">T</span>}
                          {isAITag && <span className="ai-badge">AI</span>}
                          {isUserTag && <span className="user-badge">M</span>}
                          {isSourceTag && <span className="source-badge">S</span>}
                          {displayTag}
                        </span>
                      </div>
                    );
                  })
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
      <button onClick={onOpenSettings} className="settings-btn">
        ⚙️
      </button>
    </header>
  );
}

export default SearchBar;

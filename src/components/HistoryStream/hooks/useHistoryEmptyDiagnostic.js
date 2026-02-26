import { useCallback, useMemo } from 'react';

export default function useHistoryEmptyDiagnostic({
  searchTermsLength,
  backendSearchResults,
  itemsLength,
  selectedType,
  selectedTags,
  showFavoritesOnly,
  showPinnedOnly,
  selectedDateRange,
  t,
  setSearchQuery,
  setSelectedType,
  setSelectedTags,
  setShowFavoritesOnly,
  setShowPinnedOnly,
  setShowTagFilter,
  setTagSearchQuery,
  clearDateFilter,
  clearActiveFilterView,
}) {
  const hasStructuredFilters = Boolean(
    selectedTags.length > 0
    || selectedType !== 'all'
    || showFavoritesOnly
    || showPinnedOnly
    || selectedDateRange,
  );

  const activeFilterDescriptions = useMemo(() => {
    const descriptions = [];
    if (selectedType !== 'all') {
      descriptions.push(t('search.empty.filterType', { type: t(`search.typeFilter.${selectedType}`) }));
    }
    if (selectedTags.length > 0) {
      descriptions.push(t('search.empty.filterTags', { count: selectedTags.length }));
    }
    if (showFavoritesOnly) {
      descriptions.push(t('search.empty.filterFavorites'));
    }
    if (showPinnedOnly) {
      descriptions.push(t('search.empty.filterPinned'));
    }
    if (selectedDateRange) {
      const datePresetLabelMap = {
        today: t('toolbar.dateToday'),
        yesterday: t('toolbar.dateYesterday'),
        '7d': t('toolbar.dateLast7Days'),
        '30d': t('toolbar.dateLast30Days'),
      };
      descriptions.push(t('search.empty.filterDate', {
        range: selectedDateRange.preset === 'custom'
          ? t('toolbar.dateCustomRange')
          : (datePresetLabelMap[selectedDateRange.preset] || t('toolbar.dateCustomRange')),
      }));
    }
    return descriptions;
  }, [
    selectedType,
    selectedTags.length,
    showFavoritesOnly,
    showPinnedOnly,
    selectedDateRange,
    t,
  ]);

  const handleResetAllFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedType('all');
    setSelectedTags([]);
    setShowFavoritesOnly(false);
    setShowPinnedOnly(false);
    setShowTagFilter(false);
    setTagSearchQuery('');
    clearDateFilter();
    clearActiveFilterView();
  }, [
    setSearchQuery,
    setSelectedType,
    setSelectedTags,
    setShowFavoritesOnly,
    setShowPinnedOnly,
    setShowTagFilter,
    setTagSearchQuery,
    clearDateFilter,
    clearActiveFilterView,
  ]);

  const emptyDiagnostic = useMemo(() => {
    const hasSearchText = searchTermsLength > 0;
    const activeFiltersText = activeFilterDescriptions.join(' · ');
    const isFirstUse = itemsLength === 0 && !hasSearchText && !hasStructuredFilters;

    if (isFirstUse) {
      return {
        mode: 'first-use',
        title: t('search.empty.firstUseTitle'),
        description: t('search.empty.firstUseDescription'),
        canReset: false,
      };
    }

    if (hasSearchText && Array.isArray(backendSearchResults) && backendSearchResults.length === 0) {
      return {
        mode: 'search-empty',
        title: t('search.empty.noSearchResults'),
        description: hasStructuredFilters && activeFiltersText
          ? t('search.empty.activeFilters', { filters: activeFiltersText })
          : t('search.empty.tryOtherKeywords'),
        canReset: hasStructuredFilters,
      };
    }

    if (hasSearchText && hasStructuredFilters) {
      return {
        mode: 'filtered-after-search',
        title: t('search.empty.filteredAfterSearch'),
        description: activeFiltersText
          ? t('search.empty.activeFilters', { filters: activeFiltersText })
          : t('search.empty.tryOtherKeywords'),
        canReset: true,
      };
    }

    if (hasStructuredFilters) {
      return {
        mode: 'filtered',
        title: t('search.empty.filteredNoMatch'),
        description: activeFiltersText
          ? t('search.empty.activeFilters', { filters: activeFiltersText })
          : '',
        canReset: true,
      };
    }

    return {
      mode: 'default',
      title: t('app.noItems'),
      description: '',
      canReset: false,
    };
  }, [
    searchTermsLength,
    backendSearchResults,
    hasStructuredFilters,
    activeFilterDescriptions,
    t,
    itemsLength,
  ]);

  return {
    emptyDiagnostic,
    handleResetAllFilters,
  };
}

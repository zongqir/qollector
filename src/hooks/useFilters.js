import { useState, useEffect } from 'react';

export function useFilters() {
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedType, setSelectedType] = useState('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');

  // 点击外部关闭标签面板
  useEffect(() => {
    if (!showTagFilter) return;

    const handleClickOutside = (e) => {
      if (!e.target.closest('.tag-select-wrapper')) {
        setShowTagFilter(false);
      }
    };
    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showTagFilter]);

  const toggleTagFilter = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const handleTagClick = (tag, e) => {
    e.stopPropagation();
    const isSelected = selectedTags.includes(tag);
    if (isSelected) {
      setSelectedTags(prev => prev.filter(t => t !== tag));
    } else {
      setSelectedTags(prev => [...prev, tag]);
    }
  };

  return {
    selectedTags,
    setSelectedTags,
    selectedType,
    setSelectedType,
    showFavoritesOnly,
    setShowFavoritesOnly,
    showTagFilter,
    setShowTagFilter,
    tagSearchQuery,
    setTagSearchQuery,
    toggleTagFilter,
    handleTagClick,
  };
}

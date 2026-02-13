import { useState, useEffect } from 'react';

export function useVirtualScroll(contentRef, totalItems) {
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 20 });

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const handleScroll = () => {
      const scrollTop = contentElement.scrollTop;
      const itemHeight = 150;
      const visibleCount = Math.ceil(contentElement.clientHeight / itemHeight);
      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 5);
      const end = Math.min(totalItems, start + visibleCount + 10);

      setVisibleRange({ start, end });
    };

    contentElement.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => {
      contentElement.removeEventListener('scroll', handleScroll);
    };
  }, [totalItems]);

  return visibleRange;
}

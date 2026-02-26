import { useEffect } from 'react';

function useClickOutsideDismiss({
  isOpen,
  wrapperRef,
  onDismiss,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      const wrapper = wrapperRef?.current;
      if (!wrapper) return;
      if (wrapper.contains(event.target)) return;
      onDismiss?.(event);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, wrapperRef, onDismiss]);
}

export default useClickOutsideDismiss;

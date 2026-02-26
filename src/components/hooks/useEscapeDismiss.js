import { useEffect } from 'react';

function useEscapeDismiss(enabled, onDismiss) {
  useEffect(() => {
    if (!enabled || typeof onDismiss !== 'function') return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      onDismiss(event);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onDismiss]);
}

export default useEscapeDismiss;

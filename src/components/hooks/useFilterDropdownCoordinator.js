import { useCallback, useMemo } from 'react';

function useFilterDropdownCoordinator(dropdowns) {
  const normalizedDropdowns = dropdowns || {};

  const closeOthers = useCallback((activeKey) => {
    Object.entries(normalizedDropdowns).forEach(([key, dropdown]) => {
      if (key === activeKey || !dropdown?.isOpen) return;
      dropdown.close?.();
    });
  }, [normalizedDropdowns]);

  const toggleDropdown = useCallback((key) => {
    const target = normalizedDropdowns[key];
    if (!target) return false;

    if (target.isOpen) {
      target.close?.();
      return false;
    }

    closeOthers(key);
    target.open?.();
    return true;
  }, [normalizedDropdowns, closeOthers]);

  const dismissOpenDropdowns = useCallback((event) => {
    let dismissed = false;
    Object.values(normalizedDropdowns).forEach((dropdown) => {
      if (!dropdown?.isOpen) return;
      dropdown.close?.();
      dismissed = true;
    });

    if (dismissed && event) {
      event.preventDefault();
      event.stopPropagation();
    }
    return dismissed;
  }, [normalizedDropdowns]);

  const hasOpenDropdown = useMemo(
    () => Object.values(normalizedDropdowns).some(dropdown => Boolean(dropdown?.isOpen)),
    [normalizedDropdowns],
  );

  return {
    hasOpenDropdown,
    toggleDropdown,
    dismissOpenDropdowns,
  };
}

export default useFilterDropdownCoordinator;

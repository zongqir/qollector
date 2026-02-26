import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

const findNextEnabledIndex = (options, startIndex, direction) => {
  if (!Array.isArray(options) || options.length === 0) return -1;
  let index = startIndex;
  for (let i = 0; i < options.length; i += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
};

const FilterListbox = forwardRef(function FilterListbox({
  id,
  className = '',
  options,
  selectedKey,
  selectedKeys,
  isOptionSelected,
  multiselect = false,
  onSelect,
  onActiveOptionChange,
  onUnhandledKeyDown,
  renderOption,
  autoFocus = false,
}, ref) {
  const listRef = useRef(null);
  const normalizedOptions = Array.isArray(options) ? options : [];
  const isSelectedOption = (option) => {
    if (!option) return false;
    if (typeof isOptionSelected === 'function') {
      return Boolean(isOptionSelected(option));
    }
    if (Array.isArray(selectedKeys)) {
      return selectedKeys.includes(option.key);
    }
    return option.key === selectedKey;
  };

  const defaultActiveIndex = useMemo(() => {
    const selectedIndex = normalizedOptions.findIndex(
      option => isSelectedOption(option) && !option.disabled,
    );
    if (selectedIndex >= 0) return selectedIndex;
    return normalizedOptions.findIndex(option => !option.disabled);
  }, [normalizedOptions, selectedKey, selectedKeys, isOptionSelected]);

  const [activeIndex, setActiveIndex] = useState(defaultActiveIndex);

  useEffect(() => {
    setActiveIndex(defaultActiveIndex);
  }, [defaultActiveIndex, id]);

  useEffect(() => {
    if (!autoFocus) return;
    listRef.current?.focus();
  }, [autoFocus, id]);

  useEffect(() => {
    if (typeof onActiveOptionChange !== 'function') return;
    const activeOption = activeIndex >= 0 ? normalizedOptions[activeIndex] : null;
    onActiveOptionChange(activeOption || null);
  }, [activeIndex, normalizedOptions, onActiveOptionChange]);

  const getFirstEnabledIndex = useCallback(
    () => normalizedOptions.findIndex(option => !option.disabled),
    [normalizedOptions],
  );

  const getLastEnabledIndex = useCallback(
    () => {
      const lastFromEnd = [...normalizedOptions].reverse().findIndex(option => !option.disabled);
      if (lastFromEnd < 0) return -1;
      return normalizedOptions.length - 1 - lastFromEnd;
    },
    [normalizedOptions],
  );

  const focusFirstEnabledOption = useCallback(() => {
    const first = getFirstEnabledIndex();
    if (first >= 0) {
      setActiveIndex(first);
      listRef.current?.focus();
    }
  }, [getFirstEnabledIndex]);

  const focusLastEnabledOption = useCallback(() => {
    const last = getLastEnabledIndex();
    if (last >= 0) {
      setActiveIndex(last);
      listRef.current?.focus();
    }
  }, [getLastEnabledIndex]);

  useImperativeHandle(ref, () => ({
    focus: () => listRef.current?.focus(),
    focusFirst: focusFirstEnabledOption,
    focusLast: focusLastEnabledOption,
  }), [focusFirstEnabledOption, focusLastEnabledOption]);

  const handleSelect = (option) => {
    if (!option || option.disabled) return;
    onSelect?.(option.key);
  };

  const handleKeyDown = (event) => {
    if (normalizedOptions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = findNextEnabledIndex(normalizedOptions, activeIndex, 1);
      if (next >= 0) setActiveIndex(next);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = findNextEnabledIndex(normalizedOptions, activeIndex, -1);
      if (next >= 0) setActiveIndex(next);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      const first = getFirstEnabledIndex();
      if (first >= 0) setActiveIndex(first);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const last = getLastEnabledIndex();
      if (last >= 0) setActiveIndex(last);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect(normalizedOptions[activeIndex]);
      return;
    }

    onUnhandledKeyDown?.(event, normalizedOptions[activeIndex] || null);
  };

  return (
    <div
      id={id}
      ref={listRef}
      role="listbox"
      tabIndex={0}
      className={className}
      aria-multiselectable={multiselect ? 'true' : undefined}
      aria-activedescendant={
        activeIndex >= 0 && normalizedOptions[activeIndex]
          ? `${id}-option-${normalizedOptions[activeIndex].key}`
          : undefined
      }
      onKeyDown={handleKeyDown}
    >
      {normalizedOptions.map((option, index) => {
        const isSelected = isSelectedOption(option);
        const isActive = index === activeIndex;
        return (
          <div
            key={option.key}
            id={`${id}-option-${option.key}`}
            role="option"
            aria-selected={isSelected}
            aria-disabled={option.disabled ? 'true' : undefined}
            className={renderOption
              ? undefined
              : `filter-listbox-option ${isSelected ? 'selected' : ''} ${isActive ? 'keyboard-active' : ''}`.trim()}
            onMouseEnter={() => {
              if (!option.disabled) setActiveIndex(index);
            }}
            onClick={() => handleSelect(option)}
          >
            {renderOption
              ? renderOption({ option, isSelected, isActive })
              : option.label}
          </div>
        );
      })}
      </div>
    );
});

FilterListbox.displayName = 'FilterListbox';

export default FilterListbox;

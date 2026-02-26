function FilterTriggerButton({
  label,
  title,
  isOpen,
  isActive = false,
  popup = 'dialog',
  controlsId,
  pressed,
  className = '',
  onToggle,
  onOpen,
  onClose,
  children,
}) {
  const handleKeyDown = (event) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !isOpen) {
      event.preventDefault();
      if (typeof onOpen === 'function') {
        onOpen(event);
      } else if (typeof onToggle === 'function') {
        onToggle(event);
      }
      return;
    }

    if (event.key === 'Escape' && isOpen && typeof onClose === 'function') {
      event.preventDefault();
      event.stopPropagation();
      onClose(event);
    }
  };

  const activeClass = isOpen || isActive ? 'active' : '';
  const mergedClassName = `header-icon-btn filter-trigger-btn ${className} ${activeClass}`.trim();

  return (
    <button
      type="button"
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      className={mergedClassName}
      title={title || label}
      aria-label={label}
      aria-expanded={isOpen}
      aria-haspopup={popup}
      aria-controls={controlsId}
      {...(typeof pressed === 'boolean' ? { 'aria-pressed': pressed } : {})}
    >
      {children}
    </button>
  );
}

export default FilterTriggerButton;

function FilterDropdown({
  id,
  className = '',
  role = 'dialog',
  onClose,
  children,
}) {
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && typeof onClose === 'function') {
      event.preventDefault();
      event.stopPropagation();
      onClose(event);
    }
  };

  return (
    <div
      id={id}
      role={role}
      className={className}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}

export default FilterDropdown;

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import WorkbenchCard from './WorkbenchCard';

function SortableWorkbenchCard({
  item,
  isCopied,
  isMultiSelected,
  isSortMode,
  isSortAnchor,
  isSelectionMode,
  sortableDisabled,
  onUnpin,
  onSetCardRef,
  onCardPointerDown,
  onCardPointerMove,
  onCardPointerUp,
  onCardPointerCancel,
  onCardPointerLeave,
  onPointerDownCapture,
  onClick,
  onDoubleClick,
  onContextMenu,
  onOpenItem,
  onSetCardBackground,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: sortableDisabled ?? isSelectionMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : 'auto',
  };
  const sortableAttributes = { ...(attributes || {}) };
  delete sortableAttributes.role;
  delete sortableAttributes.tabIndex;
  const dragListeners = (sortableDisabled ?? isSelectionMode) ? undefined : listeners;

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        onSetCardRef?.(node);
      }}
      style={{ ...style, touchAction: isSortMode ? 'none' : 'auto' }}
      onPointerDown={onCardPointerDown}
      onPointerMove={onCardPointerMove}
      onPointerUp={onCardPointerUp}
      onPointerCancel={onCardPointerCancel}
      onPointerLeave={onCardPointerLeave}
      {...sortableAttributes}
      {...dragListeners}
    >
      <WorkbenchCard
        item={item}
        isCopied={isCopied}
        isMultiSelected={isMultiSelected}
        isSortMode={isSortMode}
        isSortAnchor={isSortAnchor}
        onUnpin={onUnpin}
        onPointerDownCapture={onPointerDownCapture}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onOpenItem={onOpenItem}
        onSetCardBackground={onSetCardBackground}
      />
    </div>
  );
}

export default SortableWorkbenchCard;

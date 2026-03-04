import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import WorkbenchCard from './WorkbenchCard';

function SortableWorkbenchCard({
  item,
  isCopied,
  isMultiSelected,
  isSelectionMode,
  onUnpin,
  onPointerDownCapture,
  onClick,
  onDoubleClick,
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
  } = useSortable({ id: item.id, disabled: isSelectionMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={{ ...style, touchAction: 'none' }} {...attributes} {...listeners}>
      <WorkbenchCard
        item={item}
        isCopied={isCopied}
        isMultiSelected={isMultiSelected}
        onUnpin={onUnpin}
        onPointerDownCapture={onPointerDownCapture}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onOpenItem={onOpenItem}
        onSetCardBackground={onSetCardBackground}
      />
    </div>
  );
}

export default SortableWorkbenchCard;

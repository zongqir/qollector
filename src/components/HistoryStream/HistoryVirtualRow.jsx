import { memo } from 'react';
import CompactCard from './CompactCard';
import InlinePreviewPanel from './InlinePreviewPanel';

function HistoryVirtualRow({
  item,
  index,
  searchExplain,
  isSelected,
  isMultiSelected,
  isSelectionMode,
  isFocused,
  isExpandedPreview,
  shouldUseHoverPreview,
  rowGap,
  copiedItemId,
  copyFeedbackSource,
  timeTick,
  onCardClick,
  onCardDoubleClick,
  onCardContextMenu,
  onDragStart,
  onStartExternalDrag,
  onTogglePin,
  onToggleFavorite,
  onOpenItem,
  onRevealInFolder,
  onSetCardBackground,
  onTagClick,
  onToggleMultiSelect,
  supportsNativeExternalDrag,
  onCloseInlinePreview,
}) {
  const cardSelected = isSelected || isExpandedPreview;

  return (
    <div
      className="history-stream-row"
      data-item-id={item.id}
      style={{ paddingBottom: `${rowGap}px` }}
      onMouseDownCapture={(e) => {
        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
        e.stopPropagation();
        e.preventDefault();
        onCardClick(item, index, e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          return;
        }
        onCardClick(item, index, e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCardContextMenu?.(item, index, e);
      }}
      onDoubleClick={(e) => onCardDoubleClick(item, e)}
    >
      <CompactCard
        item={item}
        isSelected={cardSelected}
        isMultiSelected={isMultiSelected}
        isSelectionMode={isSelectionMode}
        isFocused={isFocused}
        isExpandedPreview={isExpandedPreview}
        isCopied={copiedItemId === item.id && copyFeedbackSource === 'history'}
        timeTick={timeTick}
        searchExplain={searchExplain}
        onDragStart={onDragStart}
        supportsNativeExternalDrag={supportsNativeExternalDrag}
        onStartExternalDrag={onStartExternalDrag}
        onTogglePin={onTogglePin}
        onToggleFavorite={onToggleFavorite}
        onOpenItem={onOpenItem}
        onRevealInFolder={onRevealInFolder}
        onSetCardBackground={onSetCardBackground}
        onTagClick={onTagClick}
        onToggleMultiSelect={() => onToggleMultiSelect?.(item, index)}
      />
      {shouldUseHoverPreview && isExpandedPreview && (
        <InlinePreviewPanel item={item} onRequestClose={() => onCloseInlinePreview?.(item.id)} />
      )}
    </div>
  );
}

export default memo(HistoryVirtualRow);

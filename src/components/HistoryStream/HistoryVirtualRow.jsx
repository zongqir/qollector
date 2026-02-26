import { memo } from 'react';
import CompactCard from './CompactCard';

function HistoryVirtualRow({
  item,
  index,
  groupKey,
  showGroupHeader,
  groupCount,
  searchExplain,
  isSelected,
  isMultiSelected,
  isFocused,
  rowGap,
  t,
  copiedItemId,
  copyFeedbackSource,
  timeTick,
  onCardClick,
  onCardDoubleClick,
  onDragStart,
  onStartExternalDrag,
  onTogglePin,
  onToggleFavorite,
  onOpenItem,
  onRevealInFolder,
  onSetCardBackground,
  onTagClick,
  supportsNativeExternalDrag,
}) {
  return (
    <div
      className={`history-stream-row ${showGroupHeader ? 'group-start' : ''}`}
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
        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={(e) => onCardDoubleClick(item, e)}
    >
      {showGroupHeader && (
        <div className="history-group-header" data-group={groupKey}>
          <span className="history-group-title">{t(`history.groups.${groupKey}`)}</span>
          <span className="history-group-count">{groupCount}</span>
        </div>
      )}
      <CompactCard
        item={item}
        isSelected={isSelected}
        isMultiSelected={isMultiSelected}
        isFocused={isFocused}
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
      />
    </div>
  );
}

export default memo(HistoryVirtualRow);

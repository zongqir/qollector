import { useTranslation } from 'react-i18next';
import { formatDate, getTimelineColor } from '../../utils/formatters';
import { getSourceApp } from '../../utils/tagHelpers';
import ItemTags from './ItemTags';
import NoteDisplay from './NoteDisplay';
import ItemToolbar from './ItemToolbar';
import ItemContent from './ItemContent';

function ItemCard({
  item, expandedItemId, copiedItemId, selectedTags,
  // tag management
  addingTagItemId, newTagInput, onNewTagInputChange,
  onTagInputKeyDown, onStartAddTag, onCancelAddTag,
  onAddTagToItem, filteredUserTags, onTagClick,
  // note management
  editingNoteId, editNote, onEditNoteChange,
  onStartEditNote, onSaveNote, onCancelNoteEdit,
  // toolbar actions
  onDragStart, onTogglePin, onToggleFavorite,
  onGenerateAITags, generatingAI, aiEnabled,
  onHandleOCR, ocrProcessing, ocrEnabled,
  onToggleExpand,
  // content actions
  onContentClick, onContentDoubleClick,
  language,
  maxPinnedItems,
}) {
  const { t } = useTranslation();
  const isExpanded = expandedItemId === item.id;
  const isCopied = copiedItemId === item.id;
  const timelineColor = getTimelineColor(item.created_at);

  return (
    <div
      className="item-card"
      style={{ '--timeline-color': timelineColor }}
      title={`${formatDate(item.created_at, language)} · ${getSourceApp(item.metadata)}`}
    >
      <ItemToolbar
        item={item}
        onDragStart={onDragStart}
        onTogglePin={onTogglePin}
        onToggleFavorite={onToggleFavorite}
        onGenerateAITags={onGenerateAITags}
        generatingAI={generatingAI}
        aiEnabled={aiEnabled}
        onHandleOCR={onHandleOCR}
        ocrProcessing={ocrProcessing}
        ocrEnabled={ocrEnabled}
        onStartEditNote={onStartEditNote}
        onToggleExpand={onToggleExpand}
        isExpanded={isExpanded}
        maxPinnedItems={maxPinnedItems}
      />
      <ItemContent
        item={item}
        isExpanded={isExpanded}
        isCopied={isCopied}
        onClick={(e) => onContentClick(item, e)}
        onDoubleClick={(e) => onContentDoubleClick(item, e, item.type_ === 'image')}
      />
      <div className="item-footer">
        <NoteDisplay
          item={item}
          editingNoteId={editingNoteId}
          editNote={editNote}
          onEditNoteChange={onEditNoteChange}
          onStartEditNote={onStartEditNote}
          onSaveNote={onSaveNote}
          onCancelNoteEdit={onCancelNoteEdit}
        />
        <ItemTags
          item={item}
          selectedTags={selectedTags}
          onTagClick={onTagClick}
          addingTagItemId={addingTagItemId}
          newTagInput={newTagInput}
          onNewTagInputChange={onNewTagInputChange}
          onTagInputKeyDown={onTagInputKeyDown}
          onStartAddTag={onStartAddTag}
          onCancelAddTag={onCancelAddTag}
          onAddTagToItem={onAddTagToItem}
          filteredUserTags={filteredUserTags}
        />
      </div>
    </div>
  );
}

export default ItemCard;

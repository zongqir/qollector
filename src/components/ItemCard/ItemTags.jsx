import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Tag } from 'lucide-react';
import { getTags, getSourceApp, getSourceDisplay } from '../../utils/tagHelpers';

function ItemTags({
  item, selectedTags, onTagClick,
  addingTagItemId, newTagInput, onNewTagInputChange,
  onTagInputKeyDown, onStartAddTag, onCancelAddTag,
  onAddTagToItem, filteredUserTags, hideTypeTag,
  singleRow = false,
}) {
  const { t } = useTranslation();
  const typeMap = {
    text: '类型:文本',
    image: '类型:图片',
    file: '类型:文件',
    link: '类型:链接',
  };

  const allTags = getTags(item.tags);
  const userTags = allTags.filter(tag => !tag.startsWith('AI:'));
  const aiTags = allTags.filter(tag => tag.startsWith('AI:'));
  const visibleAiTags = singleRow ? aiTags : aiTags.slice(0, 3);
  const sourceApp = getSourceApp(item.metadata);
  const sourceTag = sourceApp !== 'Unknown' ? `来源:${sourceApp}` : null;
  const sourceDisplay = sourceTag ? getSourceDisplay(item.metadata) : '';
  const isAdding = addingTagItemId === item.id;

  const tagNodes = [];

  if (!hideTypeTag && item.type_) {
    const typeTag = typeMap[item.type_];
    const displayName = t(`search.typeFilter.${item.type_}`);
    tagNodes.push(
      <span
        key={`type-${item.type_}`}
        className={`tag type-tag ${selectedTags.includes(typeTag) ? 'selected' : ''}`}
        onClick={(e) => onTagClick(typeTag, e)}
        title={t('item.clickToFilterType')}
      >
        {displayName}
      </span>,
    );
  }

  userTags.forEach((tag, idx) => {
    tagNodes.push(
      <span
        key={`user-${idx}-${tag}`}
        className={`tag user-tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
        onClick={(e) => onTagClick(tag, e)}
        title={t('item.clickToFilter')}
      >
        {tag}
      </span>,
    );
  });

  if (sourceTag) {
    tagNodes.push(
      <span
        key={`source-${sourceApp}`}
        className={`tag source-tag ${selectedTags.includes(sourceTag) ? 'selected' : ''}`}
        onClick={(e) => onTagClick(sourceTag, e)}
        title={sourceDisplay || sourceApp}
      >
        {sourceApp}
      </span>,
    );
  }

  visibleAiTags.forEach((tag, idx) => {
    const displayTag = tag.substring(3);
    tagNodes.push(
      <span
        key={`ai-${idx}-${displayTag}`}
        className={`tag ai-tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
        onClick={(e) => onTagClick(tag, e)}
        title={t('item.clickToFilterAI')}
      >
        {displayTag}
      </span>,
    );
  });

  const addControl = isAdding ? (
    <div className="add-tag-input-wrapper">
      <input
        type="text"
        value={newTagInput}
        onChange={(e) => onNewTagInputChange(e.target.value)}
        onKeyDown={(e) => onTagInputKeyDown(item, e)}
        placeholder={t('edit.enterTag')}
        className="add-tag-input"
        autoFocus
        onBlur={(e) => {
          if (!e.relatedTarget || !e.relatedTarget.closest('.add-tag-input-wrapper')) {
            setTimeout(() => onCancelAddTag(), 150);
          }
        }}
      />
      <button
        onClick={() => {
          if (newTagInput.trim()) {
            onAddTagToItem(item, newTagInput.trim());
          }
        }}
        className="tag-btn-confirm"
        title={t('item.confirmTag')}
        disabled={!newTagInput.trim()}
      >
        <Check size={10} />
      </button>
      <button
        onClick={onCancelAddTag}
        className="tag-btn-cancel"
        title={t('item.cancelTag')}
      >
        <X size={10} />
      </button>
      {filteredUserTags.length > 0 && (
        <div className="tag-suggestions">
          {filteredUserTags.slice(0, 8).map((tag, idx) => (
            <div
              key={idx}
              className="tag-suggestion-item"
              onClick={() => onAddTagToItem(item, tag)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Tag size={12} className="tag-suggestion-icon" />
              {tag}
            </div>
          ))}
        </div>
      )}
    </div>
  ) : (
    <button
      className="add-tag-btn"
      onClick={(e) => onStartAddTag(item, e)}
      title={t('item.addTag')}
    >
      +
    </button>
  );

  if (singleRow) {
    return (
      <div className="item-tags item-tags-single-row">
        <div className="item-tags-line">
          {tagNodes}
        </div>
        <div className="item-tags-actions">
          {addControl}
        </div>
      </div>
    );
  }

  return (
    <div className="item-tags">
      {tagNodes}
      {addControl}
    </div>
  );
}

export default memo(ItemTags);

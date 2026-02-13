import { useTranslation } from 'react-i18next';
import { getTags, getSourceApp } from '../../utils/tagHelpers';

function ItemTags({
  item, selectedTags, onTagClick,
  addingTagItemId, newTagInput, onNewTagInputChange,
  onTagInputKeyDown, onStartAddTag, onCancelAddTag,
  onAddTagToItem, filteredUserTags,
}) {
  const { t } = useTranslation();
  const typeMap = {
    'text': '类型:文本',
    'image': '类型:图片',
    'file': '类型:文件',
    'link': '类型:链接'
  };

  return (
    <div className="item-tags">
      {item.type_ && (() => {
        const typeTag = typeMap[item.type_];
        const displayName = t(`search.typeFilter.${item.type_}`);
        return (
          <span
            className={`tag type-tag ${selectedTags.includes(typeTag) ? 'selected' : ''}`}
            onClick={(e) => onTagClick(typeTag, e)}
            title={t('item.clickToFilterType')}
          >
            {displayName}
          </span>
        );
      })()}
      {getTags(item.tags).filter(tag => !tag.startsWith('AI:')).map((tag, idx) => (
        <span
          key={`user-${idx}`}
          className={`tag user-tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
          onClick={(e) => onTagClick(tag, e)}
          title={t('item.clickToFilter')}
        >
          {tag}
        </span>
      ))}
      {getSourceApp(item.metadata) !== 'Unknown' && (() => {
        const sourceTag = `来源:${getSourceApp(item.metadata)}`;
        return (
          <span
            className={`tag source-tag ${selectedTags.includes(sourceTag) ? 'selected' : ''}`}
            onClick={(e) => onTagClick(sourceTag, e)}
            title={t('item.clickToFilterSource')}
          >
            {getSourceApp(item.metadata)}
          </span>
        );
      })()}
      {getTags(item.tags).filter(tag => tag.startsWith('AI:')).map((tag, idx) => {
        const displayTag = tag.substring(3);
        return (
          <span
            key={`ai-${idx}`}
            className={`tag ai-tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
            onClick={(e) => onTagClick(tag, e)}
            title={t('item.clickToFilterAI')}
          >
            {displayTag}
          </span>
        );
      })}
      {addingTagItemId === item.id ? (
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
              // 如果点击的是建议项或按钮，不要关闭
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
            ✓
          </button>
          <button
            onClick={onCancelAddTag}
            className="tag-btn-cancel"
            title={t('item.cancelTag')}
          >
            ✕
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
      )}
    </div>
  );
}

export default ItemTags;

import { useTranslation } from 'react-i18next';
import { Bot, Check, Copy, Inbox, Star, Tag, Wand2, X } from 'lucide-react';

function WorkbenchMultiSelectBar({
  selectedCount,
  showBatchTagEditor,
  onToggleBatchTagEditor,
  batchTagPending,
  batchFlagPending,
  batchAiRunningTask,
  onBatchFavoriteToggle,
  allSelectedAreFavorite,
  onBatchPinToggle,
  allSelectedArePinned,
  onMergeCopy,
  canRunBatchAi,
  onBatchAiAction,
  onClearSelection,
  batchTagEditorRef,
  batchTagInput,
  onBatchTagInputChange,
  onBatchTagInputKeyDown,
  canApplyBatchTag,
  onApplyBatchTag,
  activeBatchTagSuggestion,
  onCloseBatchTagEditor,
  filteredBatchTagSuggestions,
  batchTagSuggestionsRef,
  batchTagActiveSuggestionIndex,
  setBatchTagActiveSuggestionIndex,
  multiSelectFeedback,
}) {
  const { t } = useTranslation();

  return (
    <div className="multi-select-bar workbench-multi-select-bar">
      <span className="multi-select-count">
        {t('multiSelect.selected', { count: selectedCount })}
      </span>
      <div className="multi-select-actions">
        <button
          className={`multi-select-btn tag ${showBatchTagEditor ? 'active' : ''}`}
          onClick={onToggleBatchTagEditor}
          disabled={batchTagPending || batchFlagPending || batchAiRunningTask != null}
          title={t('multiSelect.addTag')}
        >
          <Tag size={14} />
          <span>{t('multiSelect.addTag')}</span>
        </button>
        <button
          className="multi-select-btn favorite"
          onClick={onBatchFavoriteToggle}
          disabled={batchTagPending || batchFlagPending || batchAiRunningTask != null}
          title={allSelectedAreFavorite ? t('multiSelect.batchUnfavorite') : t('multiSelect.batchFavorite')}
        >
          <Star size={14} fill={allSelectedAreFavorite ? 'currentColor' : 'none'} />
          <span>{allSelectedAreFavorite ? t('multiSelect.batchUnfavorite') : t('multiSelect.batchFavorite')}</span>
        </button>
        <button
          className="multi-select-btn pin"
          onClick={onBatchPinToggle}
          disabled={batchTagPending || batchFlagPending || batchAiRunningTask != null}
          title={allSelectedArePinned ? t('multiSelect.batchUnpin') : t('multiSelect.batchPin')}
        >
          <Inbox size={14} />
          <span>{allSelectedArePinned ? t('multiSelect.batchUnpin') : t('multiSelect.batchPin')}</span>
        </button>
        <button className="multi-select-btn copy" onClick={onMergeCopy} title={t('multiSelect.mergeCopy')}>
          <Copy size={14} />
          <span>{t('multiSelect.mergeCopy')}</span>
        </button>
        {canRunBatchAi && (
          <>
            <button
              className="multi-select-btn ai"
              onClick={() => onBatchAiAction('summarize')}
              disabled={batchTagPending || batchFlagPending || batchAiRunningTask != null}
              title={t('multiSelect.batchSummarize')}
            >
              <Bot size={14} />
              <span>{t('multiSelect.batchSummarize')}</span>
            </button>
            <button
              className="multi-select-btn ai"
              onClick={() => onBatchAiAction('rewrite')}
              disabled={batchTagPending || batchFlagPending || batchAiRunningTask != null}
              title={t('multiSelect.batchRewrite')}
            >
              <Wand2 size={14} />
              <span>{t('multiSelect.batchRewrite')}</span>
            </button>
          </>
        )}
        <button className="multi-select-btn" onClick={onClearSelection} title={t('multiSelect.clearSelection')}>
          <X size={14} />
          <span>{t('multiSelect.clearSelection')}</span>
        </button>
      </div>
      {showBatchTagEditor && (
        <div className="multi-select-tag-editor" ref={batchTagEditorRef}>
          <div className="multi-select-tag-input-row">
            <input
              type="text"
              value={batchTagInput}
              onChange={(event) => onBatchTagInputChange(event.target.value)}
              onKeyDown={onBatchTagInputKeyDown}
              className="multi-select-tag-input"
              placeholder={t('multiSelect.addTagPlaceholder')}
              autoFocus
            />
            <button
              className="multi-select-tag-action confirm"
              onClick={() => onApplyBatchTag(activeBatchTagSuggestion || batchTagInput)}
              disabled={batchTagPending || !canApplyBatchTag}
              title={t('item.confirmTag')}
            >
              <Check size={12} />
            </button>
            <button
              className="multi-select-tag-action cancel"
              onClick={onCloseBatchTagEditor}
              disabled={batchTagPending}
              title={t('item.cancelTag')}
            >
              <X size={12} />
            </button>
          </div>
          {filteredBatchTagSuggestions.length > 0 && (
            <div className="multi-select-tag-suggestions" ref={batchTagSuggestionsRef}>
              {filteredBatchTagSuggestions.map((tag, index) => (
                <button
                  key={tag}
                  data-suggestion-index={index}
                  className={`multi-select-tag-suggestion-item ${batchTagActiveSuggestionIndex === index ? 'active' : ''}`}
                  onClick={() => onApplyBatchTag(tag)}
                  onMouseEnter={() => setBatchTagActiveSuggestionIndex(index)}
                  disabled={batchTagPending}
                >
                  <Tag size={12} />
                  <span>{tag}</span>
                </button>
              ))}
            </div>
          )}
          <div className="multi-select-tag-hint">{t('multiSelect.addTagHint')}</div>
        </div>
      )}
      {multiSelectFeedback && (
        <div className={`multi-select-feedback ${multiSelectFeedback.type}`}>
          {multiSelectFeedback.text}
        </div>
      )}
    </div>
  );
}

export default WorkbenchMultiSelectBar;

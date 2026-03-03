import { useTranslation } from 'react-i18next';
import { Bot, Check, Columns2, Copy, Inbox, Star, Tag, Trash2, Wand2, X } from 'lucide-react';

function MultiSelectBar({
  selectedCount,
  showBatchTagEditor,
  onToggleBatchTagEditor,
  onBatchFavoriteToggle,
  allSelectedAreFavorite,
  onBatchPinToggle,
  allSelectedArePinned,
  onMergeCopy,
  canCompareSelected,
  onCompareSelected,
  canRunBatchAi,
  onBatchAiAction,
  batchFlagPending,
  batchAiRunningTask,
  onDeleteSelected,
  onClearSelection,
  batchTagEditorRef,
  batchTagInput,
  onBatchTagInputChange,
  handleBatchTagInputKeyDown,
  canApplyBatchTag,
  applyBatchTag,
  activeBatchTagSuggestion,
  batchTagPending,
  closeBatchTagEditor,
  filteredBatchTagSuggestions,
  batchTagSuggestionsRef,
  batchTagActiveSuggestionIndex,
  setBatchTagActiveSuggestionIndex,
  compareFeedback,
  batchTagFeedback,
  batchAiFeedback,
}) {
  const { t } = useTranslation();
  const activeFeedback = compareFeedback || batchTagFeedback || batchAiFeedback;
  const ACTION_ICON_SIZE = 16;
  const ACTION_ICON_STROKE = 1.9;

  return (
    <div
      className="multi-select-bar"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="multi-select-meta">
        <span className="multi-select-count">
          {t('multiSelect.selected', { count: selectedCount })}
        </span>
        <span className="multi-select-hint">
          {t('multiSelect.selectHint')}
        </span>
      </div>
      <button
        className="multi-select-clear-btn"
        onClick={(e) => {
          e.stopPropagation();
          onClearSelection?.();
        }}
        title={t('multiSelect.clearSelection')}
        aria-label={t('multiSelect.clearSelection')}
      >
        <X size={17} strokeWidth={2.0} />
      </button>
      <div className="multi-select-actions">
        <button
          className={`multi-select-btn btn-tag ${showBatchTagEditor ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleBatchTagEditor();
          }}
          title={t('multiSelect.addTag')}
        >
          <Tag size={ACTION_ICON_SIZE} strokeWidth={ACTION_ICON_STROKE} />
          <span>{t('multiSelect.addTag')}</span>
        </button>
        <button
          className="multi-select-btn favorite"
          onClick={(e) => {
            e.stopPropagation();
            onBatchFavoriteToggle();
          }}
          disabled={batchFlagPending || batchAiRunningTask != null}
          title={allSelectedAreFavorite ? t('multiSelect.batchUnfavorite') : t('multiSelect.batchFavorite')}
        >
          <Star size={ACTION_ICON_SIZE} strokeWidth={ACTION_ICON_STROKE} fill={allSelectedAreFavorite ? 'currentColor' : 'none'} />
          <span>{allSelectedAreFavorite ? t('multiSelect.batchUnfavorite') : t('multiSelect.batchFavorite')}</span>
        </button>
        <button
          className="multi-select-btn pin"
          onClick={(e) => {
            e.stopPropagation();
            onBatchPinToggle();
          }}
          disabled={batchFlagPending || batchAiRunningTask != null}
          title={allSelectedArePinned ? t('multiSelect.batchUnpin') : t('multiSelect.batchPin')}
        >
          <Inbox size={ACTION_ICON_SIZE} strokeWidth={ACTION_ICON_STROKE} />
          <span>{allSelectedArePinned ? t('multiSelect.batchUnpin') : t('multiSelect.batchPin')}</span>
        </button>
        <button
          className="multi-select-btn copy"
          onClick={(e) => {
            e.stopPropagation();
            onMergeCopy();
          }}
          title={t('multiSelect.mergeCopy')}
        >
          <Copy size={ACTION_ICON_SIZE} strokeWidth={ACTION_ICON_STROKE} />
          <span>{t('multiSelect.mergeCopy')}</span>
        </button>
        <button
          className="multi-select-btn"
          onClick={(e) => {
            e.stopPropagation();
            onCompareSelected?.();
          }}
          disabled={!canCompareSelected}
          title={t('multiSelect.compare')}
        >
          <Columns2 size={ACTION_ICON_SIZE} strokeWidth={ACTION_ICON_STROKE} />
          <span>{t('multiSelect.compare')}</span>
        </button>
        {canRunBatchAi && (
          <>
            <button
              className="multi-select-btn ai"
              onClick={(e) => {
                e.stopPropagation();
                onBatchAiAction('summarize');
              }}
              disabled={batchFlagPending || batchAiRunningTask != null}
              title={t('multiSelect.batchSummarize')}
            >
              <Bot size={ACTION_ICON_SIZE} strokeWidth={ACTION_ICON_STROKE} />
              <span>{t('multiSelect.batchSummarize')}</span>
            </button>
            <button
              className="multi-select-btn ai"
              onClick={(e) => {
                e.stopPropagation();
                onBatchAiAction('rewrite');
              }}
              disabled={batchFlagPending || batchAiRunningTask != null}
              title={t('multiSelect.batchRewrite')}
            >
              <Wand2 size={ACTION_ICON_SIZE} strokeWidth={ACTION_ICON_STROKE} />
              <span>{t('multiSelect.batchRewrite')}</span>
            </button>
          </>
        )}
        <button
          className="multi-select-btn delete"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteSelected();
          }}
          title={t('multiSelect.delete')}
        >
          <Trash2 size={ACTION_ICON_SIZE} strokeWidth={ACTION_ICON_STROKE} />
          <span>{t('multiSelect.delete')}</span>
        </button>
      </div>
      {showBatchTagEditor && (
        <div className="multi-select-tag-editor" ref={batchTagEditorRef}>
          <div className="multi-select-tag-input-row">
            <input
              type="text"
              value={batchTagInput}
              onChange={(e) => onBatchTagInputChange(e.target.value)}
              onKeyDown={handleBatchTagInputKeyDown}
              className="multi-select-tag-input"
              placeholder={t('multiSelect.addTagPlaceholder')}
              autoFocus
            />
            <button
              className="multi-select-tag-action confirm"
              onClick={() => applyBatchTag(activeBatchTagSuggestion || batchTagInput)}
              disabled={!canApplyBatchTag || batchTagPending}
              title={t('item.confirmTag')}
            >
              <Check size={12} />
            </button>
            <button
              className="multi-select-tag-action cancel"
              onClick={closeBatchTagEditor}
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
                  onClick={() => applyBatchTag(tag)}
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
      {activeFeedback && (
        <div className={`multi-select-feedback ui-feedback ${activeFeedback.type}`} role="status" aria-live="polite">
          {activeFeedback.text}
        </div>
      )}
    </div>
  );
}

export default MultiSelectBar;

import {
  BookmarkPlus,
  Bot,
  ChevronDown,
  Clock,
  FileDown,
  History,
  Loader2,
  SlidersHorizontal,
  Trash2,
  Undo2
} from 'lucide-react';

function CollectionQuickActionsBar({
  t,
  setPanelMode,
  quickOutputTask,
  quickOutputRunning,
  showQuickOutputMenu,
  setShowQuickOutputMenu,
  quickOutputMenuRef,
  quickOutputTasks,
  showCollectionMoreMenu,
  setShowCollectionMoreMenu,
  collectionMoreMenuRef,
  activeAction,
  feedback,
  lastClearedPinnedIds,
  hasSnapshot,
  handleRunQuickOutput,
  handleQuickOutputMenuSelect,
  handleSaveSnapshot,
  handleRestoreSnapshot,
  handleExportCollection,
  handleDedupeCollection,
  handleClearAll,
  handleUndoClearAll,
}) {
  const isBusy = quickOutputRunning || activeAction != null;

  return (
    <>
      <div className="collection-bottom-bar">
        <button
          className="collection-btn timeline-btn"
          onClick={() => setPanelMode('timeline')}
          title={t('collection.timeTravel')}
          disabled={isBusy}
        >
          <Clock size={14} />
          <span>{t('collection.timeTravel')}</span>
        </button>

        <div className={`collection-split-btn ${showQuickOutputMenu ? 'open' : ''}`} ref={quickOutputMenuRef}>
          <button
            className="collection-btn quick-output-main-btn"
            onClick={() => handleRunQuickOutput(quickOutputTask)}
            disabled={isBusy}
            title={t('collection.quickOutputRunTitle', {
              task: t(`aiAssistant.tasks.${quickOutputTask}`),
            })}
          >
            {quickOutputRunning ? <Loader2 size={14} className="collection-btn-spinner" /> : <Bot size={14} />}
            <span>{t('collection.quickOutputTaskLabel', { task: t(`aiAssistant.tasks.${quickOutputTask}`) })}</span>
          </button>
          <button
            type="button"
            className="collection-btn quick-output-toggle-btn"
            onClick={() => {
              setShowCollectionMoreMenu(false);
              setShowQuickOutputMenu(current => !current);
            }}
            disabled={isBusy}
            title={t('collection.quickOutputSelectTitle')}
            aria-label={t('collection.quickOutputSelectTitle')}
            aria-expanded={showQuickOutputMenu}
            aria-haspopup="menu"
          >
            <ChevronDown size={14} />
          </button>
          {showQuickOutputMenu && (
            <div className="collection-dropdown-menu">
              {quickOutputTasks.map((taskType) => (
                <button
                  key={taskType}
                  className={`collection-dropdown-item ${quickOutputTask === taskType ? 'active' : ''}`}
                  onClick={() => handleQuickOutputMenuSelect(taskType)}
                  disabled={isBusy}
                >
                  <span>{t(`aiAssistant.tasks.${taskType}`)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`collection-more-menu ${showCollectionMoreMenu ? 'open' : ''}`} ref={collectionMoreMenuRef}>
          <button
            className={`collection-btn collection-more-btn ${showCollectionMoreMenu ? 'open' : ''}`}
            onClick={() => {
              setShowQuickOutputMenu(false);
              setShowCollectionMoreMenu(current => !current);
            }}
            disabled={isBusy}
            title={t('collection.moreActions')}
          >
            <SlidersHorizontal size={14} />
            <span>{t('collection.moreActions')}</span>
            <ChevronDown size={13} className="collection-more-caret" />
          </button>
          {showCollectionMoreMenu && (
            <div className="collection-dropdown-menu align-right">
              <button className="collection-dropdown-item" onClick={handleSaveSnapshot} disabled={isBusy}>
                {activeAction === 'snapshot' ? <Loader2 size={14} className="collection-btn-spinner" /> : <BookmarkPlus size={14} />}
                <span>{t('collection.snapshotSave')}</span>
              </button>
              <button
                className="collection-dropdown-item"
                onClick={handleRestoreSnapshot}
                disabled={isBusy || !hasSnapshot}
              >
                {activeAction === 'restore-snapshot' ? <Loader2 size={14} className="collection-btn-spinner" /> : <History size={14} />}
                <span>{t('collection.snapshotRestore')}</span>
              </button>
              <button className="collection-dropdown-item" onClick={handleExportCollection} disabled={isBusy}>
                {activeAction === 'export' ? <Loader2 size={14} className="collection-btn-spinner" /> : <FileDown size={14} />}
                <span>{t('collection.exportMarkdown')}</span>
              </button>
              <button className="collection-dropdown-item" onClick={handleDedupeCollection} disabled={isBusy}>
                {activeAction === 'dedupe' ? <Loader2 size={14} className="collection-btn-spinner" /> : <Trash2 size={14} />}
                <span>{t('collection.dedupePinned')}</span>
              </button>
              <button className="collection-dropdown-item danger" onClick={handleClearAll} disabled={isBusy}>
                {activeAction === 'clear' ? <Loader2 size={14} className="collection-btn-spinner" /> : <Trash2 size={14} />}
                <span>{t('collection.clearAll')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`collection-bottom-feedback ui-feedback ${feedback.type}`} role="status" aria-live="polite">
          <span>{feedback.text}</span>
          {feedback.withUndo && lastClearedPinnedIds.length > 0 && (
            <button
              type="button"
              className="collection-bottom-feedback-undo"
              onClick={handleUndoClearAll}
              disabled={isBusy}
            >
              {activeAction === 'undo-clear' ? <Loader2 size={12} className="collection-feedback-spinner" /> : <Undo2 size={12} />}
              <span>{t('collection.undo')}</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default CollectionQuickActionsBar;

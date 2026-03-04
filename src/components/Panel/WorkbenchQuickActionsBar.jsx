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

function WorkbenchQuickActionsBar({
  t,
  setPanelMode,
  quickOutputTask,
  quickOutputRunning,
  showQuickOutputMenu,
  setShowQuickOutputMenu,
  quickOutputMenuRef,
  quickOutputTasks,
  showWorkbenchMoreMenu,
  setShowWorkbenchMoreMenu,
  workbenchMoreMenuRef,
  activeAction,
  feedback,
  lastClearedPinnedIds,
  hasSnapshot,
  handleRunQuickOutput,
  handleQuickOutputMenuSelect,
  handleSaveSnapshot,
  handleRestoreSnapshot,
  handleExportWorkbench,
  handleDedupeWorkbench,
  handleClearAll,
  handleUndoClearAll,
}) {
  const isBusy = quickOutputRunning || activeAction != null;

  return (
    <>
      <div className="workbench-bottom-bar">
        <button
          className="workbench-btn timeline-btn"
          onClick={() => setPanelMode('timeline')}
          title={t('workbench.timeTravel')}
          disabled={isBusy}
        >
          <Clock size={14} />
          <span>{t('workbench.timeTravel')}</span>
        </button>

        <div className={`workbench-split-btn ${showQuickOutputMenu ? 'open' : ''}`} ref={quickOutputMenuRef}>
          <button
            className="workbench-btn quick-output-main-btn"
            onClick={() => handleRunQuickOutput(quickOutputTask)}
            disabled={isBusy}
            title={t('workbench.quickOutputRunTitle', {
              task: t(`aiAssistant.tasks.${quickOutputTask}`),
            })}
          >
            {quickOutputRunning ? <Loader2 size={14} className="workbench-btn-spinner" /> : <Bot size={14} />}
            <span>{t('workbench.quickOutputTaskLabel', { task: t(`aiAssistant.tasks.${quickOutputTask}`) })}</span>
          </button>
          <button
            type="button"
            className="workbench-btn quick-output-toggle-btn"
            onClick={() => {
              setShowWorkbenchMoreMenu(false);
              setShowQuickOutputMenu(current => !current);
            }}
            disabled={isBusy}
            title={t('workbench.quickOutputSelectTitle')}
            aria-label={t('workbench.quickOutputSelectTitle')}
            aria-expanded={showQuickOutputMenu}
            aria-haspopup="menu"
          >
            <ChevronDown size={14} />
          </button>
          {showQuickOutputMenu && (
            <div className="workbench-dropdown-menu">
              {quickOutputTasks.map((taskType) => (
                <button
                  key={taskType}
                  className={`workbench-dropdown-item ${quickOutputTask === taskType ? 'active' : ''}`}
                  onClick={() => handleQuickOutputMenuSelect(taskType)}
                  disabled={isBusy}
                >
                  <span>{t(`aiAssistant.tasks.${taskType}`)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`workbench-more-menu ${showWorkbenchMoreMenu ? 'open' : ''}`} ref={workbenchMoreMenuRef}>
          <button
            className={`workbench-btn workbench-more-btn ${showWorkbenchMoreMenu ? 'open' : ''}`}
            onClick={() => {
              setShowQuickOutputMenu(false);
              setShowWorkbenchMoreMenu(current => !current);
            }}
            disabled={isBusy}
            title={t('workbench.moreActions')}
          >
            <SlidersHorizontal size={14} />
            <span>{t('workbench.moreActions')}</span>
            <ChevronDown size={13} className="workbench-more-caret" />
          </button>
          {showWorkbenchMoreMenu && (
            <div className="workbench-dropdown-menu align-right">
              <button className="workbench-dropdown-item" onClick={handleSaveSnapshot} disabled={isBusy}>
                {activeAction === 'snapshot' ? <Loader2 size={14} className="workbench-btn-spinner" /> : <BookmarkPlus size={14} />}
                <span>{t('workbench.snapshotSave')}</span>
              </button>
              <button
                className="workbench-dropdown-item"
                onClick={handleRestoreSnapshot}
                disabled={isBusy || !hasSnapshot}
              >
                {activeAction === 'restore-snapshot' ? <Loader2 size={14} className="workbench-btn-spinner" /> : <History size={14} />}
                <span>{t('workbench.snapshotRestore')}</span>
              </button>
              <button className="workbench-dropdown-item" onClick={handleExportWorkbench} disabled={isBusy}>
                {activeAction === 'export' ? <Loader2 size={14} className="workbench-btn-spinner" /> : <FileDown size={14} />}
                <span>{t('workbench.exportMarkdown')}</span>
              </button>
              <button className="workbench-dropdown-item" onClick={handleDedupeWorkbench} disabled={isBusy}>
                {activeAction === 'dedupe' ? <Loader2 size={14} className="workbench-btn-spinner" /> : <Trash2 size={14} />}
                <span>{t('workbench.dedupePinned')}</span>
              </button>
              <button className="workbench-dropdown-item danger" onClick={handleClearAll} disabled={isBusy}>
                {activeAction === 'clear' ? <Loader2 size={14} className="workbench-btn-spinner" /> : <Trash2 size={14} />}
                <span>{t('workbench.clearAll')}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`workbench-bottom-feedback ui-feedback ${feedback.type}`} role="status" aria-live="polite">
          <span>{feedback.text}</span>
          {feedback.withUndo && lastClearedPinnedIds.length > 0 && (
            <button
              type="button"
              className="workbench-bottom-feedback-undo"
              onClick={handleUndoClearAll}
              disabled={isBusy}
            >
              {activeAction === 'undo-clear' ? <Loader2 size={12} className="workbench-feedback-spinner" /> : <Undo2 size={12} />}
              <span>{t('workbench.undo')}</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default WorkbenchQuickActionsBar;

import {
  BookmarkPlus,
  Bot,
  Check,
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
  handleUndoClearAll,
  workbenchPrimaryAction,
  handleRunWorkbenchPrimaryAction,
  handleSelectWorkbenchPrimaryAction,
}) {
  const isBusy = quickOutputRunning || activeAction != null;
  const workbenchActionOptions = [
    { key: 'snapshot', label: t('workbench.snapshotSave'), icon: BookmarkPlus },
    { key: 'restore-snapshot', label: t('workbench.snapshotRestore'), icon: History },
    { key: 'export', label: t('workbench.exportMarkdown'), icon: FileDown },
    { key: 'dedupe', label: t('workbench.dedupePinned'), icon: Trash2 },
    { key: 'clear', label: t('workbench.clearAll'), icon: Trash2, danger: true },
  ];
  const currentWorkbenchAction = workbenchActionOptions.find((option) => option.key === workbenchPrimaryAction) || workbenchActionOptions[0];
  const CurrentWorkbenchActionIcon = currentWorkbenchAction.icon;

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

        <div className={`workbench-more-menu workbench-split-btn workbench-more-split-btn ${showWorkbenchMoreMenu ? 'open' : ''}`} ref={workbenchMoreMenuRef}>
          <button
            className={`workbench-btn workbench-more-main-btn ${showWorkbenchMoreMenu ? 'open' : ''} ${currentWorkbenchAction.danger ? 'danger' : ''}`.trim()}
            onClick={handleRunWorkbenchPrimaryAction}
            disabled={isBusy}
            title={currentWorkbenchAction.label}
          >
            {activeAction === workbenchPrimaryAction
              ? <Loader2 size={14} className="workbench-btn-spinner" />
              : <CurrentWorkbenchActionIcon size={14} />}
            <span>{currentWorkbenchAction.label}</span>
          </button>
          <button
            type="button"
            className={`workbench-btn workbench-more-toggle-btn ${showWorkbenchMoreMenu ? 'open' : ''}`}
            onClick={() => {
              setShowQuickOutputMenu(false);
              setShowWorkbenchMoreMenu(current => !current);
            }}
            disabled={isBusy}
            title={t('workbench.moreActions')}
            aria-label={t('workbench.moreActions')}
            aria-expanded={showWorkbenchMoreMenu}
            aria-haspopup="menu"
          >
            <SlidersHorizontal size={14} />
            <ChevronDown size={13} className="workbench-more-caret" />
          </button>
          {showWorkbenchMoreMenu && (
            <div className="workbench-dropdown-menu align-right">
              {workbenchActionOptions.map((option) => {
                const OptionIcon = option.icon;
                const optionDisabled = isBusy || (option.key === 'restore-snapshot' && !hasSnapshot);
                return (
                  <button
                    key={option.key}
                    className={`workbench-dropdown-item ${option.danger ? 'danger' : ''} ${workbenchPrimaryAction === option.key ? 'active' : ''}`}
                    onClick={() => handleSelectWorkbenchPrimaryAction(option.key)}
                    disabled={optionDisabled}
                  >
                    {activeAction === option.key ? <Loader2 size={14} className="workbench-btn-spinner" /> : <OptionIcon size={14} />}
                    <span>{option.label}</span>
                    {workbenchPrimaryAction === option.key && <Check size={13} className="workbench-dropdown-active-mark" />}
                  </button>
                );
              })}
            </div>
          )}
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
      </div>
    </>
  );
}

export default WorkbenchQuickActionsBar;

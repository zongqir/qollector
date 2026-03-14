import { useEffect } from 'react';

import {
  BookmarkPlus,
  Bot,
  Check,
  ChevronDown,
  Clock,
  FileDown,
  History,
  Loader2,
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
  workbenchSwitcher = null,
  layoutMode = 'full',
  measurementMode = false,
  barRef = null,
}) {
  const isBusy = quickOutputRunning || activeAction != null;
  const useCompactLayout = layoutMode === 'compact';
  const workbenchActionOptions = [
    { key: 'snapshot', label: t('workbench.snapshotSave'), icon: BookmarkPlus },
    { key: 'restore-snapshot', label: t('workbench.snapshotRestore'), icon: History },
    { key: 'export', label: t('workbench.exportMarkdown'), icon: FileDown },
    { key: 'clear', label: t('workbench.clearAll'), icon: Trash2, danger: true },
  ];
  const currentWorkbenchAction = workbenchActionOptions.find((option) => option.key === workbenchPrimaryAction) || workbenchActionOptions[0];
  const CurrentWorkbenchActionIcon = currentWorkbenchAction.icon;
  const bottomBarClassName = `workbench-bottom-bar workbench-bottom-bar--${layoutMode} ${measurementMode ? 'workbench-bottom-bar--sizer' : ''}`.trim();

  useEffect(() => {
    if (measurementMode || !useCompactLayout) return;
    setShowQuickOutputMenu(false);
    setShowWorkbenchMoreMenu(false);
  }, [
    measurementMode,
    setShowQuickOutputMenu,
    setShowWorkbenchMoreMenu,
    useCompactLayout,
  ]);

  return (
    <>
      <div className={bottomBarClassName} aria-hidden={measurementMode || undefined} ref={barRef}>
        <button
          className="workbench-btn timeline-btn"
          onClick={() => setPanelMode('timeline')}
          title={t('workbench.timeTravel')}
          disabled={isBusy}
          tabIndex={measurementMode ? -1 : undefined}
        >
          <Clock size={14} />
          <span className="workbench-btn-label">{t('workbench.timeTravel')}</span>
        </button>

        {useCompactLayout ? (
          <button
            className="workbench-btn quick-output-main-btn"
            onClick={() => handleRunQuickOutput(quickOutputTask)}
            disabled={isBusy}
            title={t('workbench.quickOutputRunTitle', {
              task: t(`aiAssistant.tasks.${quickOutputTask}`),
            })}
            tabIndex={measurementMode ? -1 : undefined}
          >
            {quickOutputRunning ? <Loader2 size={14} className="workbench-btn-spinner" /> : <Bot size={14} />}
            <span className="workbench-btn-label">{t('workbench.quickOutputTaskLabel', { task: t(`aiAssistant.tasks.${quickOutputTask}`) })}</span>
          </button>
        ) : (
          <div className={`workbench-split-btn ${showQuickOutputMenu ? 'open' : ''}`} ref={quickOutputMenuRef}>
            <button
              className="workbench-btn quick-output-main-btn"
              onClick={() => handleRunQuickOutput(quickOutputTask)}
              disabled={isBusy}
              title={t('workbench.quickOutputRunTitle', {
                task: t(`aiAssistant.tasks.${quickOutputTask}`),
              })}
              tabIndex={measurementMode ? -1 : undefined}
            >
              {quickOutputRunning ? <Loader2 size={14} className="workbench-btn-spinner" /> : <Bot size={14} />}
              <span className="workbench-btn-label">{t('workbench.quickOutputTaskLabel', { task: t(`aiAssistant.tasks.${quickOutputTask}`) })}</span>
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
              tabIndex={measurementMode ? -1 : undefined}
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
        )}

        {useCompactLayout ? (
          <button
            className={`workbench-btn workbench-more-main-btn ${currentWorkbenchAction.danger ? 'danger' : ''}`.trim()}
            onClick={handleRunWorkbenchPrimaryAction}
            disabled={isBusy}
            title={currentWorkbenchAction.label}
            tabIndex={measurementMode ? -1 : undefined}
          >
            {activeAction === workbenchPrimaryAction
              ? <Loader2 size={14} className="workbench-btn-spinner" />
              : <CurrentWorkbenchActionIcon size={14} />}
            <span className="workbench-btn-label">{currentWorkbenchAction.label}</span>
          </button>
        ) : (
          <div
            className={`workbench-more-menu workbench-split-btn workbench-more-split-btn ${showWorkbenchMoreMenu ? 'open' : ''}`.trim()}
            ref={workbenchMoreMenuRef}
          >
            <button
              className={`workbench-btn workbench-more-main-btn ${showWorkbenchMoreMenu ? 'open' : ''} ${currentWorkbenchAction.danger ? 'danger' : ''}`.trim()}
              onClick={handleRunWorkbenchPrimaryAction}
              disabled={isBusy}
              title={currentWorkbenchAction.label}
              tabIndex={measurementMode ? -1 : undefined}
            >
              {activeAction === workbenchPrimaryAction
                ? <Loader2 size={14} className="workbench-btn-spinner" />
                : <CurrentWorkbenchActionIcon size={14} />}
              <span className="workbench-btn-label">{currentWorkbenchAction.label}</span>
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
              tabIndex={measurementMode ? -1 : undefined}
            >
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
        )}

        {workbenchSwitcher}

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
                <span className="workbench-btn-label">{t('workbench.undo')}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default WorkbenchQuickActionsBar;

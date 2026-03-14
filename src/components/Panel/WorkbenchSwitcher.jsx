import { useTranslation } from 'react-i18next';
import {
  Check,
  ChevronDown,
  Layers,
  MoreHorizontal,
  Plus,
} from 'lucide-react';

function WorkbenchSwitcher({
  variant = 'floating',
  activeWorkbenchName,
  activeWorkbenchShortName,
  accentColor,
  workbenchOptions,
  isOpen,
  isManageMenuOpen,
  disabled,
  canManageActiveWorkbench,
  switcherRef,
  onToggle,
  onSelectWorkbench,
  onCreateWorkbench,
  onToggleManageMenu,
  onRenameWorkbench,
  onDeleteWorkbench,
  measurementMode = false,
}) {
  const { t } = useTranslation();
  const isToolbarVariant = variant === 'toolbar';
  const triggerLabel = isToolbarVariant
    ? activeWorkbenchShortName || activeWorkbenchName || t('workbench.defaultBadge')
    : activeWorkbenchShortName || activeWorkbenchName || t('workbench.defaultBadge');
  const triggerTitle = isToolbarVariant
    ? `${t('workbench.switchWorkbench')} · ${activeWorkbenchName || t('workbench.defaultWorkbench')}`
    : activeWorkbenchName || triggerLabel;

  return (
    <div
      ref={switcherRef}
      className={`workbench-switcher-anchor workbench-switcher-anchor--${variant}`}
      style={accentColor ? { '--workbench-switcher-accent': accentColor } : undefined}
    >
      <button
        type="button"
        className={`workbench-switcher-trigger workbench-switcher-trigger--${variant} ${isOpen ? 'is-open' : ''}`.trim()}
        onClick={onToggle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={t('workbench.switchWorkbench')}
        title={triggerTitle}
        disabled={disabled}
        tabIndex={measurementMode ? -1 : undefined}
      >
        {isToolbarVariant && <Layers size={14} className="workbench-switcher-trigger-icon" />}
        <span className="workbench-switcher-trigger-label">{triggerLabel}</span>
        <ChevronDown size={12} className="workbench-switcher-trigger-caret" />
      </button>

      {isOpen && (
        <div
          className={`workbench-switcher-panel workbench-switcher-panel--${variant}`}
          role="dialog"
          aria-label={t('workbench.switchWorkbench')}
        >
          <div className="workbench-switcher-panel-header">
            <div className="workbench-switcher-panel-copy">
              <div className="workbench-switcher-panel-label">{t('workbench.currentWorkbench')}</div>
              <div className="workbench-switcher-panel-title-row">
                <div className="workbench-switcher-panel-title" title={activeWorkbenchName}>{activeWorkbenchName}</div>
              </div>
              <div className="workbench-switcher-panel-hint">{t('workbench.switcherHint')}</div>
            </div>
          </div>

          <div className="workbench-switcher-list">
            {workbenchOptions.map((workbench) => (
              <button
                key={workbench.id}
                type="button"
                className={`workbench-switcher-option ${workbench.isActive ? 'is-active' : ''}`.trim()}
                onClick={() => onSelectWorkbench(workbench.id)}
                title={workbench.label}
              >
                <span className="workbench-switcher-option-label">{workbench.label}</span>
                {workbench.isDefault && (
                  <span className="workbench-switcher-option-badge">{t('workbench.defaultBadge')}</span>
                )}
                {workbench.isActive && (
                  <span className="workbench-switcher-option-check" aria-hidden="true">
                    <Check size={12} />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="workbench-switcher-panel-footer">
            <button
              type="button"
              className="workbench-switcher-footer-btn"
              onClick={onCreateWorkbench}
            >
              <Plus size={13} />
              <span>{t('workbench.createWorkbench')}</span>
            </button>

            <div className="workbench-switcher-footer-tools">
              <button
                type="button"
                className={`workbench-switcher-footer-btn workbench-switcher-manage-btn ${isManageMenuOpen ? 'is-open' : ''}`.trim()}
                onClick={onToggleManageMenu}
                aria-haspopup="menu"
                aria-expanded={isManageMenuOpen}
                aria-label={t('workbench.manageWorkbench')}
                title={t('workbench.manageWorkbench')}
              >
                <MoreHorizontal size={14} />
                <span>{t('workbench.manageWorkbench')}</span>
              </button>
              {isManageMenuOpen && (
                <div className="workbench-manage-menu" role="menu" aria-label={t('workbench.manageWorkbench')}>
                  <button
                    type="button"
                    className="workbench-manage-menu-item"
                    role="menuitem"
                    onClick={onRenameWorkbench}
                    disabled={!canManageActiveWorkbench}
                  >
                    <span>{t('workbench.renameWorkbench')}</span>
                  </button>
                  <button
                    type="button"
                    className="workbench-manage-menu-item danger"
                    role="menuitem"
                    onClick={onDeleteWorkbench}
                    disabled={!canManageActiveWorkbench}
                  >
                    <span>{t('workbench.deleteWorkbench')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkbenchSwitcher;

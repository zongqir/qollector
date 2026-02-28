import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useAppStore from '../store/useAppStore';
import useEscapeDismiss from './hooks/useEscapeDismiss';

function getPlatformModifiers() {
  if (typeof navigator === 'undefined') {
    return { primary: 'Ctrl', secondary: 'Alt' };
  }
  const raw = (
    navigator.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent
    || ''
  ).toLowerCase();
  const isMac = raw.includes('mac');
  return {
    primary: isMac ? 'Cmd' : 'Ctrl',
    secondary: isMac ? 'Option' : 'Alt',
  };
}

function renderCombo(combo) {
  const chunks = String(combo || '')
    .split('+')
    .map(part => part.trim())
    .filter(Boolean);
  if (chunks.length <= 1) return <kbd className="shortcut-help-kbd">{combo}</kbd>;
  return (
    <span className="shortcut-help-kbd-group" aria-label={combo}>
      {chunks.map((chunk, index) => (
        <span key={`${combo}-${chunk}-${index}`} className="shortcut-help-kbd-piece">
          <kbd className="shortcut-help-kbd">{chunk}</kbd>
          {index < chunks.length - 1 && <span className="shortcut-help-kbd-plus">+</span>}
        </span>
      ))}
    </span>
  );
}

function ShortcutHelpOverlay({ isOpen, onClose }) {
  const { t } = useTranslation();
  const isMiniMode = useAppStore(s => s.isMiniMode);
  const panelMode = useAppStore(s => s.panelMode);
  const selectedCount = useAppStore(s => s.selectedItemIds.length);
  const historyTagShortcutEnabled = useAppStore(s => s.historyTagShortcutEnabled);
  const collectionPanelEnabled = useAppStore(s => s.collectionPanelEnabled);

  const modifiers = useMemo(() => getPlatformModifiers(), []);
  const contextLabel = useMemo(() => {
    if (isMiniMode) return t('shortcutHelp.context.mini');
    if (panelMode === 'timeline') return t('shortcutHelp.context.timeline');
    if (panelMode === 'preview') return t('shortcutHelp.context.preview');
    if (panelMode === 'compare') return t('shortcutHelp.context.compare');
    return t('shortcutHelp.context.collection');
  }, [isMiniMode, panelMode, t]);

  const sections = useMemo(() => {
    const globalItems = [
      { id: 'toggle-help', combo: '?', label: t('shortcutHelp.items.toggleHelp') },
      { id: 'density', combo: `${modifiers.primary}+Shift+D`, label: t('shortcutHelp.items.toggleDensity') },
    ];

    globalItems.push({
      id: 'layout-mini',
      combo: `${modifiers.primary}+M`,
      label: t('shortcutHelp.items.layoutMini'),
    });
    globalItems.push({
      id: 'layout-focus',
      combo: `${modifiers.primary}+1`,
      label: t('shortcutHelp.items.layoutFocus'),
    });
    globalItems.push({
      id: 'layout-review',
      combo: `${modifiers.primary}+2`,
      label: t('shortcutHelp.items.layoutReview'),
    });
    globalItems.push({
      id: 'layout-all',
      combo: `${modifiers.primary}+3`,
      label: t('shortcutHelp.items.layoutAll'),
    });

    const historyItems = [
      { id: 'focus-search', combo: '/', label: t('shortcutHelp.items.focusSearch') },
      { id: 'move-cards', combo: '↑ / ↓', label: t('shortcutHelp.items.moveCards') },
      { id: 'copy-focused', combo: 'Enter', label: t('shortcutHelp.items.copyFocused') },
      { id: 'quick-compare', combo: `${modifiers.primary}+Shift+2`, label: t('shortcutHelp.items.quickCompare') },
      { id: 'jump-groups', combo: `${modifiers.secondary}+1/2/3/4`, label: t('shortcutHelp.items.jumpGroups') },
      { id: 'select-all-history', combo: `${modifiers.primary}+A`, label: t('shortcutHelp.items.selectAllVisible') },
    ];

    if (historyTagShortcutEnabled) {
      historyItems.push({
        id: 'batch-tag',
        combo: `${modifiers.primary}+T`,
        label: t('shortcutHelp.items.batchTag'),
      });
    }

    const result = [
      {
        id: 'global',
        title: t('shortcutHelp.sections.global'),
        items: globalItems,
      },
      {
        id: 'history',
        title: t('shortcutHelp.sections.history'),
        items: historyItems,
      },
    ];

    if (selectedCount > 0) {
      result.push({
        id: 'selection',
        title: t('shortcutHelp.sections.selection', { count: selectedCount }),
        items: [
          { id: 'copy-selection', combo: `${modifiers.primary}+C`, label: t('shortcutHelp.items.copySelection') },
          { id: 'delete-selection', combo: 'Delete / Backspace', label: t('shortcutHelp.items.deleteSelection') },
          { id: 'clear-selection', combo: 'Esc', label: t('shortcutHelp.items.clearSelection') },
        ],
      });
    }

    if (!isMiniMode && collectionPanelEnabled) {
      result.push({
        id: 'collection',
        title: t('shortcutHelp.sections.collection'),
        items: [
          {
            id: 'select-all-collection',
            combo: `${modifiers.primary}+A`,
            label: t('shortcutHelp.items.selectAllCollection'),
          },
        ],
      });
    }

    return result;
  }, [
    collectionPanelEnabled,
    historyTagShortcutEnabled,
    isMiniMode,
    modifiers.primary,
    modifiers.secondary,
    selectedCount,
    t,
  ]);

  useEscapeDismiss(isOpen, () => onClose?.());

  if (!isOpen) return null;

  return (
    <div className="shortcut-help-overlay" onClick={() => onClose?.()}>
      <div
        className="shortcut-help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shortcut-help-header">
          <div>
            <h3 id="shortcut-help-title">{t('shortcutHelp.title')}</h3>
            <p className="shortcut-help-context">
              {t('shortcutHelp.contextLabel', { mode: contextLabel })}
            </p>
          </div>
          <button
            type="button"
            className="shortcut-help-close"
            aria-label={t('shortcutHelp.close')}
            onClick={() => onClose?.()}
          >
            <X size={16} />
          </button>
        </header>

        <div className="shortcut-help-grid">
          {sections.map((section) => (
            <section key={section.id} className="shortcut-help-section" aria-label={section.title}>
              <h4>{section.title}</h4>
              <ul>
                {section.items.map((item) => (
                  <li key={item.id} className="shortcut-help-item">
                    <span className="shortcut-help-item-label">{item.label}</span>
                    <span className="shortcut-help-item-combo">{renderCombo(item.combo)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ShortcutHelpOverlay;

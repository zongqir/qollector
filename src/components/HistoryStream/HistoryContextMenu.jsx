import { memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckSquare,
  ClipboardPaste,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  FolderOpen,
  Mail,
  Pencil,
  Share2,
  Trash2,
  X,
} from 'lucide-react';

const MENU_WIDTH = 220;
const VIEWPORT_PADDING = 8;

function normalizeMenuEntries(entries) {
  const raw = entries.filter(Boolean);
  const normalized = [];

  raw.forEach((entry) => {
    if (entry.type === 'separator') {
      if (normalized.length === 0) return;
      if (normalized[normalized.length - 1]?.type === 'separator') return;
    }
    normalized.push(entry);
  });

  while (normalized[normalized.length - 1]?.type === 'separator') {
    normalized.pop();
  }

  return normalized;
}

function estimateMenuHeight(entries) {
  return entries.reduce((sum, entry) => {
    if (entry.type === 'separator') return sum + 8;
    return sum + 34;
  }, 10);
}

function getModifierKeyLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const platform = (
    navigator.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent
    || ''
  ).toLowerCase();
  return platform.includes('mac') ? '⌘' : 'Ctrl';
}

function HistoryContextMenu({
  state,
  menuRef,
  t,
  enableQuickPaste,
  emailRelayEnabled = false,
  collectionHintsDismissed = false,
  onAction,
}) {
  const item = state?.item;
  const isMulti = Boolean(state?.isMulti);
  const menuScope = state?.scope || 'history';
  const isCollectionScope = menuScope === 'collection';
  const confirmDeleteFor = state?.confirmDeleteFor || null;
  const modifierKey = getModifierKeyLabel();

  const entries = useMemo(() => {
    if (!item) return [];

    if (isMulti) {
      return normalizeMenuEntries([
        {
          key: 'copyMerged',
          label: t('multiSelect.mergeCopy'),
          icon: Copy,
          shortcut: `${modifierKey}+C`,
        },
        {
          key: 'mergeToNote',
          label: t('multiSelect.mergeToNote'),
          icon: FileText,
        },
        { type: 'separator' },
        {
          key: 'clearSelection',
          label: t('multiSelect.clearSelection'),
          icon: X,
          shortcut: 'Esc',
        },
        {
          key: 'deleteSelected',
          label: confirmDeleteFor === 'deleteSelected' ? t('item.confirmDelete') : t('multiSelect.delete'),
          icon: Trash2,
          shortcut: 'Del',
          danger: true,
          confirm: confirmDeleteFor === 'deleteSelected',
        },
      ]);
    }

    const canQuickPaste = enableQuickPaste && item.type_ !== 'image' && item.type_ !== 'file';
    const canOpenItem = item.type_ === 'link' || item.type_ === 'file';
    const canReveal = item.type_ === 'file' || item.type_ === 'image';
    const canEditContent = item.type_ !== 'image' && item.type_ !== 'file';

    const commonEntries = [
      { key: 'copy', label: t('item.copy'), icon: Copy, shortcut: `${modifierKey}+C` },
      { key: 'copyPlainText', label: t('item.copyPlainText'), icon: FileText },
      { key: 'multiSelect', label: t('history.contextMenu.multiSelect'), icon: CheckSquare, shortcut: `${modifierKey}+Click` },
      canQuickPaste
        ? { key: 'quickPaste', label: t('history.contextMenu.quickPaste'), icon: ClipboardPaste, shortcut: 'Enter' }
        : null,
    ];

    const openEntries = [
      { key: 'editNote', label: t('item.editNoteAndTags'), icon: Pencil },
      canEditContent ? { key: 'editContent', label: t('item.editContent'), icon: FileText } : null,
      emailRelayEnabled ? { key: 'sendToEmail', label: t('item.sendToEmailBtn'), icon: Mail } : null,
      { key: 'share', label: t('share.title'), icon: Share2 },
      canOpenItem
        ? { key: 'open', label: item.type_ === 'link' ? t('item.openLink') : t('item.openFile'), icon: ExternalLink }
        : null,
      canReveal ? { key: 'reveal', label: t('item.revealInFolder'), icon: FolderOpen } : null,
    ];

    const deleteEntry = {
      key: 'delete',
      label: confirmDeleteFor === 'delete' ? t('item.confirmDelete') : t('item.delete'),
      icon: Trash2,
      shortcut: 'Del',
      danger: true,
      confirm: confirmDeleteFor === 'delete',
    };

    if (isCollectionScope) {
      const collectionEntries = [
        ...(collectionHintsDismissed
          ? [{
            key: 'showCollectionHints',
            label: t('collection.showHints'),
            icon: Eye,
            secondary: true,
          }]
          : []),
      ];

      return normalizeMenuEntries([
        ...commonEntries,
        { type: 'separator' },
        ...openEntries,
        ...(collectionEntries.length > 0 ? [{ type: 'separator' }, ...collectionEntries] : []),
        { type: 'separator' },
        deleteEntry,
      ]);
    }

    return normalizeMenuEntries([
      ...commonEntries,
      { type: 'separator' },
      ...openEntries,
      { type: 'separator' },
      deleteEntry,
    ]);
  }, [item, isMulti, isCollectionScope, confirmDeleteFor, modifierKey, t, enableQuickPaste, collectionHintsDismissed]);

  const position = useMemo(() => {
    if (!item || typeof window === 'undefined') {
      return { left: VIEWPORT_PADDING, top: VIEWPORT_PADDING };
    }

    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const estimatedHeight = estimateMenuHeight(entries) + (isMulti ? 30 : 0);
    const rawX = Number(state?.x || 0);
    const rawY = Number(state?.y || 0);

    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(rawX, viewportWidth - MENU_WIDTH - VIEWPORT_PADDING),
    );
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(rawY, viewportHeight - estimatedHeight - VIEWPORT_PADDING),
    );

    return { left, top };
  }, [entries, isMulti, item, state?.x, state?.y]);

  if (!item || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      className="history-context-menu"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      role="menu"
      aria-label={t('history.contextMenu.ariaLabel')}
      data-history-context-menu="true"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {(isMulti || isCollectionScope) && (
        <div className="history-context-menu-header">
          {isMulti
            ? t('multiSelect.selected', { count: state?.selectedCount || 0 })
            : t('collection.title')}
        </div>
      )}

      {entries.map((entry, index) => {
        if (entry.type === 'separator') {
          return <div key={`sep-${index}`} className="history-context-menu-separator" role="separator" />;
        }

        return (
          <button
            key={entry.key}
            type="button"
            className={`history-context-menu-item ${entry.secondary ? 'secondary' : ''} ${entry.danger ? 'danger' : ''} ${entry.confirm ? 'confirm' : ''}`}
            role="menuitem"
            onClick={() => onAction?.(entry.key)}
          >
            <span className="history-context-menu-item-content">
              {entry.icon && <entry.icon size={14} className="history-context-menu-icon" />}
              <span className="history-context-menu-label">{entry.label}</span>
              {entry.shortcut && <span className="history-context-menu-shortcut">{entry.shortcut}</span>}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export default memo(HistoryContextMenu);

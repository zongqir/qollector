import { memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Inbox,
  Pencil,
  Star,
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
  maxPinnedItems,
  enableQuickPaste,
  onAction,
}) {
  const item = state?.item;
  const isMulti = Boolean(state?.isMulti);
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
    const canOpenInNewWindow = item.type_ !== 'file';
    const canOpenItem = item.type_ === 'link' || item.type_ === 'file';
    const canReveal = item.type_ === 'file' || item.type_ === 'image';

    return normalizeMenuEntries([
      { key: 'copy', label: t('item.copy'), icon: Copy, shortcut: `${modifierKey}+C` },
      { key: 'copyPlainText', label: t('item.copyPlainText'), icon: FileText },
      canQuickPaste
        ? { key: 'quickPaste', label: t('history.contextMenu.quickPaste'), icon: ClipboardPaste, shortcut: 'Enter' }
        : null,
      { type: 'separator' },
      { key: 'favorite', label: item.is_favorite ? t('item.unfavorite') : t('item.favorite'), icon: Star },
      { key: 'pin', label: item.is_pinned ? t('item.unpin') : t('item.pin', { max: maxPinnedItems }), icon: Inbox },
      { key: 'editNote', label: item.user_note ? t('item.editNote') : t('item.addNote'), icon: Pencil },
      { type: 'separator' },
      canOpenInNewWindow ? { key: 'openInNewWindow', label: t('item.openInNewWindow'), icon: ExternalLink } : null,
      canOpenItem
        ? { key: 'open', label: item.type_ === 'link' ? t('item.openLink') : t('item.openFile'), icon: ExternalLink }
        : null,
      canReveal ? { key: 'reveal', label: t('item.revealInFolder'), icon: FolderOpen } : null,
      { type: 'separator' },
      {
        key: 'delete',
        label: confirmDeleteFor === 'delete' ? t('item.confirmDelete') : t('item.delete'),
        icon: Trash2,
        shortcut: 'Del',
        danger: true,
        confirm: confirmDeleteFor === 'delete',
      },
    ]);
  }, [item, isMulti, confirmDeleteFor, modifierKey, t, enableQuickPaste, maxPinnedItems]);

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
      {isMulti && (
        <div className="history-context-menu-header">
          {t('multiSelect.selected', { count: state?.selectedCount || 0 })}
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
            className={`history-context-menu-item ${entry.danger ? 'danger' : ''} ${entry.confirm ? 'confirm' : ''}`}
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

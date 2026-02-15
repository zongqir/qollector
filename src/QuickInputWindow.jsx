import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { Check, Pin, PinOff, Plus, X } from 'lucide-react';
import { saveQuickNote } from './services/quickNoteService';

import './styles/quick-input-window.css';

const NOTE_COLORS = [
  { id: 'default', bg: 'var(--quick-input-bg)', dot: '#e2e2e2' },
  { id: 'yellow', bg: '#fef9e7', dot: '#fce588' },
  { id: 'green', bg: '#eafaf1', dot: '#82deb0' },
  { id: 'blue', bg: '#eaf2fa', dot: '#93c5f7' },
  { id: 'pink', bg: '#fdf2f8', dot: '#f5a6ce' },
  { id: 'purple', bg: '#f3eefa', dot: '#c4a8f0' },
];

function resolveEffectiveTheme(themeMode) {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function QuickInputWindow() {
  const { t } = useTranslation();
  const textareaRef = useRef(null);
  const toastTimerRef = useRef(null);
  const appWindow = getCurrentWindow();

  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(true);
  const [noteColor, setNoteColor] = useState('default');
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    let unmounted = false;

    const init = async () => {
      try {
        await appWindow.setAlwaysOnTop(true);
      } catch (error) {
        console.error('Failed to set quick input always on top:', error);
      }

      if (unmounted) return;
      setIsPinned(true);

      try {
        const config = await invoke('get_general_config');
        const mode = resolveEffectiveTheme(config?.theme_mode || 'system');
        document.documentElement.classList.toggle('dark-mode', mode === 'dark');
      } catch {
        document.documentElement.classList.remove('dark-mode');
      }
    };

    init();
    return () => {
      unmounted = true;
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [appWindow]);

  const handleTogglePin = useCallback(async () => {
    const next = !isPinned;
    try {
      await appWindow.setAlwaysOnTop(next);
      setIsPinned(next);
    } catch (error) {
      console.error('Failed to toggle quick input pin:', error);
    }
  }, [appWindow, isPinned]);

  const saveAndMaybeClose = useCallback(async (closeAfterSave) => {
    if (!content.trim() || saving) return;

    setSaving(true);
    try {
      await saveQuickNote(content, t('quickInput.source'));

      if (closeAfterSave) {
        await appWindow.close();
        return;
      }

      setContent('');
      setSavedToast(true);
      textareaRef.current?.focus();
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setSavedToast(false);
        toastTimerRef.current = null;
      }, 1200);
    } catch (error) {
      console.error('Quick input save failed:', error);
    } finally {
      setSaving(false);
    }
  }, [appWindow, content, saving, t]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      saveAndMaybeClose(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      appWindow.close();
    }
  }, [appWindow, saveAndMaybeClose]);

  const activeColor = NOTE_COLORS.find((c) => c.id === noteColor) || NOTE_COLORS[0];
  const panelStyle = { '--quick-add-bg': activeColor.bg };

  return (
    <div className="quick-window-shell" style={panelStyle}>
      <header className="quick-window-header" data-tauri-drag-region>
        <div className="quick-window-header-left">
          <span className="quick-window-tip">{t('editModal.quickAddTip')}</span>
        </div>
        <div className="quick-window-actions" data-tauri-drag-region="false">
          <div className="quick-window-colors">
            {NOTE_COLORS.map((color) => (
              <button
                key={color.id}
                className={`quick-window-color-dot ${noteColor === color.id ? 'active' : ''}`}
                style={{ '--dot-color': color.dot }}
                title={color.id}
                onClick={() => setNoteColor(color.id)}
                data-tauri-drag-region="false"
                onMouseDown={(event) => event.stopPropagation()}
              />
            ))}
          </div>
          <button
            className={`quick-window-icon-btn ${isPinned ? 'active' : ''}`}
            data-tauri-drag-region="false"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleTogglePin}
            title={isPinned ? t('titlebar.unpin') : t('titlebar.pin')}
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            className="quick-window-icon-btn danger"
            data-tauri-drag-region="false"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => appWindow.close()}
            title={t('titlebar.close')}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <textarea
        ref={textareaRef}
        className="quick-window-textarea"
        placeholder={t('quickInput.placeholder')}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
      />

      <footer className="quick-window-footer">
        {savedToast && (
          <div className="quick-window-toast">
            <Check size={13} />
            <span>{t('quickInput.success')}</span>
          </div>
        )}
        <div className="quick-window-footer-actions">
          <button
            className="quick-window-btn secondary"
            data-tauri-drag-region="false"
            onMouseDown={(event) => event.stopPropagation()}
            disabled={!content.trim() || saving}
            onClick={() => saveAndMaybeClose(false)}
          >
            <Plus size={14} />
            <span>{t('editModal.saveAndContinue')}</span>
          </button>
          <button
            className="quick-window-btn primary"
            data-tauri-drag-region="false"
            onMouseDown={(event) => event.stopPropagation()}
            disabled={!content.trim() || saving}
            onClick={() => saveAndMaybeClose(true)}
          >
            <Check size={14} />
            <span>{t('editModal.saveHint')}</span>
          </button>
        </div>
      </footer>
    </div>
  );
}

export default QuickInputWindow;

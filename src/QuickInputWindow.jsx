import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { Check, Palette, Pin, PinOff, Plus, X } from 'lucide-react';
import {
  QUICK_INPUT_OPEN_WORKBENCH_EVENT,
  QUICK_INPUT_WINDOW_STATE_EVENT,
  saveQuickNote,
} from './services/quickNoteService';

import './styles/quick-input-window.css';

const NOTE_COLORS = [
  { id: 'default', bg: 'var(--quick-input-bg)', dot: '#e2e2e2' },
  { id: 'yellow', bg: '#fef9e7', dot: '#fce588' },
  { id: 'green', bg: '#eafaf1', dot: '#82deb0' },
  { id: 'blue', bg: '#eaf2fa', dot: '#93c5f7' },
  { id: 'pink', bg: '#fdf2f8', dot: '#f5a6ce' },
  { id: 'purple', bg: '#f3eefa', dot: '#c4a8f0' },
];

const GLASS_KEY = 'qollect-quick-glass-opacity';
const GLASS_DEFAULT = 1.0;
const GLASS_MIN = 0.85;
const GLASS_MAX = 1.0;
const GLASS_STEP = 0.03;
const DRAFT_KEY = 'qollect-quick-input-draft-v1';
const NOTE_COLOR_KEY = 'qollect-quick-note-color-v1';

function resolveEffectiveTheme(themeMode) {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const clampGlassOpacity = (value) => Math.round(Math.min(Math.max(value, GLASS_MIN), GLASS_MAX) * 100) / 100;

const normalizeNoteColorId = (value) => (
  NOTE_COLORS.some(color => color.id === value) ? value : 'default'
);

function QuickInputWindow() {
  const { t } = useTranslation();
  const textareaRef = useRef(null);
  const toastTimerRef = useRef(null);
  const appWindowRef = useRef(getCurrentWindow());
  const allowCloseRef = useRef(false);
  const colorPanelRef = useRef(null);
  const appWindow = appWindowRef.current;

  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(true);
  const [noteColor, setNoteColor] = useState(() => {
    try {
      return normalizeNoteColorId(localStorage.getItem(NOTE_COLOR_KEY));
    } catch {
      return 'default';
    }
  });
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [showWorkbenchCta, setShowWorkbenchCta] = useState(false);
  const [showColorPanel, setShowColorPanel] = useState(false);

  const [glassOpacity, setGlassOpacity] = useState(() => {
    try {
      const saved = Number.parseFloat(localStorage.getItem(GLASS_KEY) || '');
      return Number.isFinite(saved) ? clampGlassOpacity(saved) : GLASS_DEFAULT;
    } catch {
      return GLASS_DEFAULT;
    }
  });
  const [showGlassIndicator, setShowGlassIndicator] = useState(false);
  const glassTimerRef = useRef(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--glass-opacity', glassOpacity);
  }, [glassOpacity]);

  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (typeof draft === 'string' && draft.trim()) {
      setContent(draft);
    }
  }, []);

  useEffect(() => {
    if (content.trim()) {
      localStorage.setItem(DRAFT_KEY, content);
      return;
    }
    localStorage.removeItem(DRAFT_KEY);
  }, [content]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTE_COLOR_KEY, noteColor);
    } catch {
      // Ignore storage failures.
    }
  }, [noteColor]);

  useEffect(() => {
    void emit(QUICK_INPUT_WINDOW_STATE_EVENT, { open: true });
    return () => {
      void emit(QUICK_INPUT_WINDOW_STATE_EVENT, { open: false });
    };
  }, []);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  const requestClose = useCallback(async () => {
    if (saving || allowCloseRef.current) return;
    allowCloseRef.current = true;
    try {
      await appWindow.close();
    } catch (error) {
      allowCloseRef.current = false;
      console.error('Failed to close quick input window:', error);
    }
  }, [appWindow, saving]);

  const adjustGlassOpacity = useCallback((delta) => {
    setGlassOpacity((prev) => {
      const next = clampGlassOpacity(prev + delta);
      try {
        localStorage.setItem(GLASS_KEY, String(next));
      } catch {
        // Ignore storage failures.
      }
      return next;
    });
    setShowGlassIndicator(true);
    clearTimeout(glassTimerRef.current);
    glassTimerRef.current = setTimeout(() => setShowGlassIndicator(false), 800);
  }, []);

  const handleWindowWheel = useCallback((event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.quick-window-textarea')) {
      return;
    }
    event.preventDefault();
    const delta = event.deltaY > 0 ? -GLASS_STEP : GLASS_STEP;
    adjustGlassOpacity(delta);
  }, [adjustGlassOpacity]);

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
      if (glassTimerRef.current) {
        window.clearTimeout(glassTimerRef.current);
      }
    };
  }, [appWindow]);

  useEffect(() => {
    let unlistenCloseRequested = null;

    appWindow.onCloseRequested((event) => {
      if (allowCloseRef.current) return;
      if (saving) {
        event.preventDefault?.();
        return;
      }
      if (!content.trim()) clearDraft();
    }).then((unlisten) => {
      unlistenCloseRequested = unlisten;
    }).catch((error) => {
      console.error('Failed to bind quick input close guard:', error);
    });

    return () => {
      if (typeof unlistenCloseRequested === 'function') {
        unlistenCloseRequested();
      }
    };
  }, [appWindow, clearDraft, content, saving]);

  useEffect(() => {
    if (!showColorPanel) return undefined;

    const handlePointerDown = (event) => {
      if (!colorPanelRef.current?.contains(event.target)) {
        setShowColorPanel(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [showColorPanel]);

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
      clearDraft();

      if (closeAfterSave) {
        setContent('');
        setShowWorkbenchCta(false);
        await requestClose();
        return;
      }

      setContent('');
      setSavedToast(true);
      setShowWorkbenchCta(true);
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
  }, [clearDraft, content, requestClose, saving, t]);

  const handleOpenWorkbench = useCallback(async () => {
    try {
      await emit(QUICK_INPUT_OPEN_WORKBENCH_EVENT, { source: 'quick-input' });
    } catch (error) {
      console.error('Failed to emit open workbench event:', error);
    }
    await requestClose();
  }, [requestClose]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      saveAndMaybeClose(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      void requestClose();
    }
  }, [requestClose, saveAndMaybeClose]);

  const activeColor = NOTE_COLORS.find((c) => c.id === noteColor) || NOTE_COLORS[0];
  const panelStyle = { '--quick-add-bg': activeColor.bg };

  return (
    <div className="quick-window-shell" style={panelStyle} onWheel={handleWindowWheel}>
      <header className="quick-window-header" data-tauri-drag-region>
        <div className="quick-window-header-left" data-tauri-drag-region>
          <span className="quick-window-tip" data-tauri-drag-region>{t('editModal.quickAddTip')}</span>
        </div>
        {showGlassIndicator && (
          <div className="glass-indicator" data-tauri-drag-region>
            <div className="glass-indicator-track">
              <div
                className="glass-indicator-fill"
                style={{ width: `${((glassOpacity - GLASS_MIN) / (GLASS_MAX - GLASS_MIN)) * 100}%` }}
              />
            </div>
            <span className="glass-indicator-value">{Math.round(glassOpacity * 100)}%</span>
          </div>
        )}
        <div className="quick-window-actions" data-tauri-drag-region>
          <div
            className={`quick-window-color-panel-wrap ${showColorPanel ? 'open' : ''}`}
            ref={colorPanelRef}
            data-tauri-drag-region="false"
          >
            <button
              className={`quick-window-icon-btn ${showColorPanel ? 'active' : ''}`}
              data-tauri-drag-region="false"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setShowColorPanel(prev => !prev)}
              title={t('quickInput.colorPanel')}
            >
              <Palette size={14} />
            </button>
            {showColorPanel && (
              <div className="quick-window-colors">
                {NOTE_COLORS.map((color) => (
                  <button
                    key={color.id}
                    className={`quick-window-color-dot ${noteColor === color.id ? 'active' : ''}`}
                    style={{ '--dot-color': color.dot }}
                    title={color.id}
                    onClick={() => {
                      setNoteColor(color.id);
                      setShowColorPanel(false);
                    }}
                    data-tauri-drag-region="false"
                    onMouseDown={(event) => event.stopPropagation()}
                  />
                ))}
              </div>
            )}
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
            onClick={() => {
              void requestClose();
            }}
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
        onChange={(event) => {
          setContent(event.target.value);
          if (showWorkbenchCta) {
            setShowWorkbenchCta(false);
          }
        }}
        onKeyDown={handleKeyDown}
        autoFocus
      />

      <footer className="quick-window-footer">
        <div className="quick-window-feedback">
          {savedToast && (
            <div className="quick-window-toast">
              <Check size={13} />
              <span>{t('quickInput.success')}</span>
            </div>
          )}
          {showWorkbenchCta && (
            <button
              type="button"
              className="quick-window-workbench-cta"
              data-tauri-drag-region="false"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                void handleOpenWorkbench();
              }}
            >
              {t('quickInput.viewWorkbench')}
            </button>
          )}
        </div>
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

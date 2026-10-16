import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Palette, X } from 'lucide-react';
import { saveQuickNote } from '../services/quickNoteService';
import { QUICK_INPUT_SOURCE } from '../utils/sourceConstants';
import useAppStore from '../store/useAppStore';

const DRAFT_KEY = 'qollect-quick-input-draft-v1';
const NOTE_COLOR_KEY = 'qollect-quick-note-color-v1';
const GLASS_STORAGE_KEY = 'qollect-glass-opacity';
const GLASS_DEFAULT = 1.0;
const GLASS_MIN = 0.05;
const GLASS_MAX = 1.0;
const GLASS_STEP = 0.03;

const NOTE_COLORS = [
  {
    id: 'default',
    bg: 'var(--quick-input-bg)',
    fg: 'var(--text-primary)',
    muted: 'var(--text-secondary)',
    placeholder: 'var(--text-tertiary)',
    swatch: '#d7dbe3',
  },
  {
    id: 'amber',
    bg: 'rgba(255, 244, 214, calc(var(--glass-opacity) * 0.96))',
    fg: '#5f4300',
    muted: '#866319',
    placeholder: '#ab8740',
    swatch: '#f2bf4b',
  },
  {
    id: 'mint',
    bg: 'rgba(228, 248, 236, calc(var(--glass-opacity) * 0.96))',
    fg: '#1e5031',
    muted: '#427155',
    placeholder: '#6d927b',
    swatch: '#59b87d',
  },
  {
    id: 'sky',
    bg: 'rgba(232, 242, 255, calc(var(--glass-opacity) * 0.96))',
    fg: '#21456f',
    muted: '#486a94',
    placeholder: '#7694b8',
    swatch: '#67a5ff',
  },
  {
    id: 'rose',
    bg: 'rgba(252, 236, 241, calc(var(--glass-opacity) * 0.96))',
    fg: '#6a3145',
    muted: '#91586c',
    placeholder: '#bc8799',
    swatch: '#e786a5',
  },
];

const normalizeNoteColorId = (value) => (
  NOTE_COLORS.some((color) => color.id === value) ? value : 'default'
);

const clampGlassOpacity = (value) => (
  Math.round(Math.min(Math.max(value, GLASS_MIN), GLASS_MAX) * 100) / 100
);

const applyGlassOpacity = (value) => {
  document.documentElement.style.setProperty('--glass-opacity', value);
};

function QuickNoteOverlay({
  isOpen,
  isMiniMode = false,
  onClose,
  onSaved,
}) {
  const { t } = useTranslation();
  const textareaRef = useRef(null);
  const colorPanelRef = useRef(null);
  const [content, setContent] = useState('');
  const [noteColor, setNoteColor] = useState(() => {
    try {
      return normalizeNoteColorId(localStorage.getItem(NOTE_COLOR_KEY));
    } catch {
      return 'default';
    }
  });
  const [showColorPanel, setShowColorPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [glassOpacity, setGlassOpacity] = useState(() => {
    const raw = Number.parseFloat(localStorage.getItem(GLASS_STORAGE_KEY) || '');
    return Number.isFinite(raw) ? clampGlassOpacity(raw) : GLASS_DEFAULT;
  });
  const [showGlassIndicator, setShowGlassIndicator] = useState(false);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    let draft = '';
    try {
      const rawDraft = localStorage.getItem(DRAFT_KEY);
      draft = typeof rawDraft === 'string' ? rawDraft : '';
      setContent(draft);
    } catch {
      setContent('');
    }
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(draft.length, draft.length);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) return;
    setShowColorPanel(false);
    setSaveError('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = content.trim();
    try {
      if (trimmed) {
        localStorage.setItem(DRAFT_KEY, content);
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [content, isOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTE_COLOR_KEY, noteColor);
    } catch {
      // Ignore storage failures.
    }
  }, [noteColor]);

  useEffect(() => {
    applyGlassOpacity(glassOpacity);
    localStorage.setItem(GLASS_STORAGE_KEY, String(glassOpacity));
  }, [glassOpacity]);

  useEffect(() => () => {
    clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen || !showColorPanel) return undefined;

    const handlePointerDown = (event) => {
      if (!colorPanelRef.current?.contains(event.target)) {
        setShowColorPanel(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, showColorPanel]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleWindowKeyDown = (event) => {
      if (event.key !== 'Escape' || saving) return;
      event.preventDefault();
      onClose?.();
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [isOpen, onClose, saving]);

  const activeColor = useMemo(
    () => NOTE_COLORS.find((color) => color.id === noteColor) || NOTE_COLORS[0],
    [noteColor],
  );

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setSaveError('');
    try {
      await saveQuickNote(trimmed, QUICK_INPUT_SOURCE, {
        autoFavorite: true,
      });
      clearDraft();
      setContent('');
      setShowColorPanel(false);
      onSaved?.();
    } catch (error) {
      const message = typeof error === 'string' ? error : (error?.message || String(error));
      setSaveError(t('quickInput.failed', { error: message }));
    } finally {
      setSaving(false);
    }
  }, [clearDraft, content, onSaved, saving, t]);

  const handleTextareaKeyDown = useCallback((event) => {
    if (event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!saving) {
        onClose?.();
      }
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleSave();
    }
  }, [handleSave, onClose, saving]);

  const handleOverlayWheel = useCallback((event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement
      && (
        target.closest('.quick-note-card-textarea')
        || target.closest('.quick-note-color-panel')
      )
    ) {
      return;
    }

    event.preventDefault();
    setGlassOpacity((prev) => {
      const delta = event.deltaY > 0 ? -GLASS_STEP : GLASS_STEP;
      return clampGlassOpacity(prev + delta);
    });
    setShowGlassIndicator(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowGlassIndicator(false), 800);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className={`quick-note-overlay ${isMiniMode ? 'mini' : ''}`.trim()}
      role="presentation"
      onWheel={handleOverlayWheel}
      onClick={() => {
        if (!saving) {
          onClose?.();
        }
      }}
    >
      <section
        className="quick-note-card"
        role="dialog"
        aria-modal="true"
        aria-label={t('quickInput.title')}
        style={{
          '--quick-note-card-bg': activeColor.bg,
          '--quick-note-card-fg': activeColor.fg,
          '--quick-note-card-muted': activeColor.muted,
          '--quick-note-card-placeholder': activeColor.placeholder,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="quick-note-card-header">
          <div className="quick-note-card-drag-area" data-tauri-drag-region>
            <div className="quick-note-card-heading" data-tauri-drag-region="false">
              <span className="quick-note-card-kicker">
                {t('quickInput.overlayTipCollection')}
              </span>
            </div>
            {showGlassIndicator && (
              <div className="glass-indicator quick-note-glass-indicator" data-tauri-drag-region="false">
                <div className="glass-indicator-track">
                  <div
                    className="glass-indicator-fill"
                    style={{ width: `${((glassOpacity - GLASS_MIN) / (GLASS_MAX - GLASS_MIN)) * 100}%` }}
                  />
                </div>
                <span className="glass-indicator-value">{Math.round(glassOpacity * 100)}%</span>
              </div>
            )}
            <div className="quick-note-card-drag-hitbox" data-tauri-drag-region aria-hidden="true" />
          </div>
          <div className="quick-note-card-actions">
            <div
              className={`quick-note-color-wrap ${showColorPanel ? 'open' : ''}`}
              ref={colorPanelRef}
              data-tauri-drag-region="false"
            >
              <button
                type="button"
                className="quick-note-icon-btn"
                title={t('quickInput.colorPanel')}
                aria-label={t('quickInput.colorPanel')}
                data-tauri-drag-region="false"
                onClick={() => setShowColorPanel((prev) => !prev)}
              >
                <Palette size={14} />
              </button>
              {showColorPanel && (
                <div className="quick-note-color-panel">
                  {NOTE_COLORS.map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      className={`quick-note-color-dot ${noteColor === color.id ? 'active' : ''}`}
                      style={{ '--quick-note-dot': color.swatch }}
                      aria-label={color.id}
                      data-tauri-drag-region="false"
                      onClick={() => {
                        setNoteColor(color.id);
                        setShowColorPanel(false);
                      }}
                    >
                      {noteColor === color.id && <Check size={11} strokeWidth={2.4} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="quick-note-icon-btn"
              title={t('titlebar.close')}
              aria-label={t('titlebar.close')}
              data-tauri-drag-region="false"
              onClick={() => {
                if (!saving) {
                  onClose?.();
                }
              }}
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="quick-note-card-body">
          <textarea
            ref={textareaRef}
            className="quick-note-card-textarea"
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              if (saveError) {
                setSaveError('');
              }
            }}
            onKeyDown={handleTextareaKeyDown}
            placeholder={t('quickInput.placeholder')}
            rows={isMiniMode ? 6 : 7}
          />
          {saveError && (
            <div className="quick-note-card-error" role="alert">
              {saveError}
            </div>
          )}
        </div>

        <footer className="quick-note-card-footer">
          <div className="quick-note-card-hints" aria-hidden="true">
            <span>{t('quickInput.enterHint')}</span>
            <span>{t('quickInput.newlineHint')}</span>
            <span>{t('quickInput.closeHint')}</span>
          </div>
          <button
            type="button"
            className="quick-note-save-btn"
            disabled={!content.trim() || saving}
            onClick={() => void handleSave()}
          >
            {saving ? t('quickInput.saving') : t('quickInput.overlaySubmit')}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default QuickNoteOverlay;

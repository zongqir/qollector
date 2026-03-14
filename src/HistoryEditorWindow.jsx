import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Check, Palette, Pin, PinOff, Plus, X } from 'lucide-react';
import { getImageOriginal } from './utils/imageHelpers';
import { getTags, hasReservedTagPrefix, parseSystemTag } from './utils/tagHelpers';
import {
  CARD_BACKGROUND_METADATA_KEY,
  CARD_BACKGROUND_PRESETS,
  getCardBackgroundIdFromMetadata,
  getCardBackgroundPreset,
  withCardBackgroundInMetadata,
} from './utils/cardBackgrounds';

const SAVE_DEBOUNCE_MS = 750;
const SAVE_SUCCESS_TOAST_VISIBLE_MS = 1300;
const SAVE_SUCCESS_TOAST_COOLDOWN_MS = 9000;
const GLASS_OPACITY_KEY = 'qollect-history-editor-glass-opacity';
const GLASS_DEFAULT = 1.0;
const GLASS_MIN = 0.05;
const GLASS_MAX = 1.0;
const GLASS_STEP = 0.03;
const LAST_BACKGROUND_KEY = 'qollect-history-editor-last-background';
const CARD_BACKGROUND_ID_SET = new Set(CARD_BACKGROUND_PRESETS.map((preset) => preset.id));

function resolveEffectiveTheme(themeMode) {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const parseErrorMessage = (error) => {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
  return String(error || '');
};

const normalizeNote = (value) => {
  if (typeof value !== 'string') return null;
  return value.trim() ? value : null;
};

const clampGlassOpacity = (value) => Math.min(Math.max(value, GLASS_MIN), GLASS_MAX);

const normalizeBackgroundId = (value) => (
  typeof value === 'string' && CARD_BACKGROUND_ID_SET.has(value)
    ? value
    : 'default'
);

const readLastBackgroundId = () => {
  try {
    return normalizeBackgroundId(localStorage.getItem(LAST_BACKGROUND_KEY));
  } catch {
    return 'default';
  }
};

const saveLastBackgroundId = (backgroundId) => {
  try {
    localStorage.setItem(LAST_BACKGROUND_KEY, normalizeBackgroundId(backgroundId));
  } catch {
    // ignore
  }
};

const hasMetadataBackgroundOverride = (metadataStr) => {
  if (!metadataStr || typeof metadataStr !== 'string') return false;
  try {
    const parsed = JSON.parse(metadataStr);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return Object.prototype.hasOwnProperty.call(parsed, CARD_BACKGROUND_METADATA_KEY);
  } catch {
    return false;
  }
};

function HistoryEditorWindow() {
  const { t } = useTranslation();
  const appWindowRef = useRef(getCurrentWindow());
  const appWindow = appWindowRef.current;
  const colorPanelRef = useRef(null);
  const saveTimerRef = useRef(null);
  const saveStateTimerRef = useRef(null);
  const allowCloseRef = useRef(false);
  const savingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const closeAfterSaveRef = useRef(false);
  const lastSavedToastAtRef = useRef(0);
  const itemHasCustomBackgroundRef = useRef(false);
  const colorTouchedRef = useRef(false);
  const glassTimerRef = useRef(null);
  const draftRef = useRef({ content: '', note: '', backgroundId: 'default' });
  const persistedRef = useRef({ content: '', note: '', backgroundId: 'default' });
  const readyRef = useRef(false);

  const [item, setItem] = useState(null);
  const [contentDraft, setContentDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [manualTagInput, setManualTagInput] = useState('');
  const [backgroundId, setBackgroundId] = useState('default');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [saveError, setSaveError] = useState('');
  const [isPinned, setIsPinned] = useState(true);
  const [showColorPanel, setShowColorPanel] = useState(false);
  const [glassOpacity, setGlassOpacity] = useState(() => {
    try {
      const raw = Number.parseFloat(localStorage.getItem(GLASS_OPACITY_KEY) || '');
      if (!Number.isFinite(raw)) return GLASS_DEFAULT;
      return clampGlassOpacity(raw);
    } catch {
      return GLASS_DEFAULT;
    }
  });
  const [showGlassIndicator, setShowGlassIndicator] = useState(false);

  const itemId = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('itemId') || '';
    } catch {
      return '';
    }
  }, []);

  const isImageItem = item?.type_ === 'image';
  const isFileItem = item?.type_ === 'file';
  const canEditContent = Boolean(item && !isImageItem && !isFileItem);
  const manualUserTags = useMemo(() => {
    if (!item) return [];
    return getTags(item.tags).filter((tag) => parseSystemTag(tag).kind === 'user');
  }, [item]);

  const activeBackgroundPreset = useMemo(
    () => getCardBackgroundPreset(backgroundId),
    [backgroundId],
  );

  const panelStyle = useMemo(() => {
    const baseStyle = {
      '--history-editor-window-opacity': glassOpacity,
    };
    if (activeBackgroundPreset.id === 'default' || !activeBackgroundPreset.accent) {
      return baseStyle;
    }
    return {
      ...baseStyle,
      '--history-editor-accent': activeBackgroundPreset.accent,
      '--history-editor-bg': `color-mix(in srgb, ${activeBackgroundPreset.accent} 14%, rgba(var(--bg-card-rgb), 1) 86%)`,
    };
  }, [activeBackgroundPreset, glassOpacity]);

  const markSaved = useCallback(({ forceVisible = false } = {}) => {
    const now = Date.now();
    const canShowSavedState = forceVisible
      || (now - lastSavedToastAtRef.current) >= SAVE_SUCCESS_TOAST_COOLDOWN_MS;

    if (saveStateTimerRef.current) {
      window.clearTimeout(saveStateTimerRef.current);
    }

    if (!canShowSavedState) {
      setSaveState('idle');
      saveStateTimerRef.current = null;
      return;
    }

    lastSavedToastAtRef.current = now;
    setSaveState('saved');
    saveStateTimerRef.current = window.setTimeout(() => {
      setSaveState('idle');
      saveStateTimerRef.current = null;
    }, SAVE_SUCCESS_TOAST_VISIBLE_MS);
  }, []);

  const requestClose = useCallback(async () => {
    if (allowCloseRef.current) return;
    allowCloseRef.current = true;
    try {
      await appWindow.close();
    } catch (error) {
      allowCloseRef.current = false;
      console.error('Failed to close history editor window:', error);
    }
  }, [appWindow]);

  const hasUnsavedChanges = useCallback(() => {
    const draft = draftRef.current;
    const persisted = persistedRef.current;
    return (
      draft.content !== persisted.content
      || draft.note !== persisted.note
      || draft.backgroundId !== persisted.backgroundId
    );
  }, []);

  const loadItem = useCallback(async () => {
    if (!itemId) {
      readyRef.current = false;
      setLoading(false);
      setLoadError(t('historyEditor.missingItemId'));
      return;
    }

    setLoading(true);
    setLoadError('');

    try {
      const fetched = await invoke('get_item_by_id', { id: itemId });
      if (!fetched) {
        readyRef.current = false;
        setItem(null);
        setLoadError(t('historyEditor.itemNotFound'));
        setLoading(false);
        return;
      }

      const nextContent = fetched.content || '';
      const nextNote = fetched.user_note || '';
      const metadataBackgroundId = getCardBackgroundIdFromMetadata(fetched.metadata);
      const hasBackgroundOverride = hasMetadataBackgroundOverride(fetched.metadata);
      const lastBackgroundId = readLastBackgroundId();
      const nextBackgroundId = hasBackgroundOverride ? metadataBackgroundId : lastBackgroundId;

      setItem(fetched);
      setContentDraft(nextContent);
      setNoteDraft(nextNote);
      setBackgroundId(nextBackgroundId);
      itemHasCustomBackgroundRef.current = hasBackgroundOverride;
      colorTouchedRef.current = false;
      draftRef.current = {
        content: nextContent,
        note: nextNote,
        backgroundId: nextBackgroundId,
      };
      persistedRef.current = {
        content: nextContent,
        note: nextNote,
        backgroundId: nextBackgroundId,
      };
      readyRef.current = true;
      setLoading(false);
    } catch (error) {
      readyRef.current = false;
      setLoadError(t('historyEditor.loadFailed', { error: parseErrorMessage(error) }));
      setLoading(false);
    }
  }, [itemId, t]);

  const persistDraft = useCallback(async ({ force = false, closeAfterSave = false } = {}) => {
    if (closeAfterSave) {
      closeAfterSaveRef.current = true;
    }

    if (!readyRef.current || !itemId) {
      if (closeAfterSaveRef.current) {
        closeAfterSaveRef.current = false;
        await requestClose();
      }
      return;
    }

    if (savingRef.current) {
      saveQueuedRef.current = true;
      return;
    }

    if (!force && !hasUnsavedChanges()) {
      if (closeAfterSaveRef.current) {
        closeAfterSaveRef.current = false;
        await requestClose();
      }
      return;
    }

    savingRef.current = true;
    setSaveState('saving');
    setSaveError('');

    let saveSucceeded = false;

    try {
      const latest = await invoke('get_item_by_id', { id: itemId });
      if (!latest) {
        throw new Error(t('historyEditor.itemNotFound'));
      }

      const draft = draftRef.current;
      let backgroundForSave = draft.backgroundId;
      if (!colorTouchedRef.current && !itemHasCustomBackgroundRef.current) {
        backgroundForSave = getCardBackgroundIdFromMetadata(latest.metadata);
      }
      const mergedMetadata = withCardBackgroundInMetadata(latest.metadata, backgroundForSave);
      const nextNote = normalizeNote(draft.note);
      const nextContent = canEditContent ? draft.content : (latest.content || '');
      const contentChanged = canEditContent && (nextContent || '') !== (latest.content || '');
      const noteChanged = (nextNote || '') !== (latest.user_note || '');
      const metadataChanged = (mergedMetadata || null) !== (latest.metadata || null);

      if (contentChanged || noteChanged || metadataChanged) {
        const updatedItem = {
          ...latest,
          content: canEditContent ? nextContent : latest.content,
          content_updated: contentChanged,
          user_note: nextNote,
          metadata: mergedMetadata,
          updated_at: Math.floor(Date.now() / 1000),
        };
        await invoke('update_item', { item: updatedItem });
        setItem(updatedItem);
        await emit('clipboard-changed').catch(() => {});
      }

      persistedRef.current = {
        content: draft.content,
        note: draft.note,
        backgroundId: draft.backgroundId,
      };
      if (colorTouchedRef.current) {
        itemHasCustomBackgroundRef.current = backgroundForSave !== 'default';
        colorTouchedRef.current = false;
      }
      saveSucceeded = true;
      markSaved();
    } catch (error) {
      const message = parseErrorMessage(error);
      setSaveState('error');
      setSaveError(message);
      console.error('history editor autosave failed:', error);
    } finally {
      savingRef.current = false;

      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        await persistDraft({ force: false, closeAfterSave: closeAfterSaveRef.current });
        return;
      }

      if (closeAfterSaveRef.current && (saveSucceeded || !hasUnsavedChanges())) {
        closeAfterSaveRef.current = false;
        await requestClose();
      }
      if (closeAfterSaveRef.current && !saveSucceeded) {
        // Never keep the user trapped in the editor when autosave fails.
        closeAfterSaveRef.current = false;
        await requestClose();
      }
    }
  }, [canEditContent, hasUnsavedChanges, itemId, markSaved, requestClose, t]);

  useEffect(() => {
    draftRef.current = {
      content: contentDraft,
      note: noteDraft,
      backgroundId,
    };
  }, [contentDraft, noteDraft, backgroundId]);

  useEffect(() => {
    let unmounted = false;

    const init = async () => {
      try {
        await appWindow.setAlwaysOnTop(true);
      } catch (error) {
        console.error('Failed to set history editor always on top:', error);
      }

      if (!unmounted) {
        setIsPinned(true);
      }

      try {
        const config = await invoke('get_general_config');
        const mode = resolveEffectiveTheme(config?.theme_mode || 'system');
        document.documentElement.classList.toggle('dark-mode', mode === 'dark');
      } catch {
        document.documentElement.classList.remove('dark-mode');
      }
    };

    init();
    void loadItem();

    return () => {
      unmounted = true;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (saveStateTimerRef.current) {
        window.clearTimeout(saveStateTimerRef.current);
      }
      if (glassTimerRef.current) {
        window.clearTimeout(glassTimerRef.current);
      }
    };
  }, [appWindow, loadItem]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--history-editor-window-opacity',
      String(glassOpacity),
    );
  }, [glassOpacity]);

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

  useEffect(() => {
    let unlistenCloseRequested = null;

    appWindow.onCloseRequested((event) => {
      if (allowCloseRef.current) return;
      if (savingRef.current || hasUnsavedChanges()) {
        event.preventDefault?.();
        void persistDraft({ force: true, closeAfterSave: true });
      }
    }).then((unlisten) => {
      unlistenCloseRequested = unlisten;
    }).catch((error) => {
      console.error('Failed to bind history editor close guard:', error);
    });

    return () => {
      if (typeof unlistenCloseRequested === 'function') {
        unlistenCloseRequested();
      }
    };
  }, [appWindow, hasUnsavedChanges, persistDraft]);

  useEffect(() => {
    if (!readyRef.current || !item) return undefined;
    if (!hasUnsavedChanges()) return undefined;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void persistDraft();
      saveTimerRef.current = null;
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [backgroundId, contentDraft, hasUnsavedChanges, item, noteDraft, persistDraft]);

  const handleTogglePin = useCallback(async () => {
    const next = !isPinned;
    try {
      await appWindow.setAlwaysOnTop(next);
      setIsPinned(next);
    } catch (error) {
      console.error('Failed to toggle history editor pin:', error);
    }
  }, [appWindow, isPinned]);

  const imageSrc = useMemo(() => {
    if (!item || item.type_ !== 'image') return '';
    return getImageOriginal(item.image_paths);
  }, [item]);

  const handleHeaderWheel = useCallback((event) => {
    event.preventDefault();
    setGlassOpacity((prev) => {
      const delta = event.deltaY > 0 ? -GLASS_STEP : GLASS_STEP;
      const next = clampGlassOpacity(Math.round((prev + delta) * 100) / 100);
      try {
        localStorage.setItem(GLASS_OPACITY_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
    setShowGlassIndicator(true);
    if (glassTimerRef.current) {
      window.clearTimeout(glassTimerRef.current);
    }
    glassTimerRef.current = window.setTimeout(() => {
      setShowGlassIndicator(false);
      glassTimerRef.current = null;
    }, 900);
  }, []);

  const handleAddManualTag = useCallback(async () => {
    const normalizedTag = typeof manualTagInput === 'string' ? manualTagInput.trim() : '';
    if (!normalizedTag || !item || !itemId) return;

    if (hasReservedTagPrefix(normalizedTag)) {
      setSaveState('error');
      setSaveError(t('multiSelect.addTagReservedPrefix'));
      return;
    }

    setSaveState('saving');
    setSaveError('');

    try {
      const latest = await invoke('get_item_by_id', { id: itemId });
      if (!latest) {
        throw new Error(t('historyEditor.itemNotFound'));
      }

      const existingTags = getTags(latest.tags);
      if (existingTags.includes(normalizedTag)) {
        setSaveState('error');
        setSaveError(t('historyEditor.tagExists'));
        return;
      }

      const updatedItem = {
        ...latest,
        tags: JSON.stringify([...existingTags, normalizedTag]),
        updated_at: Math.floor(Date.now() / 1000),
      };

      await invoke('update_item', { item: updatedItem });
      setItem(updatedItem);
      setManualTagInput('');
      await emit('clipboard-changed').catch(() => {});
      markSaved({ forceVisible: true });
    } catch (error) {
      const message = parseErrorMessage(error);
      setSaveState('error');
      setSaveError(message);
      console.error('history editor add tag failed:', error);
    }
  }, [item, itemId, manualTagInput, markSaved, t]);

  const handleRemoveManualTag = useCallback(async (tagToRemove) => {
    const normalizedTag = typeof tagToRemove === 'string' ? tagToRemove.trim() : '';
    if (!normalizedTag || !item || !itemId) return;

    setSaveState('saving');
    setSaveError('');

    try {
      const latest = await invoke('get_item_by_id', { id: itemId });
      if (!latest) {
        throw new Error(t('historyEditor.itemNotFound'));
      }

      const existingTags = getTags(latest.tags);
      const nextTags = existingTags.filter((tag) => tag !== normalizedTag);
      if (nextTags.length === existingTags.length) {
        setSaveState('error');
        setSaveError(t('historyEditor.tagNotFound'));
        return;
      }

      const updatedItem = {
        ...latest,
        tags: JSON.stringify(nextTags),
        updated_at: Math.floor(Date.now() / 1000),
      };

      await invoke('update_item', { item: updatedItem });
      setItem(updatedItem);
      await emit('clipboard-changed').catch(() => {});
      markSaved({ forceVisible: true });
    } catch (error) {
      const message = parseErrorMessage(error);
      setSaveState('error');
      setSaveError(message);
      console.error('history editor remove tag failed:', error);
    }
  }, [item, itemId, markSaved, t]);

  const saveStatusText = useMemo(() => {
    if (saveState === 'saving') return t('historyEditor.statusSaving');
    if (saveState === 'saved') return t('historyEditor.statusSaved');
    if (saveState === 'error') {
      return t('historyEditor.statusError', { error: saveError || t('historyEditor.unknownError') });
    }
    return '';
  }, [saveError, saveState, t]);

  return (
    <div className="history-editor-shell" style={panelStyle}>
      <header className="history-editor-header" data-tauri-drag-region onWheel={handleHeaderWheel}>
        <div className="history-editor-header-left" data-tauri-drag-region>
          <span className="history-editor-title">{t('historyEditor.title')}</span>
        </div>
        {showGlassIndicator && (
          <div className="history-editor-glass-indicator" data-tauri-drag-region>
            {Math.round(glassOpacity * 100)}%
          </div>
        )}
        <div className="history-editor-header-actions" data-tauri-drag-region>
          <div
            className={`history-editor-color-panel-wrap ${showColorPanel ? 'open' : ''}`}
            ref={colorPanelRef}
            data-tauri-drag-region="false"
          >
            <button
              className={`history-editor-icon-btn ${showColorPanel ? 'active' : ''}`}
              data-tauri-drag-region="false"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setShowColorPanel(prev => !prev)}
              title={t('item.cardBackground.button')}
            >
              <Palette size={14} />
            </button>
            {showColorPanel && (
              <div className="history-editor-colors">
                {CARD_BACKGROUND_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className={`history-editor-color-dot ${backgroundId === preset.id ? 'active' : ''}`}
                    style={{ '--dot-color': preset.dot }}
                    title={t(preset.labelKey)}
                    onClick={() => {
                      colorTouchedRef.current = true;
                      saveLastBackgroundId(preset.id);
                      setBackgroundId(preset.id);
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
            className={`history-editor-icon-btn ${isPinned ? 'active' : ''}`}
            data-tauri-drag-region="false"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleTogglePin}
            title={isPinned ? t('titlebar.unpin') : t('titlebar.pin')}
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            className="history-editor-icon-btn danger"
            data-tauri-drag-region="false"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => {
              void persistDraft({ force: true, closeAfterSave: true });
            }}
            title={t('titlebar.close')}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <main className={`history-editor-body ${canEditContent ? 'content-heavy' : 'note-focus'}`}>
        {loading && (
          <div className="history-editor-state">{t('historyEditor.loading')}</div>
        )}

        {!loading && loadError && (
          <div className="history-editor-state error">{loadError}</div>
        )}

        {!loading && !loadError && isFileItem && (
          <div className="history-editor-state">{t('historyEditor.fileUnsupported')}</div>
        )}

        {!loading && !loadError && item && !isFileItem && (
          <>
            {isImageItem ? (
              <section className="history-editor-section image">
                <div className="history-editor-image-stage">
                  {imageSrc ? (
                    <img src={imageSrc} alt={t('historyEditor.imageAlt')} />
                  ) : (
                    <div className="history-editor-state inline">{t('historyEditor.imageUnavailable')}</div>
                  )}
                </div>
              </section>
            ) : (
              <section className="history-editor-section">
                <textarea
                  id="history-editor-content"
                  className="history-editor-textarea content"
                  value={contentDraft}
                  onChange={(event) => setContentDraft(event.target.value)}
                  placeholder={t('historyEditor.contentPlaceholder')}
                />
              </section>
            )}

            <section className="history-editor-section note">
              <textarea
                id="history-editor-note"
                className="history-editor-textarea note"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder={t('edit.notePlaceholder')}
                rows={2}
              />
            </section>

            <section className="history-editor-section tags" data-tauri-drag-region="false">
              <div className="history-editor-tags-list">
                {manualUserTags.map((tag, index) => (
                  <span key={`${tag}-${index}`} className="history-editor-tag-chip">
                    <span className="history-editor-tag-chip-text">{tag}</span>
                    <button
                      type="button"
                      className="history-editor-tag-chip-remove"
                      onClick={() => {
                        void handleRemoveManualTag(tag);
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      title={t('historyEditor.removeTag')}
                      data-tauri-drag-region="false"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="history-editor-tag-input-row">
                <input
                  type="text"
                  className="history-editor-tag-input"
                  value={manualTagInput}
                  onChange={(event) => setManualTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleAddManualTag();
                    }
                  }}
                  placeholder={t('historyEditor.tagPlaceholder')}
                  data-tauri-drag-region="false"
                />
                <button
                  type="button"
                  className="history-editor-tag-add-btn"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    void handleAddManualTag();
                  }}
                  disabled={!manualTagInput.trim()}
                  title={t('historyEditor.addTag')}
                  data-tauri-drag-region="false"
                >
                  <Plus size={13} />
                </button>
              </div>
            </section>
          </>
        )}
      </main>

      {saveStatusText && (
        <footer className={`history-editor-footer ${saveState}`}>
          {saveState === 'saved' && <Check size={13} />}
          <span>{saveStatusText}</span>
        </footer>
      )}
    </div>
  );
}

export default HistoryEditorWindow;

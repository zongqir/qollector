import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { applyAccentColor } from '../../hooks/useTheme';
import useAppStore from '../../store/useAppStore';

const ACCENT_PRESETS = [
  { key: 'blue',     light: '#007aff', dark: '#0a84ff' },
  { key: 'purple',   light: '#af52de', dark: '#bf5af2' },
  { key: 'pink',     light: '#ff2d55', dark: '#ff375f' },
  { key: 'red',      light: '#ff3b30', dark: '#ff453a' },
  { key: 'orange',   light: '#ff9500', dark: '#ff9f0a' },
  { key: 'yellow',   light: '#ffcc00', dark: '#ffd60a' },
  { key: 'green',    light: '#34c759', dark: '#30d158' },
  { key: 'graphite', light: '#8e8e93', dark: '#98989d' },
];

function detectClientPlatform() {
  if (typeof navigator === 'undefined') return 'other';
  const raw = (
    navigator.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent
    || ''
  ).toLowerCase();
  if (raw.includes('win')) return 'windows';
  if (raw.includes('mac')) return 'macos';
  if (raw.includes('linux')) return 'linux';
  return 'other';
}

function GeneralSection({
  t,
  i18nLanguage,
  changeLanguage,
  generalConfig,
  setGeneralConfig,
  onThemeModeChange,
  getWheelNextNumber,
}) {
  const [startupViewFeedback, setStartupViewFeedback] = useState(null);
  const [clearRecentDayPending, setClearRecentDayPending] = useState(false);
  const startupViewFeedbackTimerRef = useRef(null);
  const supportsAutoPasteOnDoubleClick = detectClientPlatform() === 'windows';
  const supportsCopyOnSelect = detectClientPlatform() === 'windows';

  useEffect(() => () => {
    if (startupViewFeedbackTimerRef.current) {
      clearTimeout(startupViewFeedbackTimerRef.current);
    }
  }, []);

  const showStartupViewFeedback = (feedback, durationMs = 1800) => {
    setStartupViewFeedback(feedback);
    if (startupViewFeedbackTimerRef.current) {
      clearTimeout(startupViewFeedbackTimerRef.current);
    }
    if (durationMs > 0) {
      startupViewFeedbackTimerRef.current = setTimeout(() => {
        setStartupViewFeedback(null);
      }, durationMs);
    }
  };

  const isCalmPresetActive = generalConfig.startup_favorites_view_enabled
    && generalConfig.auto_cleanup_enabled
    && Number(generalConfig.cleanup_max_age_days) === 7
    && Number(generalConfig.cleanup_max_items) === 1000;

  return (
    <div className="settings-content">
      <div className="setting-group">
        <div className="sg-row">
          <span>{t('settings.general.language')}</span>
          <select
            value={i18nLanguage}
            onChange={(e) => changeLanguage(e.target.value)}
            className="setting-select"
          >
            <option value="zh-CN">{t('aiAssistant.language.zh-CN')}</option>
            <option value="en-US">{t('aiAssistant.language.en-US')}</option>
          </select>
        </div>
        <div className="sg-row">
          <span>{t('settings.general.theme')}</span>
          <select
            value={generalConfig.theme_mode || 'system'}
            onChange={async (e) => {
              const newMode = e.target.value;
              const updated = { ...generalConfig, theme_mode: newMode };
              setGeneralConfig(updated);
              if (onThemeModeChange) onThemeModeChange(newMode);
              try {
                await invoke('update_general_config', { config: updated });
              } catch (error) {
                console.error('Failed to save theme config:', error);
              }
            }}
            className="setting-select"
          >
            <option value="system">{t('settings.general.themeSystem')}</option>
            <option value="light">{t('settings.general.themeLight')}</option>
            <option value="dark">{t('settings.general.themeDark')}</option>
          </select>
        </div>
        <div className="sg-row" style={{ alignItems: 'center' }}>
          <span>{t('settings.general.accentColor')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {ACCENT_PRESETS.map((preset) => {
              const isDark = document.documentElement.classList.contains('dark-mode');
              const color = isDark ? preset.dark : preset.light;
              const isActive = (generalConfig.accent_color || 'blue') === preset.key;
              return (
                <button
                  key={preset.key}
                  title={t(`settings.general.accent.${preset.key}`)}
                  aria-label={t(`settings.general.accent.${preset.key}`)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: isActive ? '2px solid var(--text-primary)' : '2px solid transparent',
                    background: color,
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'border-color 0.15s ease, transform 0.15s ease',
                    transform: isActive ? 'scale(1.15)' : 'scale(1)',
                  }}
                  onClick={async () => {
                    const updated = { ...generalConfig, accent_color: preset.key };
                    setGeneralConfig(updated);
                    applyAccentColor(preset.key);
                    try {
                      await invoke('update_general_config', { config: updated });
                    } catch (error) {
                      console.error('Failed to save accent color:', error);
                    }
                  }}
                >
                  {isActive && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5.5L4 7.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="sg-row">
          <span>{t('settings.general.startupDefaultView')}</span>
          <select
            value={generalConfig.startup_favorites_view_enabled ? 'favorites' : 'all'}
            onChange={async (e) => {
              const enableFavorites = e.target.value === 'favorites';
              const updated = {
                ...generalConfig,
                startup_favorites_view_enabled: enableFavorites,
              };
              setGeneralConfig(updated);
              useAppStore.setState({ startupFavoritesViewEnabled: enableFavorites });
              try {
                await invoke('update_general_config', { config: updated });
              } catch (error) {
                console.error('Failed to save startup default view config:', error);
                showStartupViewFeedback({
                  type: 'error',
                  message: t('settings.general.startupDefaultViewSaveFailed'),
                }, 2600);
              }
            }}
            className="setting-select"
          >
            <option value="all">{t('settings.general.startupDefaultViewAll')}</option>
            <option value="favorites">{t('settings.general.startupDefaultViewFavorites')}</option>
          </select>
        </div>
        <small className="setting-hint setting-hint-inline">
          {t('settings.general.startupDefaultViewHint')}
        </small>
        {generalConfig.startup_favorites_view_enabled && (
          <div className="sg-row sg-row-stack">
            <span>{t('settings.general.calmPresetTitle')}</span>
            <small className="setting-hint setting-hint-inline">
              {t('settings.general.calmPresetHint')}
            </small>
            <div className="setting-action-row">
              <button
                type="button"
                className="test-btn"
                onClick={async () => {
                  const updated = isCalmPresetActive
                    ? {
                      ...generalConfig,
                      startup_favorites_view_enabled: false,
                    }
                    : {
                      ...generalConfig,
                      startup_favorites_view_enabled: true,
                      auto_cleanup_enabled: true,
                      cleanup_max_age_days: 7,
                      cleanup_max_items: 1000,
                    };
                  setGeneralConfig(updated);
                  useAppStore.setState({
                    startupFavoritesViewEnabled: Boolean(updated.startup_favorites_view_enabled),
                    autoCleanupEnabled: updated.auto_cleanup_enabled !== false,
                    cleanupMaxAgeDays: Math.max(1, Number(updated.cleanup_max_age_days || 90)),
                    cleanupMaxItems: Math.max(100, Number(updated.cleanup_max_items || 50000)),
                  });
                  try {
                    await invoke('update_general_config', { config: updated });
                    showStartupViewFeedback({
                      type: 'success',
                      message: isCalmPresetActive
                        ? t('settings.general.calmPresetDisabled')
                        : t('settings.general.calmPresetApplied'),
                    });
                  } catch (error) {
                    console.error('Failed to save calm preset config:', error);
                    showStartupViewFeedback({
                      type: 'error',
                      message: t('settings.general.calmPresetApplyFailed'),
                    }, 2600);
                  }
                }}
              >
                {isCalmPresetActive
                  ? t('settings.general.calmPresetDisableAction')
                  : t('settings.general.calmPresetAction')}
              </button>
              <button
                type="button"
                className="test-btn secondary"
                disabled={clearRecentDayPending}
                onClick={async () => {
                  setClearRecentDayPending(true);
                  try {
                    const deleted = await invoke('clear_recent_day_data');
                    await useAppStore.getState().loadItems();
                    showStartupViewFeedback({
                      type: 'success',
                      message: t('settings.general.clearRecentDaySuccess', { count: deleted }),
                    });
                  } catch (error) {
                    console.error('Failed to clear recent day data:', error);
                    showStartupViewFeedback({
                      type: 'error',
                      message: t('settings.general.clearRecentDayFailed'),
                    }, 2600);
                  } finally {
                    setClearRecentDayPending(false);
                  }
                }}
              >
                {clearRecentDayPending
                  ? t('settings.general.clearRecentDayPending')
                  : t('settings.general.clearRecentDayAction')}
              </button>
            </div>
          </div>
        )}
      </div>
      {startupViewFeedback && (
        <small
          className={`setting-status setting-status-emphasis ${startupViewFeedback.type === 'error' ? 'error' : 'success'}`}
          role={startupViewFeedback.type === 'error' ? 'alert' : 'status'}
        >
          {startupViewFeedback.message}
        </small>
      )}

      <div className="setting-group" style={{ marginTop: 8 }}>
        <div className="sg-row">
          <span>{t('settings.general.startTour')}</span>
          <button
            style={{
              padding: '5px 14px',
              border: 'none',
              borderRadius: 6,
              background: '#3b82f6',
              color: '#fff',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            onClick={() => {
              const { setShowSettings, startTour } = useAppStore.getState();
              setShowSettings(false);
              setTimeout(() => startTour(), 300);
            }}
          >
            {t('settings.general.startTour')}
          </button>
        </div>
        <small className="setting-hint">{t('settings.general.startTourHint')}</small>
      </div>

      <div className="setting-group-title section-title">{t('settings.general.featureModules')}</div>
      <div className="feature-toggles">
        <label className="setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.general.autoPaste')}</span>
            <span className="toggle-desc">{t('settings.general.autoPasteHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={supportsAutoPasteOnDoubleClick && (generalConfig.auto_paste_on_double_click || false)}
              disabled={!supportsAutoPasteOnDoubleClick}
              onChange={async (e) => {
                if (!supportsAutoPasteOnDoubleClick) return;
                const checked = e.target.checked;
                const updated = { ...generalConfig, auto_paste_on_double_click: checked };
                setGeneralConfig(updated);
                useAppStore.setState({ autoPasteOnDoubleClick: checked });
                try {
                  await invoke('update_general_config', { config: updated });
                } catch (error) {
                  console.error('save auto_paste config failed:', error);
                }
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        <label className="setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.general.copyOnSelect')}</span>
            <span className="toggle-desc">{t('settings.general.copyOnSelectHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={supportsCopyOnSelect && (generalConfig.copy_on_select_enabled || false)}
              disabled={!supportsCopyOnSelect}
              onChange={async (e) => {
                if (!supportsCopyOnSelect) return;
                const checked = e.target.checked;
                const updated = { ...generalConfig, copy_on_select_enabled: checked };
                setGeneralConfig(updated);
                useAppStore.setState({ copyOnSelectEnabled: checked });
                try {
                  await invoke('update_general_config', { config: updated });
                } catch (error) {
                  console.error('save copy_on_select config failed:', error);
                }
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        {supportsCopyOnSelect && generalConfig.copy_on_select_enabled && (
          <>
            <label className="setting-toggle-row" style={{ paddingLeft: 24, borderLeft: '2px solid var(--accent-color, #3b82f6)' }}>
              <span className="toggle-label-group">
                <span className="toggle-label">{t('settings.general.copyOnSelectDoubleClick')}</span>
                <span className="toggle-desc">{t('settings.general.copyOnSelectDoubleClickHint')}</span>
              </span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={generalConfig.copy_on_select_double_click_enabled !== false}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    const updated = { ...generalConfig, copy_on_select_double_click_enabled: checked };
                    setGeneralConfig(updated);
                    useAppStore.setState({ copyOnSelectDoubleClickEnabled: checked });
                    try {
                      await invoke('update_general_config', { config: updated });
                    } catch (error) {
                      console.error('save copy_on_select_double_click config failed:', error);
                    }
                  }}
                />
                <span className="toggle-slider" />
              </span>
            </label>
            <label className="setting-toggle-row" style={{ paddingLeft: 24, borderLeft: '2px solid var(--accent-color, #3b82f6)' }}>
              <span className="toggle-label-group">
                <span className="toggle-label">{t('settings.general.copyOnSelectSmartReplace')}</span>
                <span className="toggle-desc">{t('settings.general.copyOnSelectSmartReplaceHint')}</span>
              </span>
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={generalConfig.copy_on_select_smart_replace_enabled !== false}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    const updated = { ...generalConfig, copy_on_select_smart_replace_enabled: checked };
                    setGeneralConfig(updated);
                    useAppStore.setState({ copyOnSelectSmartReplaceEnabled: checked });
                    try {
                      await invoke('update_general_config', { config: updated });
                    } catch (error) {
                      console.error('save copy_on_select_smart_replace config failed:', error);
                    }
                  }}
                />
                <span className="toggle-slider" />
              </span>
            </label>
          </>
        )}
        <label className="setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.general.copyQollectSourceItems')}</span>
            <span className="toggle-desc">{t('settings.general.copyQollectSourceItemsHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={generalConfig.copy_qollect_source_items || false}
              onChange={async (e) => {
                const checked = e.target.checked;
                const updated = { ...generalConfig, copy_qollect_source_items: checked };
                setGeneralConfig(updated);
                useAppStore.setState({ copyQollectSourceItems: checked });
                try {
                  await invoke('update_general_config', { config: updated });
                } catch (error) {
                  console.error('save copy_qollect_source_items config failed:', error);
                }
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        <label className="setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.general.filterNoiseDigits')}</span>
            <span className="toggle-desc">{t('settings.general.filterNoiseDigitsHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={generalConfig.filter_noise_digits_enabled !== false}
              onChange={async (e) => {
                const checked = e.target.checked;
                const updated = { ...generalConfig, filter_noise_digits_enabled: checked };
                setGeneralConfig(updated);
                useAppStore.setState({ filterNoiseDigitsEnabled: checked });
                try {
                  await invoke('update_general_config', { config: updated });
                } catch (error) {
                  console.error('save filter_noise_digits config failed:', error);
                }
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        <label className="setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.general.autostart')}</span>
            <span className="toggle-desc">{t('settings.general.autostartHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={generalConfig.autostart_enabled || false}
              onChange={async (e) => {
                const checked = e.target.checked;
                const updated = { ...generalConfig, autostart_enabled: checked };
                setGeneralConfig(updated);
                try {
                  await invoke('update_general_config', { config: updated });
                } catch (error) {
                  console.error('save autostart config failed:', error);
                }
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
      </div>
    </div>
  );
}

export default GeneralSection;

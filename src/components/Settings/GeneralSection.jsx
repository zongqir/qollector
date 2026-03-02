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
  const [maxPinnedFeedback, setMaxPinnedFeedback] = useState(null);
  const maxPinnedFeedbackTimerRef = useRef(null);
  const supportsAutoPasteOnDoubleClick = detectClientPlatform() === 'windows';

  useEffect(() => () => {
    if (maxPinnedFeedbackTimerRef.current) {
      clearTimeout(maxPinnedFeedbackTimerRef.current);
    }
  }, []);

  const showMaxPinnedFeedback = (feedback, durationMs = 1800) => {
    setMaxPinnedFeedback(feedback);
    if (maxPinnedFeedbackTimerRef.current) {
      clearTimeout(maxPinnedFeedbackTimerRef.current);
    }
    if (durationMs > 0) {
      maxPinnedFeedbackTimerRef.current = setTimeout(() => {
        setMaxPinnedFeedback(null);
      }, durationMs);
    }
  };

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
          <span>{t('settings.general.maxPinnedItems')}</span>
          <input
            type="number"
            value={generalConfig.max_pinned_items}
            onChange={async (e) => {
              const currentValue = generalConfig.max_pinned_items ?? 10;
              let value = parseInt(e.target.value, 10) || 10;
              if (value < 1) value = 1;
              if (value > 100) value = 100;
              if (value === currentValue) return;
              const updated = { ...generalConfig, max_pinned_items: value };
              setGeneralConfig(updated);
              try {
                await invoke('update_general_config', { config: updated });
                showMaxPinnedFeedback({
                  type: 'success',
                  message: t('settings.general.maxPinnedItemsApplied', { count: value }),
                });
              } catch (error) {
                console.error('Failed to save max pinned items config:', error);
                showMaxPinnedFeedback({
                  type: 'error',
                  message: t('settings.general.maxPinnedItemsSaveFailed'),
                }, 2600);
              }
            }}
            onWheel={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const currentValue = generalConfig.max_pinned_items ?? 10;
              const value = getWheelNextNumber({
                rawValue: e.currentTarget.value,
                fallback: currentValue,
                min: 1,
                max: 100,
                deltaY: e.deltaY,
              });
              if (value === currentValue) return;
              const updated = { ...generalConfig, max_pinned_items: value };
              setGeneralConfig(updated);
              try {
                await invoke('update_general_config', { config: updated });
                showMaxPinnedFeedback({
                  type: 'success',
                  message: t('settings.general.maxPinnedItemsApplied', { count: value }),
                });
              } catch (error) {
                console.error('Failed to save max pinned items config:', error);
                showMaxPinnedFeedback({
                  type: 'error',
                  message: t('settings.general.maxPinnedItemsSaveFailed'),
                }, 2600);
              }
            }}
            min="1"
            max="100"
            className="setting-input-small setting-input-count"
          />
        </div>
      </div>
      {maxPinnedFeedback && (
        <small
          className={`setting-status setting-status-emphasis ${maxPinnedFeedback.type === 'error' ? 'error' : 'success'}`}
          role={maxPinnedFeedback.type === 'error' ? 'alert' : 'status'}
        >
          {maxPinnedFeedback.message}
        </small>
      )}
      {generalConfig.max_pinned_items > 20 && (
        <small className="setting-hint">
          <span className="setting-warning">
            {t('settings.general.maxPinnedItemsWarning')}
          </span>
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
            <span className="toggle-title-inline">
              <span className="toggle-label">{t('settings.general.enableWidget')}</span>
              <span className="beta-badge">{t('settings.general.betaBadge')}</span>
            </span>
            <span className="toggle-desc">{t('settings.general.enableWidgetHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={generalConfig.widget_enabled || false}
              onChange={async (e) => {
                const checked = e.target.checked;
                const updated = { ...generalConfig, widget_enabled: checked };
                setGeneralConfig(updated);
                useAppStore.setState({ widgetEnabled: checked });
                try {
                  await invoke('update_general_config', { config: updated });
                } catch (error) {
                  console.error('save widget_enabled config failed:', error);
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
        <label className="setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.general.lowMemoryMode')}</span>
            <span className="toggle-desc">{t('settings.general.lowMemoryModeHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={generalConfig.low_memory_mode_enabled || false}
              onChange={async (e) => {
                const checked = e.target.checked;
                const updated = { ...generalConfig, low_memory_mode_enabled: checked };
                setGeneralConfig(updated);
                try {
                  await invoke('update_general_config', { config: updated });
                } catch (error) {
                  console.error('save low_memory_mode config failed:', error);
                }
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
      </div>
      {generalConfig.low_memory_mode_enabled && (
        <small className="setting-hint">
          <span className="setting-warning">{t('settings.general.lowMemoryModeNotice')}</span>
        </small>
      )}
    </div>
  );
}

export default GeneralSection;

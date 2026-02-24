import { invoke } from '@tauri-apps/api/core';
import useAppStore from '../../store/useAppStore';

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
  const supportsAutoPasteOnDoubleClick = detectClientPlatform() === 'windows';

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
        <div className="sg-row">
          <span>{t('settings.general.maxPinnedItems')}</span>
          <input
            type="number"
            value={generalConfig.max_pinned_items}
            onChange={async (e) => {
              let value = parseInt(e.target.value) || 10;
              if (value < 1) value = 1;
              if (value > 100) value = 100;
              const updated = { ...generalConfig, max_pinned_items: value };
              setGeneralConfig(updated);
              try {
                await invoke('update_general_config', { config: updated });
              } catch (error) {
                console.error('Failed to save max pinned items config:', error);
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
              } catch (error) {
                console.error('Failed to save max pinned items config:', error);
              }
            }}
            min="1"
            max="100"
            className="setting-input-small setting-input-count"
          />
        </div>
      </div>
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
            <span className="toggle-label">{t('settings.general.enableWidget')}</span>
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

import { RotateCcw } from 'lucide-react';

function ShortcutsSection({
  t,
  generalConfig,
  setGeneralConfig,
  saveShortcutConfig,
  normalizeShortcutText,
  recordingTarget,
  stopShortcutRecording,
  startShortcutRecording,
  onConfigChange,
  getTagShortcutDisplay,
  shortcutError,
  restoreShortcutDefaults,
  getWheelNextNumber,
}) {
  return (
    <div className="settings-content">
      <div className="setting-group-title section-title">{t('settings.shortcuts.globalHotkeys')}</div>
      <div className="setting-group">
        <label className="sg-row setting-toggle-row">
          <span>{t('settings.shortcuts.toggleWindow')}</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={Boolean(generalConfig.toggle_window_shortcut_enabled)}
              onChange={async (e) => {
                await saveShortcutConfig({
                  ...generalConfig,
                  toggle_window_shortcut_enabled: e.target.checked,
                }, 'toggle_window_shortcut');
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        <div className="sg-row">
          <span>{t('settings.shortcuts.toggleWindowKey')}</span>
          <div className="shortcut-editor">
            <input
              type="text"
              value={generalConfig.toggle_window_shortcut ?? 'alt+x'}
              onChange={(e) => {
                setGeneralConfig({
                  ...generalConfig,
                  toggle_window_shortcut: e.target.value,
                });
              }}
              onBlur={async () => {
                const normalized = normalizeShortcutText(generalConfig.toggle_window_shortcut);
                await saveShortcutConfig({
                  ...generalConfig,
                  toggle_window_shortcut: normalized || 'alt+x',
                }, 'toggle_window_shortcut');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              className="shortcut-input"
              disabled={recordingTarget === 'toggle_window_shortcut'}
            />
            <button
              type="button"
              className={`shortcut-record-btn ${recordingTarget === 'toggle_window_shortcut' ? 'recording' : ''}`}
              onClick={() => {
                if (recordingTarget === 'toggle_window_shortcut') {
                  stopShortcutRecording();
                } else {
                  startShortcutRecording('toggle_window_shortcut');
                }
              }}
            >
              {recordingTarget === 'toggle_window_shortcut'
                ? t('settings.shortcuts.stopRecording')
                : t('settings.shortcuts.startRecording')}
            </button>
          </div>
        </div>
        <label className="sg-row setting-toggle-row">
          <span>{t('settings.shortcuts.ctrlShiftC')}</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={Boolean(generalConfig.ctrl_shift_c_shortcut_enabled)}
              onChange={async (e) => {
                await saveShortcutConfig({
                  ...generalConfig,
                  ctrl_shift_c_shortcut_enabled: e.target.checked,
                }, 'copy_pin_shortcut');
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        <div className="sg-row">
          <span>{t('settings.shortcuts.ctrlShiftCKey')}</span>
          <div className="shortcut-editor">
            <input
              type="text"
              value={generalConfig.copy_pin_shortcut ?? 'ctrl+shift+c'}
              onChange={(e) => {
                setGeneralConfig({
                  ...generalConfig,
                  copy_pin_shortcut: e.target.value,
                });
              }}
              onBlur={async () => {
                const normalized = normalizeShortcutText(generalConfig.copy_pin_shortcut);
                await saveShortcutConfig({
                  ...generalConfig,
                  copy_pin_shortcut: normalized || 'ctrl+shift+c',
                }, 'copy_pin_shortcut');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              className="shortcut-input"
              disabled={recordingTarget === 'copy_pin_shortcut'}
            />
            <button
              type="button"
              className={`shortcut-record-btn ${recordingTarget === 'copy_pin_shortcut' ? 'recording' : ''}`}
              onClick={() => {
                if (recordingTarget === 'copy_pin_shortcut') {
                  stopShortcutRecording();
                } else {
                  startShortcutRecording('copy_pin_shortcut');
                }
              }}
            >
              {recordingTarget === 'copy_pin_shortcut'
                ? t('settings.shortcuts.stopRecording')
                : t('settings.shortcuts.startRecording')}
            </button>
          </div>
        </div>
        <label className="sg-row setting-toggle-row">
          <span>{t('settings.shortcuts.tagQuickAdd')}</span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={Boolean(generalConfig.history_tag_shortcut_enabled)}
              onChange={async (e) => {
                const saved = await saveShortcutConfig({
                  ...generalConfig,
                  history_tag_shortcut_enabled: e.target.checked,
                });
                if (saved && onConfigChange) onConfigChange();
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        <div className="sg-row">
          <span>{t('settings.shortcuts.tagQuickAddKey')}</span>
          <div className="shortcut-editor">
            <input
              type="text"
              value={getTagShortcutDisplay()}
              className="shortcut-input"
              disabled
              readOnly
            />
          </div>
        </div>
      </div>
      {recordingTarget && (
        <small className="setting-hint">{t('settings.shortcuts.recordingHint')}</small>
      )}
      <small className="setting-hint">{t('settings.shortcuts.ctrlShiftCHint')}</small>
      <small className="setting-hint">{t('settings.shortcuts.tagQuickAddHint')}</small>
      <small className="setting-hint">{t('settings.shortcuts.platformNotice')}</small>
      {shortcutError && (
        <small className="setting-hint">
          <span className="setting-warning">{shortcutError}</span>
        </small>
      )}
      <div className="shortcut-actions">
        <button
          type="button"
          className="shortcut-reset-btn"
          onClick={restoreShortcutDefaults}
        >
          <span className="shortcut-reset-btn-icon" aria-hidden="true">
            <RotateCcw size={13} />
          </span>
          {t('settings.shortcuts.restoreDefaults')}
        </button>
      </div>

      <div className="setting-group-title section-title">{t('settings.shortcuts.emphasisCopy')}</div>
      <div className="setting-group">
        <label className="sg-row setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.general.doubleCopyEmphasis')}</span>
            <span className="toggle-desc">{t('settings.general.doubleCopyEmphasisHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={Boolean(generalConfig.double_copy_emphasis_enabled)}
              onChange={async (e) => {
                const updated = {
                  ...generalConfig,
                  double_copy_emphasis_enabled: e.target.checked,
                };
                await saveShortcutConfig(updated);
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        <div className="sg-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.general.doubleCopyWindowMs')}</span>
            <span className="toggle-desc">{t('settings.general.doubleCopyWindowMsHint')}</span>
          </span>
          <input
            type="number"
            value={generalConfig.double_copy_window_ms ?? 900}
            onChange={async (e) => {
              let value = parseInt(e.target.value) || 900;
              if (value < 300) value = 300;
              if (value > 2500) value = 2500;
              const updated = {
                ...generalConfig,
                double_copy_window_ms: value,
              };
              await saveShortcutConfig(updated);
            }}
            onWheel={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const currentValue = generalConfig.double_copy_window_ms ?? 900;
              const value = getWheelNextNumber({
                rawValue: e.currentTarget.value,
                fallback: currentValue,
                min: 300,
                max: 2500,
                step: 50,
                deltaY: e.deltaY,
              });
              if (value === currentValue) return;
              const updated = {
                ...generalConfig,
                double_copy_window_ms: value,
              };
              await saveShortcutConfig(updated);
            }}
            min="300"
            max="2500"
            step="50"
            className="setting-input-small setting-input-interval"
          />
        </div>
      </div>
      <small className="setting-hint">{t('settings.shortcuts.emphasisCopyHint')}</small>
    </div>
  );
}

export default ShortcutsSection;

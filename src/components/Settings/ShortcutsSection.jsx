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
    </div>
  );
}

export default ShortcutsSection;

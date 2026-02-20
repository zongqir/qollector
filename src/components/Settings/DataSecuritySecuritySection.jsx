import { invoke } from '@tauri-apps/api/core';

function DataSecuritySecuritySection({
  t,
  lockHasPassword,
  lockOldPassword,
  setLockOldPassword,
  lockNewPassword,
  setLockNewPassword,
  lockConfirmPassword,
  setLockConfirmPassword,
  lockError,
  setLockError,
  lockSuccess,
  setLockSuccess,
  setLockHasPassword,
}) {
  return (
    <div className="settings-content domain-section">
      <div className="domain-section-header">{t('settings.tabs.security')}</div>
      <small className="setting-hint-block">
        {lockHasPassword ? t('lock.statusEnabled') : t('lock.statusDisabled')}
      </small>

      {lockHasPassword && (
        <div className="setting-password-group with-margin">
          <input
            type="password"
            value={lockOldPassword}
            onChange={(e) => {
              setLockOldPassword(e.target.value);
              setLockError('');
              setLockSuccess('');
            }}
            placeholder={t('lock.oldPassword')}
            className="setting-input"
          />
        </div>
      )}

      <div className="setting-password-group">
        <input
          type="password"
          value={lockNewPassword}
          onChange={(e) => {
            setLockNewPassword(e.target.value);
            setLockError('');
            setLockSuccess('');
          }}
          placeholder={lockHasPassword ? t('lock.newPassword') : t('lock.setPassword')}
          className="setting-input"
        />
        {lockNewPassword && (
          <input
            type="password"
            value={lockConfirmPassword}
            onChange={(e) => {
              setLockConfirmPassword(e.target.value);
              setLockError('');
              setLockSuccess('');
            }}
            placeholder={t('lock.confirmPassword')}
            className="setting-input"
          />
        )}
      </div>

      {lockError && <small className="setting-status error">{lockError}</small>}
      {lockSuccess && <small className="setting-status success">{lockSuccess}</small>}

      <div className="setting-btn-row">
        <button
          className="test-btn"
          onClick={async () => {
            setLockError('');
            setLockSuccess('');
            if (lockNewPassword) {
              if (lockNewPassword !== lockConfirmPassword) {
                setLockError(t('lock.mismatch'));
                return;
              }
              try {
                await invoke('set_lock_password', { oldPassword: lockOldPassword, newPassword: lockNewPassword });
                setLockSuccess(t('lock.setSuccess'));
                setLockHasPassword(true);
                setLockOldPassword('');
                setLockNewPassword('');
                setLockConfirmPassword('');
              } catch (err) {
                setLockError(String(err));
              }
            }
          }}
          disabled={!lockNewPassword || !lockConfirmPassword}
        >
          {lockHasPassword ? t('lock.changePassword') : t('lock.enableLock')}
        </button>
        {lockHasPassword && (
          <button
            className="test-btn danger"
            onClick={async () => {
              setLockError('');
              setLockSuccess('');
              if (!lockOldPassword) {
                setLockError(t('lock.needOldPassword'));
                return;
              }
              try {
                await invoke('set_lock_password', { oldPassword: lockOldPassword, newPassword: '' });
                setLockSuccess(t('lock.removeSuccess'));
                setLockHasPassword(false);
                setLockOldPassword('');
                setLockNewPassword('');
                setLockConfirmPassword('');
              } catch (err) {
                setLockError(String(err));
              }
            }}
          >
            {t('lock.removeLock')}
          </button>
        )}
      </div>
    </div>
  );
}

export default DataSecuritySecuritySection;

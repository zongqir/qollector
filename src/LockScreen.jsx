import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import './LockScreen.css';

function LockScreen({ onUnlock }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!password) return;
    try {
      const ok = await invoke('verify_lock_password', { password });
      if (ok) {
        onUnlock();
      } else {
        setError(t('lock.wrongPassword'));
        setPassword('');
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await invoke('reset_all_data');
      onUnlock();
    } catch (err) {
      setError(String(err));
    } finally {
      setResetting(false);
      setShowReset(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-screen-content">
        <div className="lock-screen-icon">🔒</div>
        <h2 className="lock-screen-title">{t('lock.title')}</h2>
        <form className="lock-screen-form" onSubmit={handleUnlock}>
          <input
            type="password"
            className={`lock-screen-input ${error ? 'error' : ''}`}
            placeholder={t('lock.placeholder')}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            autoFocus
          />
          {error && <div className="lock-screen-error">{error}</div>}
          <button type="submit" className="lock-screen-btn" disabled={!password}>
            {t('lock.unlock')}
          </button>
        </form>
        <button className="lock-screen-forgot" onClick={() => setShowReset(true)}>
          {t('lock.forgot')}
        </button>
      </div>

      {showReset && (
        <div className="lock-reset-overlay" onClick={() => setShowReset(false)}>
          <div className="lock-reset-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t('lock.resetTitle')}</h3>
            <p>{t('lock.resetDesc')}</p>
            <p className="lock-reset-warning">{t('lock.resetWarning')}</p>
            <div className="lock-reset-actions">
              <button onClick={() => setShowReset(false)}>{t('settings.cancel')}</button>
              <button className="danger-btn" onClick={handleReset} disabled={resetting}>
                {resetting ? '...' : t('lock.resetConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LockScreen;

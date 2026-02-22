import { useTranslation } from 'react-i18next';
import { Share2, Copy, Check, RefreshCw, X, AlertTriangle, Upload, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { FREE_PROVIDERS } from '../../share/providers';
import './ShareModal.css';

const PROVIDER_TTL_LABELS = {
  Litterbox: '~72h',
  Tmpfiles: '~1h',
  ZeroX0: '~30d',
};

function ShareModal({
  item, shareResult, shareLoading, shareError,
  pendingConfirm, pendingProvider,
  onClose, onRetry, onConfirmUpload, onSwitchProvider,
}) {
  const { t } = useTranslation();
  const [linkCopied, setLinkCopied] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);

  const handleCopyLink = async () => {
    if (!shareResult?.url) return;
    try {
      await navigator.clipboard.writeText(shareResult.url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error('copy link failed:', err);
    }
  };

  const providerNames = Object.keys(FREE_PROVIDERS);

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <Share2 size={16} />
          <span>{t('share.title')}</span>
          <button className="share-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="share-modal-body">
          {shareLoading && (
            <div className="share-loading">
              <div className="share-spinner" />
              <span>{t('share.processing')}</span>
            </div>
          )}

          {pendingConfirm && !shareLoading && (
            <div className="share-confirm">
              <div className="share-confirm-warning">
                <AlertTriangle size={18} className="share-warning-icon" />
                <span>{t('share.privacyWarning')}</span>
              </div>
              <p className="share-confirm-detail">{t('share.privacyDetail')}</p>

              {shareError && (
                <div className="share-error share-error-inline">
                  <span>{t('share.failed')}: {shareError}</span>
                </div>
              )}

              <div className="share-provider-section">
                <span className="share-provider-label">{t('share.uploadTo')}</span>
                <div className="share-provider-select" onClick={() => setProviderOpen(!providerOpen)}>
                  <span>{pendingProvider}</span>
                  <span className="share-provider-ttl">{PROVIDER_TTL_LABELS[pendingProvider] || ''}</span>
                  <ChevronDown size={14} className={`share-chevron ${providerOpen ? 'open' : ''}`} />
                </div>
                {providerOpen && (
                  <div className="share-provider-dropdown">
                    {providerNames.map((name) => (
                      <div
                        key={name}
                        className={`share-provider-option ${name === pendingProvider ? 'active' : ''}`}
                        onClick={() => { onSwitchProvider(name); setProviderOpen(false); }}
                      >
                        <span>{name}</span>
                        <span className="share-provider-ttl">{PROVIDER_TTL_LABELS[name] || ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button className="share-confirm-btn" onClick={() => onConfirmUpload(pendingProvider)}>
                <Upload size={14} />
                {t('share.confirmUpload')}
              </button>
            </div>
          )}

          {shareError && !pendingConfirm && !shareLoading && (
            <div className="share-error">
              <span>{t('share.failed')}: {shareError}</span>
              <button className="share-retry-btn" onClick={onRetry}>
                <RefreshCw size={14} />
                {t('share.retry')}
              </button>
            </div>
          )}

          {shareResult && (
            <div className="share-result">
              <div className="share-qr-container">
                <img src={shareResult.qr_code} alt="QR Code" className="share-qr-image" />
              </div>
              <div className="share-info">
                {shareResult.method === 'LocalQr' ? (
                  <>
                    <span className="share-method-badge local">{t('share.localQrReady')}</span>
                    <span className="share-hint">{t('share.localQrHint')}</span>
                  </>
                ) : (
                  <>
                    <span className="share-method-badge cloud">{t('share.uploadSuccess')}</span>
                    <span className="share-hint">{t('share.cloudHint')}</span>
                  </>
                )}
              </div>
              {shareResult.url && (
                <button className="share-copy-link-btn" onClick={handleCopyLink}>
                  {linkCopied ? <Check size={14} /> : <Copy size={14} />}
                  {linkCopied ? t('share.copied') : t('share.copyLink')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ShareModal;
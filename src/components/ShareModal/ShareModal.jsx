import { useTranslation } from 'react-i18next';
import { Share2, Copy, Check, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import './ShareModal.css';

function ShareModal({ item, shareResult, shareLoading, shareError, onClose, onRetry }) {
  const { t } = useTranslation();
  const [linkCopied, setLinkCopied] = useState(false);

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

          {shareError && (
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

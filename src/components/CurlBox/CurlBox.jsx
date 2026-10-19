import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  Play,
  Copy,
  Check,
  Code2,
  Key,
  FileJson,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Plus,
  Trash2,
  Terminal,
  ExternalLink,
  AlertCircle,
  Sliders,
  Cookie
} from 'lucide-react';
import {
  parseCurl,
  formatAsCleanCurl,
  generateFetchCode,
  generatePythonCode
} from '../../utils/curlParser';
import './CurlBox.css';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

export default function CurlBox({ item, onFeedback }) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseCurl(item?.content), [item?.content]);

  // Request editable state
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState([]);
  const [body, setBody] = useState('');
  const [showHeaders, setShowHeaders] = useState(false);
  const [showRunner, setShowRunner] = useState(false);

  // Execution state
  const [isSending, setIsSending] = useState(false);
  const [response, setResponse] = useState(null);
  const [sendError, setSendError] = useState(null);

  // Copy state feedback
  const [copiedAction, setCopiedAction] = useState(null);

  // Initialize/Reset editable state when parsed changes
  const resetToParsed = useCallback(() => {
    if (!parsed) return;
    setMethod(parsed.method || 'GET');
    setUrl(parsed.url || '');
    setHeaders(parsed.headers ? parsed.headers.map(h => ({ ...h })) : []);
    setBody(parsed.formattedJsonBody || parsed.rawBody || '');
    setResponse(null);
    setSendError(null);
  }, [parsed]);

  useEffect(() => {
    resetToParsed();
  }, [resetToParsed]);

  const showCopyToast = useCallback((actionKey, text) => {
    navigator.clipboard.writeText(text);
    setCopiedAction(actionKey);
    if (onFeedback) {
      onFeedback(t(`curl.${actionKey}Success`));
    }
    setTimeout(() => {
      setCopiedAction(null);
    }, 1500);
  }, [t, onFeedback]);

  const handleCopyBody = () => {
    if (parsed?.formattedJsonBody || parsed?.rawBody) {
      showCopyToast('copyBody', parsed.formattedJsonBody || parsed.rawBody);
    }
  };

  const handleCopyToken = () => {
    if (parsed?.bearerToken) {
      showCopyToast('copyToken', parsed.bearerToken);
    }
  };

  const handleCopyCookie = () => {
    if (parsed?.cookie) {
      showCopyToast('copyCookie', parsed.cookie);
    }
  };

  const handleCopyCleanCurl = () => {
    if (parsed) {
      showCopyToast('formatCurl', formatAsCleanCurl(parsed));
    }
  };

  const handleCopyFetch = () => {
    if (parsed) {
      showCopyToast('copyFetch', generateFetchCode(parsed));
    }
  };

  const handleCopyPython = () => {
    if (parsed) {
      showCopyToast('copyPython', generatePythonCode(parsed));
    }
  };

  const handleFormatJsonBody = () => {
    try {
      const obj = JSON.parse(body);
      setBody(JSON.stringify(obj, null, 2));
    } catch {
      // not valid json, ignore
    }
  };

  const handleAddHeader = () => {
    setHeaders(prev => [...prev, { name: '', value: '' }]);
    setShowHeaders(true);
  };

  const handleUpdateHeader = (index, field, val) => {
    setHeaders(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const handleRemoveHeader = (index) => {
    setHeaders(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!url.trim()) return;
    setIsSending(true);
    setSendError(null);

    const validHeaders = headers
      .filter(h => h.name && h.name.trim())
      .map(h => [h.name.trim(), h.value || '']);

    try {
      const res = await invoke('send_http_request', {
        request: {
          method,
          url: url.trim(),
          headers: validHeaders,
          body: ['GET', 'HEAD'].includes(method) ? null : body,
          timeout_ms: 30000,
        },
      });
      setResponse(res);
    } catch (err) {
      setSendError(typeof err === 'string' ? err : err?.message || 'Network request failed');
    } finally {
      setIsSending(false);
    }
  };

  if (!parsed) return null;

  const methodColorClass = `method-${(parsed.method || 'GET').toLowerCase()}`;
  const responseStatusClass = response
    ? response.status >= 200 && response.status < 300
      ? 'status-success'
      : response.status >= 400 && response.status < 500
      ? 'status-warning'
      : 'status-error'
    : '';

  return (
    <div className="curl-box">
      {/* 顶部 API 摘要与快捷操作栏 */}
      <div className="curl-box-header">
        <div className="curl-box-meta">
          <span className={`curl-method-badge ${methodColorClass}`}>
            {parsed.method || 'GET'}
          </span>
          <span className="curl-endpoint" title={parsed.url}>
            {parsed.pathname || '/'}
            {parsed.queryParams && parsed.queryParams.length > 0 && (
              <span className="curl-endpoint-query">
                ?{parsed.queryParams.map(q => `${q.key}=${q.value}`).join('&')}
              </span>
            )}
          </span>
          <span className="curl-host" title={parsed.host}>
            {parsed.host}
          </span>
        </div>

        {/* 快捷动作按钮 */}
        <div className="curl-quick-actions">
          <button
            type="button"
            className={`curl-action-btn primary ${showRunner ? 'active' : ''}`}
            onClick={() => setShowRunner(prev => !prev)}
            title={t('curl.sendRequest')}
          >
            <Play size={13} />
            <span>{t('curl.sendRequest')}</span>
          </button>

          {parsed.bearerToken && (
            <button
              type="button"
              className="curl-action-btn"
              onClick={handleCopyToken}
              title={t('curl.copyToken')}
            >
              {copiedAction === 'copyToken' ? <Check size={13} /> : <Key size={13} />}
              <span>{t('curl.copyToken')}</span>
            </button>
          )}

          {(parsed.formattedJsonBody || parsed.rawBody) && (
            <button
              type="button"
              className="curl-action-btn"
              onClick={handleCopyBody}
              title={t('curl.copyBody')}
            >
              {copiedAction === 'copyBody' ? <Check size={13} /> : <FileJson size={13} />}
              <span>{t('curl.copyBody')}</span>
            </button>
          )}

          {parsed?.cookie && (
            <button
              type="button"
              className="curl-action-btn"
              onClick={handleCopyCookie}
              title={t('curl.copyCookie')}
            >
              {copiedAction === 'copyCookie' ? <Check size={13} /> : <Cookie size={13} />}
              <span>{t('curl.copyCookie')}</span>
            </button>
          )}

          <button
            type="button"
            className="curl-action-btn"
            onClick={handleCopyCleanCurl}
            title={t('curl.formatCurl')}
          >
            {copiedAction === 'formatCurl' ? <Check size={13} /> : <Terminal size={13} />}
            <span>{t('curl.formatCurl')}</span>
          </button>

          <button
            type="button"
            className="curl-action-btn"
            onClick={handleCopyFetch}
            title={t('curl.copyFetch')}
          >
            {copiedAction === 'copyFetch' ? <Check size={13} /> : <Code2 size={13} />}
            <span>Fetch</span>
          </button>

          <button
            type="button"
            className="curl-action-btn"
            onClick={handleCopyPython}
            title={t('curl.copyPython')}
          >
            {copiedAction === 'copyPython' ? <Check size={13} /> : <Code2 size={13} />}
            <span>Python</span>
          </button>
        </div>
      </div>

      {/* 展开的轻量请求运行器 (Request Runner) */}
      {showRunner && (
        <div className="curl-runner">
          <div className="curl-runner-topbar">
            <span className="curl-runner-title">
              <Sliders size={13} />
              <span>{t('curl.runnerTitle')}</span>
            </span>
            <button
              type="button"
              className="curl-runner-reset-btn"
              onClick={resetToParsed}
              title={t('curl.reset')}
            >
              <RefreshCw size={12} />
              <span>{t('curl.reset')}</span>
            </button>
          </div>

          {/* URL & Method 输入行 */}
          <div className="curl-runner-url-row">
            <select
              className="curl-runner-method-select"
              value={method}
              onChange={e => setMethod(e.target.value)}
            >
              {HTTP_METHODS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="text"
              className="curl-runner-url-input"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t('curl.urlPlaceholder')}
            />
            <button
              type="button"
              className="curl-runner-send-btn"
              onClick={handleSend}
              disabled={isSending || !url.trim()}
            >
              {isSending ? (
                <>
                  <RefreshCw size={13} className="spin-icon" />
                  <span>{t('curl.sending')}</span>
                </>
              ) : (
                <>
                  <Play size={13} />
                  <span>{t('curl.send')}</span>
                </>
              )}
            </button>
          </div>

          {/* Body 编辑区 (POST / PUT / PATCH / DELETE) */}
          {!['GET', 'HEAD'].includes(method) && (
            <div className="curl-runner-body-section">
              <div className="curl-runner-section-header">
                <span className="section-title">{t('curl.body')}</span>
                <button
                  type="button"
                  className="curl-runner-mini-btn"
                  onClick={handleFormatJsonBody}
                  title={t('curl.formatJson')}
                >
                  <FileJson size={12} />
                  <span>{t('curl.formatJson')}</span>
                </button>
              </div>
              <textarea
                className="curl-runner-body-textarea"
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={5}
                placeholder='{"key": "value"}'
                spellCheck={false}
              />
            </div>
          )}

          {/* Headers 折叠区 */}
          <div className="curl-runner-headers-section">
            <div
              className="curl-runner-section-header clickable"
              onClick={() => setShowHeaders(prev => !prev)}
            >
              <span className="section-title">
                {t('curl.headers')} ({headers.length})
              </span>
              <div className="section-header-actions" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  className="curl-runner-mini-btn"
                  onClick={handleAddHeader}
                >
                  <Plus size={12} />
                  <span>{t('curl.addHeader')}</span>
                </button>
                <button
                  type="button"
                  className="curl-runner-toggle-btn"
                  onClick={() => setShowHeaders(prev => !prev)}
                >
                  {showHeaders ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
            </div>

            {showHeaders && (
              <div className="curl-runner-headers-list">
                {headers.length === 0 ? (
                  <div className="curl-runner-empty-headers">No custom headers</div>
                ) : (
                  headers.map((h, idx) => (
                    <div key={idx} className="curl-header-row">
                      <input
                        type="text"
                        className="curl-header-input key"
                        placeholder={t('curl.headerKey')}
                        value={h.name}
                        onChange={e => handleUpdateHeader(idx, 'name', e.target.value)}
                      />
                      <input
                        type="text"
                        className="curl-header-input value"
                        placeholder={t('curl.headerValue')}
                        value={h.value}
                        onChange={e => handleUpdateHeader(idx, 'value', e.target.value)}
                      />
                      <button
                        type="button"
                        className="curl-header-delete-btn"
                        onClick={() => handleRemoveHeader(idx)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 响应结果区域 */}
          {(response || sendError) && (
            <div className="curl-runner-response-section">
              <div className="curl-runner-response-header">
                <span className="section-title">{t('curl.response')}</span>
                {response && (
                  <div className="response-metrics">
                    <span className={`response-status-badge ${responseStatusClass}`}>
                      {response.status} {response.status_text}
                    </span>
                    <span className="response-metric-item">
                      {response.elapsed_ms}ms
                    </span>
                    <span className="response-metric-item">
                      {(response.size_bytes / 1024).toFixed(1)} KB
                    </span>
                    <button
                      type="button"
                      className="curl-runner-mini-btn"
                      onClick={() => showCopyToast('copyResponse', response.body)}
                    >
                      {copiedAction === 'copyResponse' ? <Check size={12} /> : <Copy size={12} />}
                      <span>{t('curl.copyResponse')}</span>
                    </button>
                  </div>
                )}
              </div>

              {sendError && (
                <div className="curl-runner-error-banner">
                  <AlertCircle size={14} />
                  <span>{sendError}</span>
                </div>
              )}

              {response && (
                <div className="curl-runner-response-body">
                  <pre className="curl-response-pre">
                    <code>
                      {response.is_json
                        ? (() => {
                            try {
                              return JSON.stringify(JSON.parse(response.body), null, 2);
                            } catch {
                              return response.body;
                            }
                          })()
                        : response.body}
                    </code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

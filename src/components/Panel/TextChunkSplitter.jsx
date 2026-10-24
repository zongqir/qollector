import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, ChevronDown, ChevronUp, Copy, Check, ShieldCheck } from 'lucide-react';
import { splitTextIntoChunks, DEFAULT_CHUNK_THRESHOLD } from '../../utils/textSplitter.js';

export function TextChunkSplitter({ text, onCopyChunk, showToast }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [activeChunkIndex, setActiveChunkIndex] = useState(1);

  const chunks = useMemo(() => {
    return splitTextIntoChunks(text, DEFAULT_CHUNK_THRESHOLD);
  }, [text]);

  if (!chunks || chunks.length <= 1) {
    return null;
  }

  const handleCopy = async (chunk, e) => {
    e?.stopPropagation();
    if (onCopyChunk) {
      await onCopyChunk(chunk.content);
    }
    setCopiedIndex(chunk.index);
    // 复制完当前卷后，自动把下一个卷设为活跃就绪卷
    if (chunk.index < chunks.length) {
      setActiveChunkIndex(chunk.index + 1);
    }
    if (showToast) {
      showToast(t('item.chunkCopiedToast', { index: chunk.index, total: chunk.total, chars: chunk.charCount }));
    }
    setTimeout(() => {
      setCopiedIndex(null);
    }, 2000);
  };

  return (
    <div className="preview-chunk-splitter-card">
      <div 
        className="preview-chunk-toggle-header"
        onClick={() => setIsExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        title={t('item.chunkToggleTitle')}
      >
        <div className="preview-chunk-title-group">
          <Layers size={14} className="preview-chunk-icon" />
          <span className="preview-chunk-title-text">
            {t('item.chunkSplitBanner', { count: chunks.length, totalChars: text.length })}
          </span>
          <span className="preview-chunk-safe-tag">
            <ShieldCheck size={11} />
            <span>&le;4096</span>
          </span>
        </div>
        <div className="preview-chunk-action-group">
          <span className="preview-chunk-toggle-btn">
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="preview-chunk-list">
          {chunks.map((chunk) => {
            const isCopied = copiedIndex === chunk.index;
            const isReadyNext = activeChunkIndex === chunk.index;
            return (
              <div 
                key={chunk.index} 
                className={`preview-chunk-item ${isReadyNext ? 'ready' : ''} ${isCopied ? 'copied' : ''}`}
              >
                <div className="preview-chunk-item-top">
                  <div className="preview-chunk-item-badges">
                    <span className="preview-chunk-pill-index">
                      {t('item.chunkPart', { index: chunk.index, total: chunk.total })}
                    </span>
                    <span className="preview-chunk-pill-meta">
                      {t('item.chunkLines', { start: chunk.startLine, end: chunk.endLine })} &middot; {t('item.chunkChars', { count: chunk.charCount })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`preview-chunk-btn ${isCopied ? 'copied' : isReadyNext ? 'primary' : 'secondary'}`}
                    onClick={(e) => handleCopy(chunk, e)}
                  >
                    {isCopied ? <Check size={12} /> : <Copy size={12} />}
                    <span>{isCopied ? t('item.copied') : t('item.copyThisChunk')}</span>
                  </button>
                </div>
                <div className="preview-chunk-snippet">
                  <code>{chunk.preview}</code>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

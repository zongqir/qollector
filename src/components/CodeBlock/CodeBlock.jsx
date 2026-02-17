import { memo, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import useCodeHighlight from '../../hooks/useCodeHighlight';
import './CodeBlock.css';

// Dynamically load highlight.js CSS only when CodeBlock is used
let cssLoaded = false;
const loadHighlightCSS = () => {
  if (!cssLoaded) {
    cssLoaded = true;
    import('highlight.js/styles/vs2015.css');
  }
};

function CodeBlock({ code, language, maxLines = 200, showLanguageBadge = true, compact = false }) {
  const { t } = useTranslation();
  const { isReady, highlightCode } = useCodeHighlight();

  useEffect(() => {
    loadHighlightCSS();
  }, []);

  const { truncatedCode, totalLines, shownLines } = useMemo(() => {
    if (!code) return { truncatedCode: '', totalLines: 0, shownLines: 0 };
    const lines = code.split('\n');
    const total = lines.length;
    const shown = Math.min(total, maxLines);
    return {
      truncatedCode: lines.slice(0, shown).join('\n'),
      totalLines: total,
      shownLines: shown,
    };
  }, [code, maxLines]);

  const highlightedHtml = useMemo(() => {
    if (!isReady || !language || !truncatedCode) return null;
    return highlightCode(truncatedCode, language);
  }, [isReady, language, truncatedCode, highlightCode]);

  const isTruncated = totalLines > shownLines;

  return (
    <div className={`code-block ${compact ? 'compact' : ''}`}>
      {showLanguageBadge && language && (
        <span className="code-language-badge">{language}</span>
      )}
      <pre>
        <code
          className={`hljs language-${language || 'plaintext'}`}
          dangerouslySetInnerHTML={
            highlightedHtml
              ? { __html: highlightedHtml }
              : undefined
          }
          children={highlightedHtml ? undefined : truncatedCode}
        />
      </pre>
      {isTruncated && !compact && (
        <div className="code-truncate-notice">
          {t('code.truncated', { shown: shownLines, total: totalLines })}
        </div>
      )}
    </div>
  );
}

export default memo(CodeBlock);

import { memo, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { renderMarkdownToHtml } from '../../utils/markdownRenderer';
import './MarkdownView.css';

function MarkdownView({
  content = '',
  className = '',
  onDoubleClick,
  onKeyDown,
  title,
  tabIndex = 0,
}) {
  const htmlContent = useMemo(() => renderMarkdownToHtml(content), [content]);

  const handleContainerClick = useCallback((event) => {
    const link = event.target.closest('a');
    if (link && link.href) {
      event.preventDefault();
      event.stopPropagation();
      const href = link.getAttribute('href');
      if (href) {
        invoke('open_file_path', { path: href }).catch(() => {
          window.open(href, '_blank', 'noopener,noreferrer');
        });
      }
    }
  }, []);

  return (
    <div
      className={`markdown-rendered-view ${className}`.trim()}
      onClick={handleContainerClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      title={title}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}

export default memo(MarkdownView);

import { marked } from 'marked';
import DOMPurify from 'dompurify';

const MARKDOWN_EXT_REGEX = /\.(?:md|markdown|mdown|mkdn)$/i;

// Circuit breaker limit: 80KB max to avoid UI freeze on monstrous clipboard text
const MAX_MARKDOWN_RENDER_LENGTH = 80 * 1024;

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Checks whether a given file path or file name corresponds to a Markdown document.
 */
export function isMarkdownFile(filePathOrName) {
  if (typeof filePathOrName !== 'string' || !filePathOrName.trim()) {
    return false;
  }
  return MARKDOWN_EXT_REGEX.test(filePathOrName.trim());
}

/**
 * Checks whether text content is likely structured Markdown formatting.
 */
export function isLikelyMarkdown(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 8 || trimmed.length > MAX_MARKDOWN_RENDER_LENGTH) {
    return false;
  }

  // Common Markdown patterns
  const headerPattern = /^#{1,6}\s+\S/m;
  const tablePattern = /\|[\s-:]+\|[\s-:]+\|/m;
  const taskListPattern = /^\s*[-*]\s+\[[ xX]\]\s+\S/m;
  const blockquotePattern = /^>\s+\S/m;
  const listPattern = /^\s*[-*+]\s+\S/m;
  const numberedListPattern = /^\s*\d+\.\s+\S/m;
  const linkOrImagePattern = /!?\[[^\]\r\n]{1,80}\]\([^)\r\n]{1,200}\)/;
  const codeFencePattern = /^```[\w-]*\s*$/m;

  let score = 0;
  if (headerPattern.test(trimmed)) score += 2;
  if (tablePattern.test(trimmed)) score += 3;
  if (taskListPattern.test(trimmed)) score += 3;
  if (codeFencePattern.test(trimmed)) score += 2;
  if (blockquotePattern.test(trimmed)) score += 1;
  if (listPattern.test(trimmed)) score += 1;
  if (numberedListPattern.test(trimmed)) score += 1;
  if (linkOrImagePattern.test(trimmed)) score += 2;

  return score >= 2;
}

/**
 * Renders Markdown source text into sanitized, safe HTML.
 * Includes performance length guards and XSS protection.
 */
export function renderMarkdownToHtml(markdownText) {
  if (typeof markdownText !== 'string' || !markdownText.trim()) {
    return '';
  }

  let textToParse = markdownText;
  let isTruncated = false;

  if (textToParse.length > MAX_MARKDOWN_RENDER_LENGTH) {
    textToParse = textToParse.slice(0, MAX_MARKDOWN_RENDER_LENGTH);
    isTruncated = true;
  }

  try {
    const rawHtml = marked.parse(textToParse);
    let sanitizedHtml = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel'],
    });

    if (isTruncated) {
      sanitizedHtml += '<p class="markdown-truncated-notice"><em>(Markdown preview truncated for performance)</em></p>';
    }

    return sanitizedHtml;
  } catch (error) {
    console.error('Markdown rendering error:', error);
    return `<pre class="markdown-error-fallback">${DOMPurify.sanitize(markdownText)}</pre>`;
  }
}

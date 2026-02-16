import { useState, useEffect, useCallback, useRef } from 'react';

let hljsInstance = null;
let loadingPromise = null;

export async function loadHighlightJS() {
  if (hljsInstance) return hljsInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const hljs = (await import('highlight.js/lib/core')).default;

    const langs = await Promise.all([
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/rust'),
      import('highlight.js/lib/languages/java'),
      import('highlight.js/lib/languages/cpp'),
      import('highlight.js/lib/languages/c'),
      import('highlight.js/lib/languages/go'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/shell'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/yaml'),
      import('highlight.js/lib/languages/xml'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/markdown'),
    ]);

    const names = [
      'python', 'javascript', 'typescript', 'rust', 'java', 'cpp', 'c',
      'go', 'bash', 'shell', 'sql', 'json', 'yaml', 'xml', 'css', 'markdown',
    ];

    names.forEach((name, i) => hljs.registerLanguage(name, langs[i].default));

    // Aliases
    hljs.registerLanguage('html', langs[13].default); // xml covers html

    hljsInstance = hljs;
    return hljs;
  })();

  return loadingPromise;
}

const RELEVANCE_THRESHOLD = 12;

// Languages that highlightAuto frequently assigns to non-code text.
const UNRELIABLE_LANGUAGES = new Set(['xml', 'markdown', 'css']);

// Quick heuristic: does the text look like it could be code?
function looksLikeCode(text) {
  const trimmed = text.trim();

  // Too short to be meaningful code
  if (trimmed.length < 12) return false;

  // Mostly CJK / non-ASCII prose → almost certainly not code
  const nonAscii = (trimmed.match(/[^\x00-\x7F]/g) || []).length;
  if (nonAscii / trimmed.length > 0.3) return false;

  // Code indicators: braces, semicolons, arrows, common keywords, etc.
  const codeSignals = /[{};=<>()[\]]|=>|->|::|\/\/|\/\*|\*\/|#include|import |from |def |fn |func |class |const |let |var |return |if\s*\(|for\s*\(|while\s*\(|SELECT |INSERT |CREATE |ALTER /;
  return codeSignals.test(trimmed);
}

export async function detectLanguage(code) {
  try {
    if (!looksLikeCode(code)) return null;

    const hljs = await loadHighlightJS();
    const result = hljs.highlightAuto(code);

    if (!result.language || result.relevance < RELEVANCE_THRESHOLD) return null;

    // Reject unreliable languages unless the relevance is very high
    if (UNRELIABLE_LANGUAGES.has(result.language) && result.relevance < 20) return null;

    return result.language;
  } catch {
    return null;
  }
}

export default function useCodeHighlight() {
  const [isReady, setIsReady] = useState(!!hljsInstance);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!hljsInstance) {
      loadHighlightJS().then(() => {
        if (mountedRef.current) setIsReady(true);
      }).catch(() => {});
    }
    return () => { mountedRef.current = false; };
  }, []);

  const highlightCode = useCallback((code, language) => {
    if (!hljsInstance || !language) return null;
    try {
      if (hljsInstance.getLanguage(language)) {
        return hljsInstance.highlight(code, { language }).value;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  return { isReady, highlightCode };
}

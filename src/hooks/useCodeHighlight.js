import { useState, useEffect, useCallback, useRef } from 'react';

let hljsInstance = null;
let loadingPromise = null;

async function loadHighlightJS() {
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

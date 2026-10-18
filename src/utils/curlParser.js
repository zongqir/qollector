/**
 * cURL command detection, parsing, formatting, and code generation utilities.
 */

/**
 * Checks if the given text looks like a cURL command.
 * @param {string} text
 * @returns {boolean}
 */
export function isCurlCommand(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  // Match `curl ` at the beginning or after environment variables (e.g. `env ... curl `)
  return /^(?:[\w_]+=\S+\s+)*curl(?:\.exe)?(?:\s+|$)/i.test(trimmed);
}

/**
 * Tokenizes a shell command string, respecting single/double quotes,
 * line continuations (\ and ^), and escaped characters.
 * @param {string} commandText
 * @returns {string[]}
 */
export function tokenizeShellCommand(commandText) {
  if (!commandText) return [];

  // Normalize Windows cmd `^` and bash `\` line continuations
  let normalized = commandText
    .replace(/\^\r?\n/g, ' ')
    .replace(/\\\r?\n/g, ' ');

  const tokens = [];
  let currentToken = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let isEscaped = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (isEscaped) {
      currentToken += char;
      isEscaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      isEscaped = true;
      continue;
    }

    if (char === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        currentToken = '';
      }
      continue;
    }

    currentToken += char;
  }

  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }

  return tokens;
}

/**
 * Parses a cURL command into structured request components.
 * @param {string} curlText
 * @returns {object|null}
 */
export function parseCurl(curlText) {
  if (!isCurlCommand(curlText)) return null;

  const tokens = tokenizeShellCommand(curlText);
  if (tokens.length === 0) return null;

  // Filter out starting 'curl' or 'curl.exe'
  let startIndex = 0;
  while (startIndex < tokens.length && !/curl(?:\.exe)?$/i.test(tokens[startIndex])) {
    startIndex++;
  }
  const args = tokens.slice(startIndex + 1);

  let method = '';
  let url = '';
  const headers = [];
  const bodyParts = [];
  let userAuth = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-X' || arg === '--request') {
      if (i + 1 < args.length) {
        method = args[++i].toUpperCase();
      }
    } else if (arg.startsWith('-X')) {
      method = arg.slice(2).toUpperCase();
    } else if (arg === '-H' || arg === '--header') {
      if (i + 1 < args.length) {
        const headerStr = args[++i];
        const colonIdx = headerStr.indexOf(':');
        if (colonIdx > 0) {
          const name = headerStr.slice(0, colonIdx).trim();
          const value = headerStr.slice(colonIdx + 1).trim();
          headers.push({ name, value });
        }
      }
    } else if (
      arg === '-d' ||
      arg === '--data' ||
      arg === '--data-raw' ||
      arg === '--data-binary' ||
      arg === '--data-ascii' ||
      arg === '--data-urlencode'
    ) {
      if (i + 1 < args.length) {
        bodyParts.push(args[++i]);
      }
    } else if (arg === '-u' || arg === '--user') {
      if (i + 1 < args.length) {
        userAuth = args[++i];
      }
    } else if (arg === '--url') {
      if (i + 1 < args.length) {
        url = args[++i];
      }
    } else if (
      !arg.startsWith('-') &&
      !url &&
      (arg.startsWith('http://') || arg.startsWith('https://') || arg.includes('.'))
    ) {
      url = arg;
    }
  }

  if (!url) {
    // Fallback: look for first token containing http
    const candidate = args.find(a => !a.startsWith('-') && (a.startsWith('http://') || a.startsWith('https://')));
    if (candidate) {
      url = candidate;
    }
  }

  if (!url) return null;

  // Handle Basic Auth if -u was provided
  if (userAuth && !headers.some(h => h.name.toLowerCase() === 'authorization')) {
    try {
      const encoded = btoa(userAuth);
      headers.push({ name: 'Authorization', value: `Basic ${encoded}` });
    } catch {
      // ignore base64 encoding error
    }
  }

  // Determine HTTP Method
  if (!method) {
    method = bodyParts.length > 0 ? 'POST' : 'GET';
  }

  const rawBody = bodyParts.join('&');

  // Check if body is JSON
  let isJsonBody = false;
  let formattedJsonBody = null;
  if (rawBody) {
    try {
      const parsedJson = JSON.parse(rawBody);
      isJsonBody = true;
      formattedJsonBody = JSON.stringify(parsedJson, null, 2);
    } catch {
      isJsonBody = false;
    }
  }

  // Parse URL details
  let host = '';
  let pathname = '';
  let origin = '';
  const queryParams = [];

  try {
    const parsedUrl = new URL(url);
    host = parsedUrl.host;
    pathname = parsedUrl.pathname;
    origin = parsedUrl.origin;
    parsedUrl.searchParams.forEach((val, key) => {
      queryParams.push({ key, value: val });
    });
  } catch {
    // If URL is missing protocol, try with https://
    try {
      const parsedUrl = new URL(`https://${url}`);
      host = parsedUrl.host;
      pathname = parsedUrl.pathname;
      origin = parsedUrl.origin;
      parsedUrl.searchParams.forEach((val, key) => {
        queryParams.push({ key, value: val });
      });
    } catch {
      // fallback simple extract
      host = url.split('/')[0] || '';
      pathname = url.slice(host.length) || '/';
    }
  }

  // Extract Bearer token if present
  let bearerToken = null;
  const authHeader = headers.find(h => h.name.toLowerCase() === 'authorization');
  if (authHeader && authHeader.value) {
    const match = authHeader.value.match(/^Bearer\s+(.+)$/i);
    if (match) {
      bearerToken = match[1].trim();
    }
  }

  return {
    raw: curlText,
    method,
    url,
    host,
    pathname,
    origin,
    queryParams,
    headers,
    rawBody,
    formattedJsonBody,
    isJsonBody,
    bearerToken,
  };
}

/**
 * Formats a parsed cURL object into a clean, multi-line cURL command.
 * @param {object} parsed
 * @returns {string}
 */
export function formatAsCleanCurl(parsed) {
  if (!parsed || !parsed.url) return '';

  const lines = [`curl -X ${parsed.method || 'GET'} '${parsed.url}'`];

  if (Array.isArray(parsed.headers)) {
    parsed.headers.forEach(h => {
      if (h.name && h.value) {
        lines.push(`  -H '${h.name}: ${h.value}'`);
      }
    });
  }

  if (parsed.rawBody) {
    if (parsed.isJsonBody && parsed.formattedJsonBody) {
      // Indented JSON body
      const indentedBody = parsed.formattedJsonBody
        .split('\n')
        .map(l => `  ${l}`)
        .join('\n');
      lines.push(`  --data-raw '${parsed.rawBody}'`);
    } else {
      lines.push(`  --data-raw '${parsed.rawBody}'`);
    }
  }

  return lines.join(' \\\n');
}

/**
 * Generates JavaScript fetch() code from parsed cURL.
 * @param {object} parsed
 * @returns {string}
 */
export function generateFetchCode(parsed) {
  if (!parsed || !parsed.url) return '';

  const options = {
    method: parsed.method || 'GET',
  };

  if (parsed.headers && parsed.headers.length > 0) {
    options.headers = {};
    parsed.headers.forEach(h => {
      options.headers[h.name] = h.value;
    });
  }

  if (parsed.rawBody && !['GET', 'HEAD'].includes(parsed.method)) {
    options.body = parsed.rawBody;
  }

  const optionsStr = JSON.stringify(options, null, 2);

  return `fetch('${parsed.url}', ${optionsStr})\n  .then(res => res.json())\n  .then(data => console.log(data))\n  .catch(err => console.error(err));`;
}

/**
 * Generates Python requests code from parsed cURL.
 * @param {object} parsed
 * @returns {string}
 */
export function generatePythonCode(parsed) {
  if (!parsed || !parsed.url) return '';

  const lines = ['import requests'];
  lines.push(`url = '${parsed.url}'`);

  if (parsed.headers && parsed.headers.length > 0) {
    const headersObj = {};
    parsed.headers.forEach(h => {
      headersObj[h.name] = h.value;
    });
    lines.push(`headers = ${JSON.stringify(headersObj, null, 2)}`);
  } else {
    lines.push('headers = {}');
  }

  const method = (parsed.method || 'GET').toLowerCase();

  if (parsed.rawBody && !['get', 'head'].includes(method)) {
    if (parsed.isJsonBody) {
      lines.push(`data = ${parsed.formattedJsonBody || parsed.rawBody}`);
      lines.push(`response = requests.${method}(url, headers=headers, json=data)`);
    } else {
      lines.push(`data = '''${parsed.rawBody}'''`);
      lines.push(`response = requests.${method}(url, headers=headers, data=data)`);
    }
  } else {
    lines.push(`response = requests.${method}(url, headers=headers)`);
  }

  lines.push('print(response.status_code)');
  lines.push('print(response.text)');

  return lines.join('\n');
}

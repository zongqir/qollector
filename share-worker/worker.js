/**
 * Qollect Share Relay - Cloudflare Worker
 * 
 * High-performance, zero-knowledge, ephemeral clipboard sharing relay.
 * - End-to-End Encrypted (E2EE): Server only stores ciphertext. Key resides exclusively in URL hash.
 * - Auto-expiring: Content is physically purged after 10 minutes via Cloudflare KV TTL.
 * - Self-contained: Zero external runtime dependencies. Built-in modern responsive decryption UI.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 10 minutes retention in seconds
const DEFAULT_TTL_SECONDS = 600;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB limit

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // API: Push encrypted payload
    if (request.method === 'POST' && (path === '/api/share' || path === '/api/share/')) {
      return handleShareUpload(request, env);
    }

    // Web UI / Raw API: View or inspect shared item
    if (request.method === 'GET') {
      const match = path.match(/^\/s\/([a-zA-Z0-9_-]+)$/);
      if (match) {
        const id = match[1];
        const wantsJson = url.searchParams.get('format') === 'json' || request.headers.get('Accept')?.includes('application/json');
        return handleShareView(id, env, wantsJson, url.origin);
      }
    }

    // Health check
    if (path === '/healthz' || path === '/') {
      return new Response(JSON.stringify({ status: 'ok', service: 'qollect-share-relay' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  },
};

async function handleShareUpload(request, env) {
  try {
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'Payload exceeds 10MB limit' }), {
        status: 413,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    if (!body || !body.ciphertext || !body.iv) {
      return new Response(JSON.stringify({ error: 'Invalid payload: ciphertext and iv are required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Generate collision-resistant 8-char nanoid
    const id = generateId(8);
    const payload = JSON.stringify({
      ciphertext: body.ciphertext,
      iv: body.iv,
      type: body.type || 'text',
      filename: body.filename || null,
      created_at: Date.now(),
    });

    if (!env.SHARE_KV) {
      return new Response(JSON.stringify({ error: 'Worker KV binding SHARE_KV is not configured' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    await env.SHARE_KV.put(id, payload, { expirationTtl: DEFAULT_TTL_SECONDS });

    const origin = new URL(request.url).origin;
    return new Response(
      JSON.stringify({
        id,
        url: `${origin}/s/${id}`,
        ttl_seconds: DEFAULT_TTL_SECONDS,
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}

async function handleShareView(id, env, wantsJson, origin) {
  if (!env.SHARE_KV) {
    return new Response('Worker KV binding SHARE_KV is not configured', { status: 500 });
  }

  const raw = await env.SHARE_KV.get(id);
  if (!raw) {
    if (wantsJson) {
      return new Response(JSON.stringify({ error: 'Expired or not found' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    return new Response(renderExpiredHtml(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (wantsJson) {
    return new Response(raw, {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const data = JSON.parse(raw);
  return new Response(renderDecryptionHtml(id, data), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function generateId(length = 8) {
  const chars = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += chars[array[i] % chars.length];
  }
  return id;
}

function renderExpiredHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>分享已失效 · Qollect</title>
  <style>
    :root {
      --bg: #0f1117;
      --card: #181b24;
      --border: #262a36;
      --text: #e2e8f0;
      --muted: #8492a6;
      --accent: #f43f5e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 2.5rem 2rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4);
    }
    .icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(244, 63, 94, 0.12);
      color: var(--accent);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin-bottom: 1.25rem;
    }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
    p { color: var(--muted); font-size: 0.9rem; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⌛</div>
    <h1>分享已失效或已销毁</h1>
    <p>该剪贴板分享已达到 10 分钟保留时限，数据已从服务器物理永久销毁。若仍需查看，请在发送端重新发起分享。</p>
  </div>
</body>
</html>`;
}

function renderDecryptionHtml(id, data) {
  const safeData = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Qollect 极速分享</title>
  <style>
    :root {
      --bg: #0d1117;
      --card: #161b22;
      --border: #30363d;
      --text: #f0f6fc;
      --muted: #8b949e;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #34d399;
      --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 1.25rem;
    }
    .container {
      max-width: 680px;
      width: 100%;
      margin: auto;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 1.1rem;
      color: var(--text);
    }
    .brand-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      color: #0d1117;
    }
    .badge {
      font-size: 0.75rem;
      padding: 3px 8px;
      border-radius: 100px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--primary);
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
      position: relative;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .content-box {
      font-size: 0.95rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      user-select: text;
      -webkit-user-select: text;
      max-height: 55vh;
      overflow-y: auto;
      color: #e6edf3;
      padding: 0.5rem 0;
    }
    .image-preview {
      max-width: 100%;
      border-radius: 8px;
      display: block;
      margin: auto;
      max-height: 60vh;
      object-fit: contain;
    }
    .btn-action {
      background: var(--primary);
      color: #0b0f19;
      border: none;
      border-radius: var(--radius);
      padding: 0.85rem 1.25rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.15s ease;
      width: 100%;
      box-shadow: 0 4px 14px rgba(56, 189, 248, 0.3);
    }
    .btn-action:active {
      transform: scale(0.98);
      background: var(--primary-hover);
    }
    .btn-action.success {
      background: var(--success);
      color: #062817;
      box-shadow: 0 4px 14px rgba(52, 211, 153, 0.3);
    }
    .footer {
      text-align: center;
      font-size: 0.78rem;
      color: var(--muted);
      line-height: 1.5;
    }
    .fallback-textarea {
      position: absolute;
      left: -9999px;
      top: -9999px;
      opacity: 0;
    }
    .error-msg {
      color: #f87171;
      text-align: center;
      padding: 1rem;
      font-size: 0.9rem;
    }
    .spinner {
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: var(--primary);
      border-radius: 50%;
      width: 24px;
      height: 24px;
      animation: spin 0.8s linear infinite;
      margin: 1rem auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        <div class="brand-icon">Q</div>
        <span>Qollect</span>
      </div>
      <div class="badge">
        <span>🔒 端到端加密</span>
      </div>
    </div>

    <div class="card" id="mainCard">
      <div id="loadingView">
        <div class="spinner"></div>
        <p style="text-align:center; color:var(--muted); font-size:0.85rem;">正在本地解密内容...</p>
      </div>

      <div id="contentView" style="display:none;">
        <div class="content-box" id="textContent"></div>
        <img class="image-preview" id="imageContent" style="display:none;" alt="Decrypted Image" />
      </div>

      <div id="errorView" class="error-msg" style="display:none;"></div>
    </div>

    <button id="copyBtn" class="btn-action" style="display:none;">
      <span id="btnIcon">📋</span>
      <span id="btnLabel">一键复制全文</span>
    </button>

    <div class="footer">
      10 分钟阅后即焚 · 解密在手机本地完成 · 数据不出私有域
    </div>
  </div>

  <textarea id="hiddenArea" class="fallback-textarea" readonly></textarea>

  <script>
    const payload = ${safeData};
    let decryptedText = '';

    function base64ToBytes(base64) {
      const bin = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }

    async function decrypt() {
      const hash = window.location.hash.slice(1);
      if (!hash) {
        showError('链接缺少解密密钥（Hash Key），无法在本地还原内容。');
        return;
      }

      try {
        const rawKey = base64ToBytes(hash);
        const cryptoKey = await window.crypto.subtle.importKey(
          'raw',
          rawKey,
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        );

        const iv = base64ToBytes(payload.iv);
        const ciphertext = base64ToBytes(payload.ciphertext);

        const decryptedBuffer = await window.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          cryptoKey,
          ciphertext
        );

        document.getElementById('loadingView').style.display = 'none';
        document.getElementById('contentView').style.display = 'block';

        if (payload.type === 'image') {
          const blob = new Blob([decryptedBuffer], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          const img = document.getElementById('imageContent');
          img.src = url;
          img.style.display = 'block';

          const copyBtn = document.getElementById('copyBtn');
          copyBtn.style.display = 'flex';
          document.getElementById('btnLabel').innerText = '长按上方图片保存';
          copyBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = payload.filename || 'clipboard.png';
            a.click();
          };
        } else {
          decryptedText = new TextDecoder().decode(decryptedBuffer);
          const textEl = document.getElementById('textContent');
          textEl.innerText = decryptedText;

          const copyBtn = document.getElementById('copyBtn');
          copyBtn.style.display = 'flex';
          copyBtn.onclick = handleCopy;
        }
      } catch (err) {
        console.error('Decryption failed:', err);
        showError('解密失败：密钥错误或内容已被篡改。');
      }
    }

    async function handleCopy() {
      const copyBtn = document.getElementById('copyBtn');
      const btnLabel = document.getElementById('btnLabel');
      const btnIcon = document.getElementById('btnIcon');

      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(decryptedText);
          copied = true;
        } catch (_) {}
      }

      if (!copied) {
        // Fallback for WeChat / iOS Webview
        const textarea = document.getElementById('hiddenArea');
        textarea.value = decryptedText;
        textarea.select();
        textarea.setSelectionRange(0, 99999);
        try {
          copied = document.execCommand('copy');
        } catch (_) {}
      }

      if (copied) {
        copyBtn.classList.add('success');
        btnIcon.innerText = '✓';
        btnLabel.innerText = '已复制到剪贴板！';
        setTimeout(() => {
          copyBtn.classList.remove('success');
          btnIcon.innerText = '📋';
          btnLabel.innerText = '一键复制全文';
        }, 2200);
      } else {
        alert('自动复制受限，请在上方框内长按选中文本复制。');
      }
    }

    function showError(msg) {
      document.getElementById('loadingView').style.display = 'none';
      const errEl = document.getElementById('errorView');
      errEl.innerText = msg;
      errEl.style.display = 'block';
    }

    decrypt();
  </script>
</body>
</html>`;
}

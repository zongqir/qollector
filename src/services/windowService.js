import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, cursorPosition, availableMonitors } from '@tauri-apps/api/window';

const isDevServer = () => window.location.hostname === 'localhost';

const resolveSubWindowUrl = (devPath, prodPath = devPath) => (
  isDevServer() ? `http://localhost:5173/${devPath}` : prodPath
);

const isWindowsRuntime = () => navigator.userAgent.toLowerCase().includes('windows');

const getMonitorAtCursor = async () => {
  const cursor = await cursorPosition();
  const monitors = await availableMonitors();
  return monitors.find((m) => {
    const mx = m.position.x;
    const my = m.position.y;
    return (
      cursor.x >= mx &&
      cursor.x < mx + m.size.width &&
      cursor.y >= my &&
      cursor.y < my + m.size.height
    );
  }) || monitors[0] || null;
};

const centerOnCursorMonitor = async (winW, winH) => {
  try {
    const target = await getMonitorAtCursor();
    if (target) {
      const scale = target.scaleFactor || 1;
      const logicalW = target.size.width / scale;
      const logicalH = target.size.height / scale;
      const offsetX = target.position.x / scale;
      const offsetY = target.position.y / scale;
      return {
        x: Math.round(offsetX + (logicalW - winW) / 2),
        y: Math.round(offsetY + (logicalH - winH) / 2),
      };
    }
  } catch {
    // fallback
  }
  return null;
};

const focusWindowSafely = async (win) => {
  if (!win) return;

  try {
    await win.unminimize();
  } catch {
    // Ignore unsupported operations on some platforms.
  }

  try {
    await win.show();
  } catch {
    // Ignore unsupported operations on some platforms.
  }

  try {
    await win.setFocus();
  } catch {
    // Ignore unsupported operations on some platforms.
  }
};

export const openImagePreview = async (imagePath, t) => {
  try {
    let originalPath = imagePath;
    try {
      const paths = JSON.parse(imagePath);
      originalPath = paths.original || paths.raw || imagePath;
    } catch {
      // 如果不是 JSON，直接使用原路径
    }

    const windowLabel = 'preview';
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      try {
        await existing.close();
      } catch {
        // Ignore if stale preview window is already closed.
      }
    }

    const PREVIEW_W = 800;
    const PREVIEW_H = 600;
    const pos = await centerOnCursorMonitor(PREVIEW_W, PREVIEW_H);

    const webview = new WebviewWindow(windowLabel, {
      url: `${resolveSubWindowUrl('public/preview.html', 'preview.html')}?path=${encodeURIComponent(originalPath)}`,
      title: t('preview.title'),
      width: PREVIEW_W,
      height: PREVIEW_H,
      ...(pos || { center: true }),
      resizable: true,
      alwaysOnTop: true,
      decorations: false,
      skipTaskbar: false
    });

    webview.once('tauri://created', () => {
      console.log(t('preview.created'));
    });

    webview.once('tauri://error', (e) => {
      console.error(t('preview.createFailed', { error: e }));
    });
  } catch (error) {
    console.error(t('preview.createFailed', { error }));
    alert(t('error.previewFailed', { error }));
  }
};

export const QUICK_INPUT_WINDOW_LABEL = 'quick-input';

export const openQuickInputWindow = async (t) => {
  const existing = await WebviewWindow.getByLabel(QUICK_INPUT_WINDOW_LABEL);
  if (existing) {
    await focusWindowSafely(existing);
    return existing;
  }

  const useTransparentFrame = isWindowsRuntime();

  const WIN_W = 460;
  const WIN_H = 360;
  const pos = await centerOnCursorMonitor(WIN_W, WIN_H);

  const webview = new WebviewWindow(QUICK_INPUT_WINDOW_LABEL, {
    url: resolveSubWindowUrl('quick-input.html'),
    title: t('quickInput.title'),
    width: WIN_W,
    height: WIN_H,
    minWidth: 360,
    minHeight: 260,
    ...(pos || { center: true }),
    resizable: true,
    alwaysOnTop: true,
    decorations: false,
    transparent: useTransparentFrame,
    shadow: false,
    skipTaskbar: false,
  });

  webview.once('tauri://created', async () => {
    await focusWindowSafely(webview);
  });

  webview.once('tauri://error', (e) => {
    console.error(t('quickInput.failed', { error: e }));
  });

  return webview;
};

const HISTORY_EDITOR_WINDOW_PREFIX = 'history-editor-';

const normalizeWindowLabelToken = (value) => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return normalized.slice(0, 80);
};

export const openHistoryEditorWindow = async (itemId, t) => {
  const normalizedItemId = typeof itemId === 'string' ? itemId.trim() : '';
  const labelToken = normalizeWindowLabelToken(normalizedItemId);
  if (!normalizedItemId || !labelToken) return null;

  const label = `${HISTORY_EDITOR_WINDOW_PREFIX}${labelToken}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await focusWindowSafely(existing);
    return existing;
  }

  const WIN_W = 620;
  const WIN_H = 620;
  const pos = await centerOnCursorMonitor(WIN_W, WIN_H);

  const webview = new WebviewWindow(label, {
    url: `${resolveSubWindowUrl('history-editor.html')}?itemId=${encodeURIComponent(normalizedItemId)}`,
    title: t('historyEditor.title'),
    width: WIN_W,
    height: WIN_H,
    minWidth: 420,
    minHeight: 460,
    ...(pos || { center: true }),
    resizable: true,
    alwaysOnTop: true,
    decorations: false,
    transparent: true,
    shadow: false,
    skipTaskbar: false,
  });

  webview.once('tauri://created', async () => {
    await focusWindowSafely(webview);
  });

  webview.once('tauri://error', (e) => {
    console.error(t('historyEditor.openFailed', { error: e }));
  });

  return webview;
};

export const toggleWindowAlwaysOnTop = async (currentState) => {
  const appWindow = getCurrentWindow();
  const newState = !currentState;
  await appWindow.setAlwaysOnTop(newState);
  return newState;
};

export const WIDGET_WINDOW_LABEL = 'widget';

export const openWidgetWindow = async () => {
  const existing = await WebviewWindow.getByLabel(WIDGET_WINDOW_LABEL);
  if (existing) {
    return existing;
  }

  const WIDGET_SIZE = 120;
  const MARGIN = 40;
  let x = 800;
  let y = 500;

  try {
    const target = await getMonitorAtCursor();
    if (target) {
      const scale = target.scaleFactor || 1;
      const logicalW = target.size.width / scale;
      const logicalH = target.size.height / scale;
      const offsetX = target.position.x / scale;
      const offsetY = target.position.y / scale;
      x = offsetX + logicalW - WIDGET_SIZE - MARGIN;
      y = offsetY + logicalH - WIDGET_SIZE - MARGIN - 48;
    }
  } catch {
    // fallback position
  }

  const webview = new WebviewWindow(WIDGET_WINDOW_LABEL, {
    url: resolveSubWindowUrl('widget.html'),
    title: 'Widget',
    width: 120,
    height: 120,
    x,
    y,
    resizable: false,
    alwaysOnTop: true,
    decorations: false,
    transparent: true,
    shadow: false,
    skipTaskbar: true,
    dragDropEnabled: true,
  });

  webview.once('tauri://error', (e) => {
    console.error('widget window creation failed:', e);
  });

  return webview;
};

export const closeWidgetWindow = async () => {
  const existing = await WebviewWindow.getByLabel(WIDGET_WINDOW_LABEL);
  if (existing) {
    try {
      await existing.close();
    } catch {
      // window may already be closed
    }
  }
};

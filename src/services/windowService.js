import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';

const isDevServer = () => window.location.hostname === 'localhost';

const resolveSubWindowUrl = (devPath, prodPath = devPath) => (
  isDevServer() ? `http://localhost:5173/${devPath}` : prodPath
);

const isWindowsRuntime = () => navigator.userAgent.toLowerCase().includes('windows');

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

    const windowLabel = `preview-${Date.now()}`;

    const webview = new WebviewWindow(windowLabel, {
      url: `${resolveSubWindowUrl('public/preview.html', 'preview.html')}?path=${encodeURIComponent(originalPath)}`,
      title: t('preview.title'),
      width: 800,
      height: 600,
      center: true,
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

  const webview = new WebviewWindow(QUICK_INPUT_WINDOW_LABEL, {
    url: resolveSubWindowUrl('quick-input.html'),
    title: t('quickInput.title'),
    width: 460,
    height: 360,
    minWidth: 360,
    minHeight: 260,
    center: true,
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
    const monitor = await currentMonitor();
    if (monitor) {
      const scale = monitor.scaleFactor || 1;
      const logicalW = monitor.size.width / scale;
      const logicalH = monitor.size.height / scale;
      const offsetX = (monitor.position?.x || 0) / scale;
      const offsetY = (monitor.position?.y || 0) / scale;
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

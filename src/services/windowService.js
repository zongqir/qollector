import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, cursorPosition, availableMonitors } from '@tauri-apps/api/window';

const isDevServer = () => window.location.hostname === 'localhost';

const resolveSubWindowUrl = (devPath, prodPath = devPath) => (
  isDevServer() ? `http://localhost:5173/${devPath}` : prodPath
);

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

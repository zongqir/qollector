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

export const BUBBLE_WINDOW_LABEL = 'bubble';

export const showBubbleWindow = async (payload, cursorOverride = null) => {
  let existing = await WebviewWindow.getByLabel(BUBBLE_WINDOW_LABEL);

  const BUBBLE_WIDTH = 380;
  const BUBBLE_HEIGHT = 44;

  let x = 600;
  let y = 400;

  try {
    const cursor = cursorOverride || await cursorPosition();
    const monitor = await getMonitorAtCursor();
    const scale = monitor?.scaleFactor || 1;

    // Convert cursor to logical coordinates
    const logicalCursorX = cursor.x / (cursorOverride ? 1 : scale);
    const logicalCursorY = cursor.y / (cursorOverride ? 1 : scale);

    x = logicalCursorX + 12;
    y = logicalCursorY - 48;

    if (monitor) {
      const monitorX = monitor.position.x / scale;
      const monitorY = monitor.position.y / scale;
      const monitorW = monitor.size.width / scale;
      const monitorH = monitor.size.height / scale;

      // Avoid popping off-screen right
      if (x + BUBBLE_WIDTH > monitorX + monitorW - 12) {
        x = Math.max(monitorX + 12, logicalCursorX - BUBBLE_WIDTH - 12);
      }
      // Avoid popping off-screen top
      if (y < monitorY + 10) {
        y = logicalCursorY + 24;
      }
      // Avoid popping off-screen bottom
      if (y + BUBBLE_HEIGHT > monitorY + monitorH - 10) {
        y = monitorY + monitorH - BUBBLE_HEIGHT - 12;
      }
    }
  } catch {
    // fallback coordinates
  }

  if (!existing) {
    existing = new WebviewWindow(BUBBLE_WINDOW_LABEL, {
      url: resolveSubWindowUrl('bubble.html'),
      title: 'Qollect Quick Action',
      width: BUBBLE_WIDTH,
      height: BUBBLE_HEIGHT,
      x: Math.round(x),
      y: Math.round(y),
      resizable: false,
      alwaysOnTop: true,
      decorations: false,
      transparent: true,
      shadow: false,
      skipTaskbar: true,
      visible: false,
    });

    await new Promise((resolve) => {
      existing.once('tauri://created', () => {
        setTimeout(resolve, 80);
      });
      existing.once('tauri://error', (e) => {
        console.error('bubble window creation failed:', e);
        resolve();
      });
    });
  } else {
    try {
      await existing.setPosition({
        type: 'Logical',
        x: Math.round(x),
        y: Math.round(y),
      });
    } catch {
      // ignore
    }
  }

  try {
    await existing.emit('quick-action-payload', payload);
    await existing.show();
  } catch (err) {
    console.error('failed to show bubble window:', err);
  }

  return existing;
};

export const closeBubbleWindow = async () => {
  const existing = await WebviewWindow.getByLabel(BUBBLE_WINDOW_LABEL);
  if (existing) {
    try {
      await existing.hide();
    } catch {
      // ignore
    }
  }
};


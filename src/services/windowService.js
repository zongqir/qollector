import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

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

    const isDev = window.location.hostname === 'localhost';
    const baseUrl = isDev
      ? 'http://localhost:5173/public/preview.html'
      : 'preview.html';

    const webview = new WebviewWindow(windowLabel, {
      url: `${baseUrl}?path=${encodeURIComponent(originalPath)}`,
      title: t('preview.title'),
      width: 800,
      height: 600,
      center: true,
      resizable: true,
      alwaysOnTop: true,
      decorations: false,
      skipTaskbar: false
    });

    await webview.once('tauri://created', () => {
      console.log(t('preview.created'));
    });

    await webview.once('tauri://error', (e) => {
      console.error(t('preview.createFailed', { error: e }));
    });
  } catch (error) {
    console.error(t('preview.createFailed', { error }));
    alert(t('error.previewFailed', { error }));
  }
};

export const toggleWindowAlwaysOnTop = async (currentState) => {
  const appWindow = getCurrentWindow();
  const newState = !currentState;
  await appWindow.setAlwaysOnTop(newState);
  return newState;
};

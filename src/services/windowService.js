import { getCurrentWindow } from '@tauri-apps/api/window';

export const toggleWindowAlwaysOnTop = async (currentState) => {
  const appWindow = getCurrentWindow();
  const newState = !currentState;
  await appWindow.setAlwaysOnTop(newState);
  return newState;
};

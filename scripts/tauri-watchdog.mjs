import { cleanupWindowsDevProcesses } from './tauri-dev-cleanup.mjs';

const parentPid = Number(process.argv[2]);
const childPid = Number(process.argv[3]);
const workspaceDir = process.argv[4];
const isWindows = process.platform === 'win32';

if (!isWindows || !parentPid || !childPid || !workspaceDir) {
  process.exit(0);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const timer = setInterval(() => {
  const parentAlive = isProcessAlive(parentPid);
  const childAlive = isProcessAlive(childPid);

  if (!childAlive) {
    clearInterval(timer);
    process.exit(0);
  }

  if (parentAlive) {
    return;
  }

  clearInterval(timer);
  cleanupWindowsDevProcesses({
    workspaceDir,
    childPid,
    stdio: 'ignore',
  });
  process.exit(0);
}, 1000);

timer.unref();

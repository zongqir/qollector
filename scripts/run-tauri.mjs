import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { cleanupWindowsDevProcesses } from './tauri-dev-cleanup.mjs';

const require = createRequire(import.meta.url);
const tauriCliEntry = require.resolve('@tauri-apps/cli/tauri.js');
const tauriArgs = process.argv.slice(2);
const isWindows = process.platform === 'win32';
const isDevCommand = tauriArgs[0] === 'dev';

let childExited = false;
let shuttingDown = false;
let cleanupRan = false;

const child = spawn(process.execPath, [tauriCliEntry, ...tauriArgs], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

if (isWindows && isDevCommand && child.pid) {
  const watchdog = spawn(
    process.execPath,
    [
      'scripts/tauri-watchdog.mjs',
      String(process.pid),
      String(child.pid),
      process.cwd(),
    ],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  watchdog.unref();
}

function forceKillTreeSync(pid) {
  if (!pid || cleanupRan || childExited) {
    return;
  }

  cleanupRan = true;

  if (!isWindows) {
    child.kill('SIGTERM');
    return;
  }

  cleanupWindowsDevProcesses({
    workspaceDir: process.cwd(),
    childPid: pid,
    stdio: 'inherit',
  });
}

function requestShutdown(signal) {
  if (shuttingDown || childExited) {
    return;
  }

  shuttingDown = true;
  console.log(`[tauri-wrapper] received ${signal}, stopping Tauri dev process tree...`);

  if (isWindows && isDevCommand) {
    forceKillTreeSync(child.pid);
    process.exit(130);
    return;
  }

  child.kill(signal);
}

child.on('exit', (code, signal) => {
  childExited = true;

  if (signal) {
    process.exit(1);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  childExited = true;
  console.error('[tauri-wrapper] failed to start Tauri CLI:', error);
  process.exit(1);
});

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
  process.on(signal, () => requestShutdown(signal));
});

process.on('exit', () => {
  if (!isDevCommand) {
    return;
  }

  forceKillTreeSync(child.pid);
});

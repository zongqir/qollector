import http from 'node:http';
import net from 'node:net';
import { spawn, execSync } from 'node:child_process';

const host = process.env.TAURI_DEV_HOST || 'localhost';
const port = Number(process.env.TAURI_DEV_PORT || 5173);
const probePath = '/@vite/client';
const probeTimeoutMs = 900;
const probeRetryCount = 6;
const probeRetryDelayMs = 500;

function probeHttp(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path: pathname,
        method: 'GET',
        timeout: probeTimeoutMs,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            statusCode: res.statusCode || 0,
            body,
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(probeTimeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hasReusableVite() {
  try {
    const result = await probeHttp(probePath);
    if (!result.ok) return false;
    const normalized = result.body.toLowerCase();
    return normalized.includes('vite');
  } catch {
    return false;
  }
}

function startDevServer() {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = isWindows ? ['/d', '/s', '/c', 'npm run dev:server'] : ['run', 'dev:server'];

  let child;
  try {
    child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
  } catch (error) {
    console.error('[dev:ensure] Failed to spawn dev server process:', error);
    process.exit(1);
    return;
  }

  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));

  child.on('error', (error) => {
    console.error('[dev:ensure] Dev server process error:', error);
    process.exit(1);
  });

  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      if (child.killed) return;
      if (isWindows) {
        child.kill();
      } else {
        child.kill(signal);
      }
    });
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
      return;
    }
    process.exit(code ?? 0);
  });
}

function getConflictingProcessInfo(targetPort) {
  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = output.split('\n');
      const pids = new Set();
      for (const line of lines) {
        if (line.includes(`:${targetPort}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(Number(pid))) {
            pids.add(pid);
          }
        }
      }
      if (pids.size > 0) {
        const pidList = Array.from(pids).join(',');
        const psOutput = execSync(
          `powershell -NoProfile -Command "Get-Process -Id ${pidList} -ErrorAction SilentlyContinue | ForEach-Object { \\"$($_.Id) ($($_.ProcessName))\\" }"`,
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        );
        const details = psOutput.trim().split('\n').map((l) => l.trim()).filter(Boolean).join(', ');
        return details || Array.from(pids).join(', ');
      }
    } else {
      const output = execSync(`lsof -i :${targetPort} -sTCP:LISTEN -t`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pid = output.trim();
      if (pid) {
        return `PID ${pid}`;
      }
    }
  } catch {
    // fallback gracefully
  }
  return null;
}

async function main() {
  if (await hasReusableVite()) {
    console.log(`[dev:ensure] Reusing existing Vite server at http://${host}:${port}`);
    return;
  }

  if (await isPortOpen()) {
    for (let i = 0; i < probeRetryCount; i += 1) {
      await sleep(probeRetryDelayMs);
      if (await hasReusableVite()) {
        console.log(`[dev:ensure] Reusing existing Vite server at http://${host}:${port}`);
        return;
      }
    }

    const conflict = getConflictingProcessInfo(port);
    const detailMsg = conflict ? ` (PID/Process: ${conflict})` : '';
    console.error(
      `[dev:ensure] Port ${port} is already occupied by a non-Vite process${detailMsg}. ` +
      'Please free the port or stop the conflicting app.',
    );
    process.exit(1);
    return;
  }

  console.log(`[dev:ensure] Starting Vite server at http://${host}:${port}`);
  startDevServer();
}

main().catch((error) => {
  console.error('[dev:ensure] Failed to ensure dev server:', error);
  process.exit(1);
});

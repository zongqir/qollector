import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.join(ROOT_DIR, 'output', 'playwright');

function parseArgs(argv) {
  const result = {
    mode: 'current',
    clean: false,
  };
  argv.forEach((arg) => {
    if (arg.startsWith('--mode=')) {
      result.mode = arg.split('=')[1] || result.mode;
    }
    if (arg === '--clean') {
      result.clean = true;
    }
  });
  if (result.mode !== 'baseline' && result.mode !== 'current') {
    throw new Error(`Unsupported mode: ${result.mode}`);
  }
  return result;
}

function getModifierKey() {
  return process.platform === 'darwin' ? 'Meta' : 'Control';
}

function getScenarios(modifierKey) {
  return [
    {
      id: 'desktop-main',
      viewport: { width: 1366, height: 900 },
      prepare: async ({ page, baseUrl }) => {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
      },
    },
    {
      id: 'desktop-shortcut-help',
      viewport: { width: 1366, height: 900 },
      prepare: async ({ page, baseUrl }) => {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.keyboard.press('Shift+Slash');
      },
    },
    {
      id: 'desktop-density-compact',
      viewport: { width: 1366, height: 900 },
      prepare: async ({ page, baseUrl }) => {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.keyboard.press(`${modifierKey}+Shift+D`);
      },
    },
    {
      id: 'desktop-mini-mode',
      viewport: { width: 1366, height: 900 },
      prepare: async ({ page, baseUrl }) => {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        const miniBtn = page.locator('.titlebar-btn.mini-btn').first();
        if (await miniBtn.count()) {
          await miniBtn.click();
        }
      },
    },
    {
      id: 'mobile-main',
      viewport: { width: 390, height: 844 },
      prepare: async ({ page, baseUrl }) => {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
      },
    },
  ];
}

async function ensureOutputDir(dirPath, clean) {
  await mkdir(dirPath, { recursive: true });
  if (!clean) return;
  const entries = await readdir(dirPath, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isFile() && entry.name.endsWith('.png')) {
      await rm(entryPath, { force: true });
    }
  }));
}

async function waitForServer(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw new Error(`Timed out waiting for server: ${url}`);
}

function startServerIfNeeded(baseUrl, port) {
  if (process.env.VISUAL_BASELINE_SKIP_SERVER === '1') {
    return null;
  }
  const defaultCmd = `npm run dev -- --host 127.0.0.1 --port ${port}`;
  const command = process.env.VISUAL_BASELINE_SERVER_CMD || defaultCmd;
  let child = null;
  try {
    child = spawn(command, {
      cwd: ROOT_DIR,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (error) {
    throw new Error(`failed to start dev server: ${error?.message || error}`);
  }
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[visual:server] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[visual:server] ${chunk}`);
  });
  child.on('error', (error) => {
    console.error(`[visual] dev server process error: ${error?.message || error}`);
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.warn(`[visual] dev server exited with code ${code}`);
    }
  });
  return { child, baseUrl };
}

function stopServer(serverProcess) {
  if (!serverProcess?.child?.pid) return;
  const pid = serverProcess.child.pid;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
      return;
    }
    serverProcess.child.kill('SIGTERM');
  } catch {
    // ignore cleanup errors
  }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.error('[visual] Missing dependency: playwright');
    console.error('[visual] Install once: npm install -D playwright');
    console.error('[visual] Then install browser: npx playwright install chromium');
    process.exit(1);
  }
}

async function capture() {
  const { mode, clean } = parseArgs(process.argv.slice(2));
  const port = process.env.VISUAL_BASELINE_PORT || '4173';
  const baseUrl = process.env.VISUAL_BASELINE_BASE_URL || `http://127.0.0.1:${port}`;
  const outputDir = path.join(OUTPUT_ROOT, mode);
  const modifierKey = getModifierKey();
  const scenarios = getScenarios(modifierKey);

  await ensureOutputDir(outputDir, clean);
  const { chromium } = await loadPlaywright();

  const server = startServerIfNeeded(baseUrl, port);
  try {
    await waitForServer(baseUrl);
  } catch (error) {
    stopServer(server);
    throw error;
  }

  const browser = await chromium.launch({ headless: true });

  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: scenario.viewport });
      const page = await context.newPage();
      await scenario.prepare({ page, baseUrl });
      await page.waitForSelector('.app', { timeout: 15000 });
      await page.waitForTimeout(450);
      const outputPath = path.join(outputDir, `${scenario.id}.png`);
      await page.screenshot({ path: outputPath, fullPage: false });
      await context.close();
      console.log(`[visual] captured ${mode}/${scenario.id}.png`);
    }
  } finally {
    await browser.close();
    stopServer(server);
  }

  const manifest = {
    mode,
    capturedAt: new Date().toISOString(),
    baseUrl,
    scenarios: scenarios.map(s => ({ id: s.id, viewport: s.viewport })),
  };
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[visual] capture complete: ${outputDir}`);
}

capture().catch((error) => {
  console.error('[visual] capture failed:', error?.message || error);
  process.exit(1);
});

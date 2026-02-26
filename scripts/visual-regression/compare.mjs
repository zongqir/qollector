import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.join(ROOT_DIR, 'output', 'playwright');
const BASELINE_DIR = path.join(OUTPUT_ROOT, 'baseline');
const CURRENT_DIR = path.join(OUTPUT_ROOT, 'current');
const DIFF_DIR = path.join(OUTPUT_ROOT, 'diff');
const REPORT_PATH = path.join(OUTPUT_ROOT, 'report.json');

function parseArgs(argv) {
  const result = {
    threshold: Number(process.env.VISUAL_DIFF_THRESHOLD || 16),
    maxChangedRatio: Number(process.env.VISUAL_MAX_CHANGED_RATIO || 0.0015),
  };
  argv.forEach((arg) => {
    if (arg.startsWith('--threshold=')) {
      result.threshold = Number(arg.split('=')[1]);
    }
    if (arg.startsWith('--maxChangedRatio=')) {
      result.maxChangedRatio = Number(arg.split('=')[1]);
    }
  });
  return result;
}

async function listPngFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.png'))
    .map(entry => entry.name)
    .sort();
}

async function loadImageRaw(filePath) {
  return sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function buildDiffBuffer(baseBuffer, currentBuffer, pixelThreshold) {
  const diffBuffer = Buffer.alloc(baseBuffer.length);
  let changedPixels = 0;

  for (let i = 0; i < baseBuffer.length; i += 4) {
    const dr = Math.abs(baseBuffer[i] - currentBuffer[i]);
    const dg = Math.abs(baseBuffer[i + 1] - currentBuffer[i + 1]);
    const db = Math.abs(baseBuffer[i + 2] - currentBuffer[i + 2]);
    const da = Math.abs(baseBuffer[i + 3] - currentBuffer[i + 3]);
    const delta = dr + dg + db + da;

    if (delta > pixelThreshold) {
      changedPixels += 1;
      diffBuffer[i] = 255;
      diffBuffer[i + 1] = 26;
      diffBuffer[i + 2] = 117;
      diffBuffer[i + 3] = 255;
      continue;
    }

    const gray = Math.round((currentBuffer[i] + currentBuffer[i + 1] + currentBuffer[i + 2]) / 3);
    diffBuffer[i] = gray;
    diffBuffer[i + 1] = gray;
    diffBuffer[i + 2] = gray;
    diffBuffer[i + 3] = 165;
  }

  return { diffBuffer, changedPixels };
}

async function compare() {
  const { threshold, maxChangedRatio } = parseArgs(process.argv.slice(2));
  await mkdir(DIFF_DIR, { recursive: true });

  const baselineFiles = await listPngFiles(BASELINE_DIR);
  if (baselineFiles.length === 0) {
    console.error('[visual] no baseline images found. Run: npm run visual:baseline:capture');
    process.exit(1);
  }

  const report = {
    comparedAt: new Date().toISOString(),
    threshold,
    maxChangedRatio,
    summary: {
      files: baselineFiles.length,
      passed: 0,
      failed: 0,
    },
    files: [],
  };

  let hasFailure = false;

  for (const filename of baselineFiles) {
    const baselinePath = path.join(BASELINE_DIR, filename);
    const currentPath = path.join(CURRENT_DIR, filename);
    const diffPath = path.join(DIFF_DIR, filename);

    const entry = {
      file: filename,
      status: 'pass',
      changedPixels: 0,
      changedRatio: 0,
      width: 0,
      height: 0,
      reason: '',
    };

    try {
      const baselineImage = await loadImageRaw(baselinePath);
      const currentImage = await loadImageRaw(currentPath);
      const { width, height } = baselineImage.info;
      entry.width = width;
      entry.height = height;

      if (width !== currentImage.info.width || height !== currentImage.info.height) {
        entry.status = 'fail';
        entry.reason = `size mismatch: baseline ${width}x${height}, current ${currentImage.info.width}x${currentImage.info.height}`;
        hasFailure = true;
      } else {
        const pixelThreshold = Math.max(0, Math.round(threshold) * 4);
        const { diffBuffer, changedPixels } = buildDiffBuffer(
          baselineImage.data,
          currentImage.data,
          pixelThreshold,
        );

        const totalPixels = width * height;
        const changedRatio = totalPixels === 0 ? 0 : changedPixels / totalPixels;
        entry.changedPixels = changedPixels;
        entry.changedRatio = Number(changedRatio.toFixed(6));

        if (changedPixels > 0) {
          await sharp(diffBuffer, { raw: { width, height, channels: 4 } })
            .png()
            .toFile(diffPath);
        } else {
          await rm(diffPath, { force: true }).catch(() => {});
        }

        if (changedRatio > maxChangedRatio) {
          entry.status = 'fail';
          entry.reason = `changed ratio ${entry.changedRatio} exceeds limit ${maxChangedRatio}`;
          hasFailure = true;
        }
      }
    } catch (error) {
      entry.status = 'fail';
      entry.reason = `compare error: ${error?.message || error}`;
      hasFailure = true;
    }

    report.files.push(entry);
    if (entry.status === 'pass') report.summary.passed += 1;
    else report.summary.failed += 1;
  }

  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[visual] report: ${REPORT_PATH}`);
  console.log(`[visual] passed: ${report.summary.passed}, failed: ${report.summary.failed}`);

  if (hasFailure) {
    process.exit(1);
  }
}

compare().catch((error) => {
  console.error('[visual] compare failed:', error?.message || error);
  process.exit(1);
});

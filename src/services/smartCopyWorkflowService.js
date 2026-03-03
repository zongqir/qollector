import { getRecentItemsLight } from './clipboardService';
import { smartCopyFromImagePath, startSystemScreenCapture } from './smartCopyService';

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 380;
const RECENT_ITEMS_LIMIT = 6;

const sleep = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const parseImagePath = (item) => {
  const imagePathsRaw = item?.image_paths;
  if (typeof imagePathsRaw !== 'string' || !imagePathsRaw.trim()) return '';

  try {
    const parsed = JSON.parse(imagePathsRaw);
    const original = typeof parsed?.original === 'string' ? parsed.original.trim() : '';
    if (original) return original;
    const raw = typeof parsed?.raw === 'string' ? parsed.raw.trim() : '';
    if (raw) return raw;
  } catch {
    // Fallback to plain path string.
  }

  return imagePathsRaw.trim();
};

const collectNewCandidates = (items, baselineId, startedAtUnixSec, checkedIds) => {
  if (!Array.isArray(items)) return [];

  return items.filter((item) => {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || id === baselineId || checkedIds.has(id)) return false;
    const createdAt = Number(item?.created_at || 0);
    return Number.isFinite(createdAt) && createdAt >= startedAtUnixSec;
  });
};

export const runSmartCopyCaptureWorkflow = async (options = {}) => {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs)
    ? options.pollIntervalMs
    : DEFAULT_POLL_INTERVAL_MS;
  const copyToClipboard = options.copyToClipboard ?? true;

  const beforeStartList = await getRecentItemsLight(1).catch(() => []);
  const baselineId = beforeStartList?.[0]?.id || null;
  const startedAtUnixSec = Math.floor(Date.now() / 1000) - 1;
  const deadlineAt = Date.now() + timeoutMs;
  const checkedIds = new Set();

  await startSystemScreenCapture();

  let lastError = null;
  while (Date.now() < deadlineAt) {
    await sleep(pollIntervalMs);

    let recentItems = [];
    try {
      recentItems = await getRecentItemsLight(RECENT_ITEMS_LIMIT);
    } catch {
      // Keep polling; clipboard monitor may still be writing.
      continue;
    }

    const candidates = collectNewCandidates(recentItems, baselineId, startedAtUnixSec, checkedIds);
    for (const candidate of candidates) {
      checkedIds.add(candidate.id);
      if (candidate.type_ !== 'image') continue;

      const imagePath = parseImagePath(candidate);
      if (!imagePath) continue;

      try {
        const text = await smartCopyFromImagePath(imagePath, { copyToClipboard });
        return {
          itemId: candidate.id,
          imagePath,
          text,
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('SMART_COPY_TIMEOUT');
};

import { getRecentItemsLight } from './clipboardService';
import { smartCopyFromImagePath, startSystemScreenCapture } from './smartCopyService';

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 380;
const DEFAULT_SETTLE_MS = 900;
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
  const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : DEFAULT_SETTLE_MS;
  const copyToClipboard = options.copyToClipboard ?? true;

  const beforeStartList = await getRecentItemsLight(1).catch(() => []);
  const baselineId = beforeStartList?.[0]?.id || null;
  const startedAtUnixSec = Math.floor(Date.now() / 1000);
  const deadlineAt = Date.now() + timeoutMs;
  const checkedIds = new Set();
  let pendingCandidate = null;
  let pendingSinceMs = 0;

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
    const nowMs = Date.now();
    const imageCandidates = candidates
      .filter((item) => item?.type_ === 'image')
      .map((item) => ({ item, imagePath: parseImagePath(item) }))
      .filter(({ imagePath }) => Boolean(imagePath))
      .sort((left, right) => Number(right.item?.created_at || 0) - Number(left.item?.created_at || 0));

    const newest = imageCandidates[0] || null;
    if (newest) {
      const newestId = newest.item.id;
      if (!pendingCandidate || pendingCandidate.item.id !== newestId) {
        pendingCandidate = newest;
        pendingSinceMs = nowMs;
      }
    }

    if (!pendingCandidate) {
      continue;
    }

    if ((nowMs - pendingSinceMs) < settleMs) {
      continue;
    }

    checkedIds.add(pendingCandidate.item.id);
    try {
      const text = await smartCopyFromImagePath(pendingCandidate.imagePath, { copyToClipboard });
      return {
        itemId: pendingCandidate.item.id,
        imagePath: pendingCandidate.imagePath,
        text,
      };
    } catch (error) {
      lastError = error;
      pendingCandidate = null;
      pendingSinceMs = 0;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('SMART_COPY_TIMEOUT');
};

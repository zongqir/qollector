const DEFAULT_PAGE_SIZE = 30;
const MAX_ITEMS_IN_MEMORY = 150;
const LOW_MEMORY_PAGE_SIZE = 20;
const LOW_MEMORY_MAX_ITEMS_IN_MEMORY = 80;
const MEMORY_PROBE_PREFIX = '[MemoryProbe]';

const toLen = (value) => (typeof value === 'string' ? value.length : 0);

const summarizeItemsForMemory = (items) => {
  let totalContentChars = 0;
  let totalOcrChars = 0;
  let totalNoteChars = 0;
  let maxContentChars = 0;
  let maxOcrChars = 0;
  let longContentItems = 0;
  let longOcrItems = 0;

  for (const item of items) {
    const contentLen = toLen(item?.content);
    const ocrLen = toLen(item?.ocr_text);
    const noteLen = toLen(item?.user_note);

    totalContentChars += contentLen;
    totalOcrChars += ocrLen;
    totalNoteChars += noteLen;

    if (contentLen > maxContentChars) maxContentChars = contentLen;
    if (ocrLen > maxOcrChars) maxOcrChars = ocrLen;
    if (contentLen >= 2000) longContentItems += 1;
    if (ocrLen >= 2000) longOcrItems += 1;
  }

  return {
    items: items.length,
    totalContentChars,
    totalOcrChars,
    totalNoteChars,
    maxContentChars,
    maxOcrChars,
    longContentItems,
    longOcrItems,
  };
};

export const logItemsMemoryProbe = (stage, items, extra = {}) => {
  console.log(`${MEMORY_PROBE_PREFIX} ${stage}`, {
    ...summarizeItemsForMemory(items),
    ...extra,
  });
};

const sortByUpdatedAtDesc = (a, b) => {
  const timeDiff = (b?.updated_at || 0) - (a?.updated_at || 0);
  if (timeDiff !== 0) return timeDiff;
  return String(b?.id || '').localeCompare(String(a?.id || ''));
};

export const mergeUniqueById = (baseItems, incomingItems) => {
  const map = new Map();
  [...baseItems, ...incomingItems].forEach((item) => {
    if (!item?.id) return;
    const prev = map.get(item.id);
    if (!prev || (item.updated_at || 0) >= (prev.updated_at || 0)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values()).sort(sortByUpdatedAtDesc);
};

export const getItemsMemoryCap = (lowMemoryModeEnabled) => (
  lowMemoryModeEnabled ? LOW_MEMORY_MAX_ITEMS_IN_MEMORY : MAX_ITEMS_IN_MEMORY
);

export const getItemsPageSize = (lowMemoryModeEnabled) => (
  lowMemoryModeEnabled ? LOW_MEMORY_PAGE_SIZE : DEFAULT_PAGE_SIZE
);

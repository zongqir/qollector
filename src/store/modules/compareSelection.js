export const MAX_COMPARE_CANDIDATES = 50;

export const normalizeCompareCandidateIds = (value) => {
  const raw = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const candidate of raw) {
    const id = typeof candidate === 'string' ? candidate : candidate?.id;
    if (!id || normalized.includes(id)) continue;
    normalized.push(id);
    if (normalized.length >= MAX_COMPARE_CANDIDATES) break;
  }
  return normalized;
};

export const normalizeCompareItemIds = (value) => (
  normalizeCompareCandidateIds(value).slice(0, 2)
);

export function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function getEndOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return Math.floor(d.getTime() / 1000);
}

export function getDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function dateStringToTimestamp(str) {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  return Math.floor(d.getTime() / 1000);
}

export function dateStringToEndTimestamp(str) {
  if (!str) return null;
  const d = new Date(str + 'T23:59:59');
  return Math.floor(d.getTime() / 1000);
}

export function getDateRangeForPreset(preset) {
  const end = getEndOfToday();
  switch (preset) {
    case 'today':
      return { preset, start: getStartOfToday(), end };
    case 'yesterday': {
      const yStart = getDaysAgo(1);
      const yEnd = new Date();
      yEnd.setDate(yEnd.getDate() - 1);
      yEnd.setHours(23, 59, 59, 999);
      return { preset, start: yStart, end: Math.floor(yEnd.getTime() / 1000) };
    }
    case '7d':
      return { preset, start: getDaysAgo(6), end };
    case '30d':
      return { preset, start: getDaysAgo(29), end };
    default:
      return null;
  }
}

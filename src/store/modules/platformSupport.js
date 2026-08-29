export const detectClientPlatform = () => {
  if (typeof navigator === 'undefined') return 'other';
  const raw = (
    navigator.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent
    || ''
  ).toLowerCase();
  if (raw.includes('win')) return 'windows';
  if (raw.includes('mac')) return 'macos';
  if (raw.includes('linux')) return 'linux';
  return 'other';
};

export const SUPPORTS_AUTO_PASTE_ON_DOUBLE_CLICK = detectClientPlatform() === 'windows';
export const SUPPORTS_COPY_ON_SELECT = detectClientPlatform() === 'windows';

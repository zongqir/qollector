export const CARD_BACKGROUND_DEFAULT_ID = 'default';
export const CARD_BACKGROUND_METADATA_KEY = 'card_bg';

export const CARD_BACKGROUND_PRESETS = [
  {
    id: CARD_BACKGROUND_DEFAULT_ID,
    accent: '',
    dot: 'var(--bg-card)',
    labelKey: 'item.cardBackground.default',
  },
  {
    id: 'sand',
    accent: '#f1cd72',
    dot: '#f1cd72',
    labelKey: 'item.cardBackground.sand',
  },
  {
    id: 'mint',
    accent: '#76d6a7',
    dot: '#76d6a7',
    labelKey: 'item.cardBackground.mint',
  },
  {
    id: 'sky',
    accent: '#7eb5ff',
    dot: '#7eb5ff',
    labelKey: 'item.cardBackground.sky',
  },
  {
    id: 'rose',
    accent: '#f4a2ca',
    dot: '#f4a2ca',
    labelKey: 'item.cardBackground.rose',
  },
  {
    id: 'violet',
    accent: '#b79fff',
    dot: '#b79fff',
    labelKey: 'item.cardBackground.violet',
  },
];

const PRESET_BY_ID = new Map(CARD_BACKGROUND_PRESETS.map((preset) => [preset.id, preset]));

const parseMetadataObject = (metadataStr) => {
  if (!metadataStr || typeof metadataStr !== 'string') return {};
  try {
    const parsed = JSON.parse(metadataStr);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
};

export const normalizeCardBackgroundId = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !PRESET_BY_ID.has(normalized)) {
    return CARD_BACKGROUND_DEFAULT_ID;
  }
  return normalized;
};

export const getCardBackgroundPreset = (value) => (
  PRESET_BY_ID.get(normalizeCardBackgroundId(value)) || CARD_BACKGROUND_PRESETS[0]
);

export const getCardBackgroundIdFromMetadata = (metadataStr) => {
  const metadata = parseMetadataObject(metadataStr);
  return normalizeCardBackgroundId(metadata[CARD_BACKGROUND_METADATA_KEY]);
};

export const withCardBackgroundInMetadata = (metadataStr, value) => {
  const nextBackgroundId = normalizeCardBackgroundId(value);
  const metadata = parseMetadataObject(metadataStr);

  if (nextBackgroundId === CARD_BACKGROUND_DEFAULT_ID) {
    delete metadata[CARD_BACKGROUND_METADATA_KEY];
  } else {
    metadata[CARD_BACKGROUND_METADATA_KEY] = nextBackgroundId;
  }

  const keys = Object.keys(metadata);
  if (keys.length === 0) return null;
  return JSON.stringify(metadata);
};

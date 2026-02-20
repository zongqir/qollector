const PROFILE_MAP = Object.freeze({
  summarize: {
    taskType: 'summarize',
    supportsTone: true,
    supportsLength: true,
    defaultTone: 'neutral',
    defaultLength: 'short',
    quickOutputEnabled: true,
    quickOutputPreset: {
      tone: 'professional',
      length: 'short',
      extraInstruction:
        'Treat the input as merged clipboard snippets. Remove duplicates and keep only decision-relevant facts.',
    },
  },
  rewrite: {
    taskType: 'rewrite',
    supportsTone: true,
    supportsLength: true,
    defaultTone: 'neutral',
    defaultLength: 'medium',
    quickOutputEnabled: true,
    quickOutputPreset: {
      tone: 'professional',
      length: 'medium',
      extraInstruction:
        'Keep all named entities, numbers, and constraints unchanged while improving readability.',
    },
  },
  extract: {
    taskType: 'extract',
    supportsTone: true,
    supportsLength: true,
    defaultTone: 'direct',
    defaultLength: 'short',
    quickOutputEnabled: true,
    quickOutputPreset: {
      tone: 'direct',
      length: 'short',
      extraInstruction:
        'Prioritize mechanism, contradiction, and an executable principle instead of restating details.',
    },
  },
  translate: {
    taskType: 'translate',
    supportsTone: false,
    supportsLength: false,
    defaultTone: 'neutral',
    defaultLength: 'medium',
    quickOutputEnabled: false,
  },
  reply: {
    taskType: 'reply',
    supportsTone: true,
    supportsLength: true,
    defaultTone: 'friendly',
    defaultLength: 'short',
    quickOutputEnabled: true,
    quickOutputPreset: {
      tone: 'friendly',
      length: 'short',
      extraInstruction:
        'Return a directly sendable reply with no placeholders and no additional explanation.',
    },
  },
});

const DEFAULT_TASK = 'extract';

export const AI_ACTION_TASKS = Object.keys(PROFILE_MAP);

export const QUICK_OUTPUT_TASKS = AI_ACTION_TASKS.filter(
  (taskType) => PROFILE_MAP[taskType].quickOutputEnabled
);

export const getAiActionProfile = (taskType) => {
  if (taskType && PROFILE_MAP[taskType]) return PROFILE_MAP[taskType];
  return PROFILE_MAP[DEFAULT_TASK];
};

const countByType = (items) => {
  const counts = {
    text: 0,
    link: 0,
    image: 0,
    file: 0,
    other: 0,
  };
  let totalChars = 0;

  for (const item of items) {
    const type = item?.type_;
    if (type === 'text' || type === 'link' || type === 'image' || type === 'file') {
      counts[type] += 1;
    } else {
      counts.other += 1;
    }

    const content = String(
      item?.content || (type === 'image' ? item?.ocr_text || '' : '')
    );
    totalChars += content.trim().length;
  }

  return { counts, totalChars };
};

export const resolveQuickOutputTaskFromItems = (items, fallbackTask = DEFAULT_TASK) => {
  if (!Array.isArray(items) || items.length === 0) {
    return fallbackTask;
  }

  const { counts, totalChars } = countByType(items);
  const totalCount = items.length;

  if (counts.link >= Math.max(2, Math.ceil(totalCount * 0.45))) {
    return 'summarize';
  }

  if ((counts.image + counts.file) >= Math.max(1, Math.ceil(totalCount * 0.5))) {
    return 'extract';
  }

  if (counts.text >= Math.max(1, Math.ceil(totalCount * 0.5))) {
    if (totalCount >= 4 || totalChars >= 1800) {
      return 'summarize';
    }
    return 'extract';
  }

  return fallbackTask;
};

export const getActionExecutionPreset = (taskType, mode = 'panel') => {
  const profile = getAiActionProfile(taskType);
  const quickPreset = mode === 'quick-output' ? profile.quickOutputPreset : null;

  return {
    tone: profile.supportsTone ? (quickPreset?.tone || profile.defaultTone) : null,
    length: profile.supportsLength ? (quickPreset?.length || profile.defaultLength) : null,
    extraInstruction: quickPreset?.extraInstruction || null,
  };
};

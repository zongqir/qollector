export const PREVIEW_CLICK_DELAY_MS = 250;
export const SORT_MODE_LONG_PRESS_MS = 190;
export const SORT_MODE_LONG_PRESS_MOVE_PX = 10;

const LONG_PRESS_IGNORE_SELECTOR = 'button, input, textarea, select, a, [data-longpress-ignore="true"]';
const DOUBLE_CLICK_IGNORE_SELECTOR = [
  LONG_PRESS_IGNORE_SELECTOR,
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="dialog"]',
  '.panel-card-action-btn',
].join(', ');

export const shouldIgnoreLongPressTarget = (target) => {
  if (typeof Element === 'undefined') return false;
  return target instanceof Element && Boolean(target.closest(LONG_PRESS_IGNORE_SELECTOR));
};

export const shouldIgnoreCardDoubleClickTarget = (target) => {
  if (typeof Element === 'undefined') return false;
  return target instanceof Element && Boolean(target.closest(DOUBLE_CLICK_IGNORE_SELECTOR));
};

export const openItemPreview = (setPanelMode, item, options) => {
  if (typeof setPanelMode !== 'function' || !item) return;
  setPanelMode('preview', item, options);
};

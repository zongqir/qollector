export const PREVIEW_CLICK_DELAY_MS = 250;
export const SORT_MODE_LONG_PRESS_MS = 190;
export const SORT_MODE_LONG_PRESS_MOVE_PX = 10;

// All interactive sub-elements within a card that should not trigger card-level actions
export const INTERACTIVE_SUB_ELEMENT_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'a',
  '[role="button"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="dialog"]',
  '[contenteditable="true"]',
  '[data-longpress-ignore="true"]',
  '.color-picker-popover',
  '.panel-card-action-btn',
  '.compact-card-action-btn',
  '.compact-card-select-toggle',
].join(', ');

export const shouldIgnoreLongPressTarget = (target) => {
  if (typeof Element === 'undefined') return false;
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_SUB_ELEMENT_SELECTOR));
};

export const shouldIgnoreDragStartTarget = (target) => {
  if (typeof Element === 'undefined') return false;
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_SUB_ELEMENT_SELECTOR));
};

export const shouldIgnoreCardDoubleClickTarget = (target, currentTarget = null) => {
  if (typeof Element === 'undefined') return false;
  if (!(target instanceof Element)) return false;
  const ignoredTarget = target.closest(INTERACTIVE_SUB_ELEMENT_SELECTOR);
  if (!ignoredTarget) return false;
  if (currentTarget instanceof Element && ignoredTarget === currentTarget) {
    return false;
  }
  return true;
};

export const openItemPreview = (setPanelMode, item, options) => {
  if (typeof setPanelMode !== 'function' || !item) return;
  setPanelMode('preview', item, options);
};

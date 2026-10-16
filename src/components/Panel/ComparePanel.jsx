import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  Copy,
  Eye,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Star,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';
import useAppStore from '../../store/useAppStore';
import { getFileList, getFileName, getContentPreview, parseUrl } from '../../utils/formatters';
import { getImageThumbnail } from '../../utils/imageHelpers';

const EMPTY_COMPARE_ITEMS = [];

const selectItemsByIds = (state, ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return EMPTY_COMPARE_ITEMS;
  const indexedItems = state.itemsById;
  if (indexedItems instanceof Map) {
    return ids
      .map((id) => indexedItems.get(id))
      .filter(Boolean);
  }

  const targets = new Set(ids);
  const fallbackItemsById = new Map();
  state.items.forEach((item) => {
    if (targets.has(item.id)) {
      fallbackItemsById.set(item.id, item);
    }
  });

  return ids
    .map((id) => fallbackItemsById.get(id))
    .filter(Boolean);
};

const getComparableText = (item) => {
  if (!item) return '';
  if (item.type_ === 'image') return item.ocr_text || '';
  return item.content || '';
};

const normalizeInlineText = (value) => (
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
);

const truncateText = (value, limit = 64) => {
  const normalized = normalizeInlineText(value);
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
};

const buildCandidatePreview = (item, t) => {
  if (!item) return t('item.unknown');
  if (item.type_ === 'file') {
    const fileNames = getFileList(item.content).map(path => getFileName(path)).filter(Boolean);
    if (fileNames.length === 0) return t('search.typeFilter.file');
    return truncateText(fileNames.join(' · '), 80);
  }
  if (item.type_ === 'image') {
    const text = item.ocr_text || '';
    return text ? truncateText(text, 80) : t('search.typeFilter.image');
  }
  if (item.type_ === 'link') {
    return truncateText(item.content || '', 80);
  }
  return truncateText(item.content || '', 80);
};

const buildDiffSegments = (leftRaw, rightRaw) => {
  const left = typeof leftRaw === 'string' ? leftRaw : '';
  const right = typeof rightRaw === 'string' ? rightRaw : '';

  let prefixLen = 0;
  while (
    prefixLen < left.length
    && prefixLen < right.length
    && left[prefixLen] === right[prefixLen]
  ) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < (left.length - prefixLen)
    && suffixLen < (right.length - prefixLen)
    && left[left.length - 1 - suffixLen] === right[right.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const leftMiddleEnd = left.length - suffixLen;
  const rightMiddleEnd = right.length - suffixLen;
  const leftChanged = left.slice(prefixLen, leftMiddleEnd);
  const rightChanged = right.slice(prefixLen, rightMiddleEnd);

  return {
    hasDiff: left !== right,
    changedChars: Math.max(leftChanged.length, rightChanged.length),
    left: {
      prefix: left.slice(0, prefixLen),
      changed: leftChanged,
      suffix: left.slice(leftMiddleEnd),
    },
    right: {
      prefix: right.slice(0, prefixLen),
      changed: rightChanged,
      suffix: right.slice(rightMiddleEnd),
    },
  };
};

const renderDiffSegments = (segments) => (
  <>
    <span>{segments.prefix}</span>
    {segments.changed && <mark className="compare-diff-mark">{segments.changed}</mark>}
    <span>{segments.suffix}</span>
  </>
);

function ComparePanel() {
  const { t } = useTranslation();
  const compareCandidateIds = useAppStore(s => s.compareCandidateIds);
  const compareItemIds = useAppStore(s => s.compareItemIds);
  const setCompareItemIds = useAppStore(s => s.setCompareItemIds);
  const switchToWorkbench = useAppStore(s => s.switchToWorkbench);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const setHistoryStreamEnabled = useAppStore(s => s.setHistoryStreamEnabled);
  const historyStreamEnabled = useAppStore(s => s.historyStreamEnabled);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const handleCopy = useAppStore(s => s.handleCopy);
  const handleCopyPlainText = useAppStore(s => s.handleCopyPlainText);
  const [diffOnlyMode, setDiffOnlyMode] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [openSelectorSide, setOpenSelectorSide] = useState(null);
  const [selectorActiveIndex, setSelectorActiveIndex] = useState({ left: 0, right: 0 });
  const feedbackTimerRef = useRef(null);
  const focusManagedRef = useRef(false);
  const historyVisibleBeforeFocusRef = useRef(true);
  const selectorAreaRef = useRef(null);
  const selectorTriggerRefs = useRef({ left: null, right: null });
  const selectorOptionRefs = useRef({ left: [], right: [] });

  const candidateIds = useMemo(() => {
    const sourceIds = Array.isArray(compareCandidateIds) && compareCandidateIds.length >= 2
      ? compareCandidateIds
      : compareItemIds;
    const normalized = [];
    sourceIds.forEach((id) => {
      if (!id || normalized.includes(id)) return;
      normalized.push(id);
    });
    return normalized;
  }, [compareCandidateIds, compareItemIds]);
  const activeCompareIds = useMemo(
    () => compareItemIds.filter(Boolean).slice(0, 2),
    [compareItemIds],
  );

  const candidateItems = useAppStore(
    useCallback((state) => selectItemsByIds(state, candidateIds), [candidateIds]),
    shallow,
  );
  const activeCompareItems = useAppStore(
    useCallback((state) => selectItemsByIds(state, activeCompareIds), [activeCompareIds]),
    shallow,
  );

  const compareItems = useMemo(() => {
    if (activeCompareItems.length === 2 && activeCompareItems[0].id !== activeCompareItems[1].id) {
      return activeCompareItems;
    }
    return candidateItems.slice(0, 2);
  }, [activeCompareItems, candidateItems]);

  const [leftItem, rightItem] = compareItems;
  const canSwitchCandidate = candidateItems.length > 2 && leftItem && rightItem;

  const leftComparableText = useMemo(() => getComparableText(leftItem), [leftItem]);
  const rightComparableText = useMemo(() => getComparableText(rightItem), [rightItem]);
  const leftPreviewText = useMemo(() => getContentPreview(leftComparableText, 1600), [leftComparableText]);
  const rightPreviewText = useMemo(() => getContentPreview(rightComparableText, 1600), [rightComparableText]);
  const contentDiff = useMemo(() => buildDiffSegments(leftPreviewText, rightPreviewText), [leftPreviewText, rightPreviewText]);
  const canHighlightTextDiff = leftItem
    && rightItem
    && leftItem.type_ === rightItem.type_
    && (leftItem.type_ === 'text' || leftItem.type_ === 'link');
  const isFocusCompareMode = !historyStreamEnabled;

  const showFeedback = useCallback((type, text) => {
    setFeedback({ type, text });
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimerRef.current = null;
    }, 1600);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    if (focusManagedRef.current) {
      setHistoryStreamEnabled(historyVisibleBeforeFocusRef.current);
      focusManagedRef.current = false;
    }
  }, [setHistoryStreamEnabled]);

  useEffect(() => {
    if (!openSelectorSide) return undefined;

    const handlePointerDown = (event) => {
      const root = selectorAreaRef.current;
      if (!root || root.contains(event.target)) return;
      setOpenSelectorSide(null);
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpenSelectorSide(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openSelectorSide]);

  useEffect(() => {
    if (!openSelectorSide) return;
    const side = openSelectorSide;
    const optionEl = selectorOptionRefs.current[side]?.[selectorActiveIndex[side]];
    if (optionEl?.scrollIntoView) {
      optionEl.scrollIntoView({ block: 'nearest' });
    }
  }, [openSelectorSide, selectorActiveIndex]);

  const toggleFocusCompareMode = useCallback(() => {
    if (historyStreamEnabled) {
      historyVisibleBeforeFocusRef.current = historyStreamEnabled;
      setHistoryStreamEnabled(false);
      focusManagedRef.current = true;
      showFeedback('success', t('panel.compareFocusOnFeedback'));
      return;
    }
    const nextVisible = focusManagedRef.current ? historyVisibleBeforeFocusRef.current : true;
    setHistoryStreamEnabled(nextVisible);
    focusManagedRef.current = false;
    showFeedback('success', t('panel.compareFocusOffFeedback'));
  }, [historyStreamEnabled, setHistoryStreamEnabled, showFeedback, t]);

  const getDisplaySegments = useCallback((segments) => {
    if (!diffOnlyMode || !canHighlightTextDiff) return segments;
    const contextChars = 56;
    const prefix = segments.prefix.length > contextChars
      ? `...${segments.prefix.slice(-contextChars)}`
      : segments.prefix;
    const suffix = segments.suffix.length > contextChars
      ? `${segments.suffix.slice(0, contextChars)}...`
      : segments.suffix;
    return {
      prefix,
      changed: segments.changed,
      suffix,
    };
  }, [diffOnlyMode, canHighlightTextDiff]);

  const renderItemBody = (item, side) => {
    if (!item) return null;
    const rawSegments = side === 'left' ? contentDiff.left : contentDiff.right;
    const sideSegments = getDisplaySegments(rawSegments);

    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div className="compare-item-image">
          <img src={getImageThumbnail(item.image_paths)} alt="" loading="lazy" />
        </div>
      );
    }

    if (item.type_ === 'file') {
      const files = getFileList(item.content);
      return (
        <div className="compare-item-files compare-content-fade">
          {files.slice(0, 8).map((filePath) => (
            <div key={filePath} className="compare-item-file">
              {getFileName(filePath)}
            </div>
          ))}
          {files.length > 8 && (
            <div className="compare-item-more">
              +{files.length - 8}
            </div>
          )}
        </div>
      );
    }

    if (item.type_ === 'link') {
      const parsed = parseUrl(item.content || '');
      return (
        <div className="compare-item-link">
          <div className="compare-item-link-domain">{parsed?.domain || item.content}</div>
          <div className="compare-item-link-path">{parsed?.path || ''}</div>
          <div className="compare-item-link-raw compare-content-fade">
            {canHighlightTextDiff ? renderDiffSegments(sideSegments) : (item.content || '')}
          </div>
        </div>
      );
    }

    return (
      <div className="compare-item-text compare-content-fade">
        {canHighlightTextDiff ? renderDiffSegments(sideSegments) : getContentPreview(item.content || '', 1600)}
      </div>
    );
  };

  const handleSelectComparedItem = useCallback((side, nextId) => {
    if (!leftItem || !rightItem || !nextId) return;
    const leftId = leftItem.id;
    const rightId = rightItem.id;
    if (side === 'left') {
      if (nextId === rightId) {
        setCompareItemIds([rightId, leftId]);
        setOpenSelectorSide(null);
        return;
      }
      if (nextId === leftId) return;
      setCompareItemIds([nextId, rightId]);
      setOpenSelectorSide(null);
      return;
    }
    if (nextId === leftId) {
      setCompareItemIds([rightId, leftId]);
      setOpenSelectorSide(null);
      return;
    }
    if (nextId === rightId) return;
    setCompareItemIds([leftId, nextId]);
    setOpenSelectorSide(null);
  }, [leftItem, rightItem, setCompareItemIds]);

  const getSelectedIndexBySide = useCallback((side) => {
    if (!leftItem || !rightItem) return 0;
    const selectedId = side === 'left' ? leftItem.id : rightItem.id;
    const idx = candidateItems.findIndex(item => item.id === selectedId);
    return idx >= 0 ? idx : 0;
  }, [leftItem, rightItem, candidateItems]);

  const openSelector = useCallback((side) => {
    const selectedIndex = getSelectedIndexBySide(side);
    setSelectorActiveIndex(prev => ({ ...prev, [side]: selectedIndex }));
    setOpenSelectorSide(side);
  }, [getSelectedIndexBySide]);

  const closeSelector = useCallback((restoreFocus = false) => {
    const closingSide = openSelectorSide;
    setOpenSelectorSide(null);
    if (restoreFocus && closingSide) {
      requestAnimationFrame(() => {
        selectorTriggerRefs.current[closingSide]?.focus();
      });
    }
  }, [openSelectorSide]);

  const stepSelectorHighlight = useCallback((side, direction) => {
    if (!candidateItems.length) return;
    setSelectorActiveIndex((prev) => {
      const current = typeof prev[side] === 'number' ? prev[side] : 0;
      const total = candidateItems.length;
      const next = (current + direction + total) % total;
      return { ...prev, [side]: next };
    });
  }, [candidateItems]);

  const pickActiveSelectorOption = useCallback((side) => {
    const activeIdx = selectorActiveIndex[side];
    const target = candidateItems[activeIdx];
    if (!target) return;
    handleSelectComparedItem(side, target.id);
  }, [selectorActiveIndex, candidateItems, handleSelectComparedItem]);

  const handleSelectorTriggerKeyDown = useCallback((side, event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (openSelectorSide !== side) {
        openSelector(side);
        return;
      }
      stepSelectorHighlight(side, 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (openSelectorSide !== side) {
        openSelector(side);
        return;
      }
      stepSelectorHighlight(side, -1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (openSelectorSide !== side) {
        openSelector(side);
        return;
      }
      pickActiveSelectorOption(side);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSelector(true);
    }
  }, [openSelectorSide, openSelector, stepSelectorHighlight, pickActiveSelectorOption, closeSelector]);

  const handleSelectorMenuKeyDown = useCallback((side, event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepSelectorHighlight(side, 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepSelectorHighlight(side, -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      pickActiveSelectorOption(side);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSelector(true);
      return;
    }
    if (event.key === 'Tab') {
      closeSelector();
    }
  }, [stepSelectorHighlight, pickActiveSelectorOption, closeSelector]);

  const handleFavoriteItem = useCallback(async (item, sideLabel) => {
    if (!item) return;
    if (item.is_favorite) {
      showFeedback('success', t('panel.comparePinnedFeedback', { side: sideLabel }));
      return;
    }
    await toggleFavorite(item);
    showFeedback('success', t('panel.comparePinnedFeedback', { side: sideLabel }));
  }, [toggleFavorite, showFeedback, t]);

  const handleCopyItem = useCallback(async (item, sideLabel) => {
    if (!item) return;
    await handleCopy(item, 'preview');
    showFeedback('success', t('panel.compareCopiedFeedback', { side: sideLabel }));
  }, [handleCopy, showFeedback, t]);

  const handleCopyBoth = useCallback(async () => {
    const merged = [leftComparableText, rightComparableText].filter(Boolean).join('\n\n');
    if (!merged) return;
    await handleCopyPlainText(merged, 'preview');
    showFeedback('success', t('panel.compareMergedCopiedFeedback'));
  }, [leftComparableText, rightComparableText, handleCopyPlainText, showFeedback, t]);

  if (!leftItem || !rightItem) {
    return (
      <div className="compare-panel">
        <div className="compare-panel-header">
          <button
            className="compare-back-btn"
            onClick={switchToWorkbench}
            title={t('workbench.backToWorkbench')}
            aria-label={t('workbench.backToWorkbench')}
          >
            <span className="compare-back-icon" aria-hidden="true">
              <ArrowLeft size={13} />
            </span>
          </button>
        </div>
        <div className="compare-empty">
          {t('panel.compareNeedTwoItems')}
        </div>
      </div>
    );
  }

  return (
    <div className="compare-panel">
      <div className="compare-panel-header">
        <button
          className="compare-back-btn"
          onClick={switchToWorkbench}
          title={t('workbench.backToWorkbench')}
          aria-label={t('workbench.backToWorkbench')}
        >
          <span className="compare-back-icon" aria-hidden="true">
            <ArrowLeft size={13} />
          </span>
        </button>
        <div className="compare-panel-title-wrap">
          <span className="compare-panel-title-dot" aria-hidden="true" />
          <div className="compare-panel-title">
            {t('panel.compareView')}
          </div>
        </div>
        <div className="compare-head-actions">
          <button
            className={`compare-head-btn ${isFocusCompareMode ? 'active' : ''}`}
            onClick={toggleFocusCompareMode}
            title={isFocusCompareMode ? t('panel.compareFocusOff') : t('panel.compareFocusOn')}
          >
            {isFocusCompareMode ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          <button
            className={`compare-head-btn ${diffOnlyMode ? 'active' : ''}`}
            onClick={() => setDiffOnlyMode(prev => !prev)}
            disabled={!canHighlightTextDiff}
            title={!canHighlightTextDiff ? t('panel.compareDiffOnlyUnavailable') : (diffOnlyMode ? t('panel.compareShowFull') : t('panel.compareShowDiffOnly'))}
          >
            <Sparkles size={14} />
          </button>
          <button
            className="compare-head-btn"
            onClick={() => setCompareItemIds([rightItem.id, leftItem.id])}
            title={t('panel.compareSwap')}
          >
            <ArrowRightLeft size={14} />
          </button>
        </div>
      </div>

      {canSwitchCandidate && (
        <div className="compare-panel-selection" ref={selectorAreaRef}>
          <div className="compare-selector-row">
            <section className="compare-selector-group" aria-label={t('panel.compareChooseLeft')}>
              <div className="compare-selector-title">{t('panel.compareChooseLeft')}</div>
              <div className="compare-selector-controls">
                <div className="compare-selector-selectwrap">
                  <button
                    type="button"
                    className={`compare-selector-pill compare-selector-trigger ${openSelectorSide === 'left' ? 'active' : ''}`}
                    onClick={() => (openSelectorSide === 'left' ? closeSelector() : openSelector('left'))}
                    onKeyDown={(event) => handleSelectorTriggerKeyDown('left', event)}
                    title={buildCandidatePreview(leftItem, t)}
                    aria-haspopup="listbox"
                    aria-expanded={openSelectorSide === 'left'}
                    aria-controls="compare-selector-left-menu"
                    ref={(node) => { selectorTriggerRefs.current.left = node; }}
                  >
                    <span className="compare-selector-value">{buildCandidatePreview(leftItem, t)}</span>
                  </button>
                  {openSelectorSide === 'left' && (
                    <div
                      className="compare-selector-menu"
                      role="listbox"
                      id="compare-selector-left-menu"
                      aria-label={t('panel.compareChooseLeft')}
                      onKeyDown={(event) => handleSelectorMenuKeyDown('left', event)}
                    >
                      {candidateItems.map((item, index) => (
                        <button
                          type="button"
                          key={`left-option-${item.id}`}
                          className={`compare-selector-option ${item.id === leftItem.id ? 'active' : ''} ${selectorActiveIndex.left === index ? 'hovered' : ''}`}
                          onClick={() => handleSelectComparedItem('left', item.id)}
                          onMouseEnter={() => setSelectorActiveIndex(prev => ({ ...prev, left: index }))}
                          title={buildCandidatePreview(item, t)}
                          ref={(node) => { selectorOptionRefs.current.left[index] = node; }}
                        >
                          <span className="compare-selector-option-value">{buildCandidatePreview(item, t)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
            <section className="compare-selector-group" aria-label={t('panel.compareChooseRight')}>
              <div className="compare-selector-title">{t('panel.compareChooseRight')}</div>
              <div className="compare-selector-controls">
                <div className="compare-selector-selectwrap">
                  <button
                    type="button"
                    className={`compare-selector-pill compare-selector-trigger ${openSelectorSide === 'right' ? 'active' : ''}`}
                    onClick={() => (openSelectorSide === 'right' ? closeSelector() : openSelector('right'))}
                    onKeyDown={(event) => handleSelectorTriggerKeyDown('right', event)}
                    title={buildCandidatePreview(rightItem, t)}
                    aria-haspopup="listbox"
                    aria-expanded={openSelectorSide === 'right'}
                    aria-controls="compare-selector-right-menu"
                    ref={(node) => { selectorTriggerRefs.current.right = node; }}
                  >
                    <span className="compare-selector-value">{buildCandidatePreview(rightItem, t)}</span>
                  </button>
                  {openSelectorSide === 'right' && (
                    <div
                      className="compare-selector-menu"
                      role="listbox"
                      id="compare-selector-right-menu"
                      aria-label={t('panel.compareChooseRight')}
                      onKeyDown={(event) => handleSelectorMenuKeyDown('right', event)}
                    >
                      {candidateItems.map((item, index) => (
                        <button
                          type="button"
                          key={`right-option-${item.id}`}
                          className={`compare-selector-option ${item.id === rightItem.id ? 'active' : ''} ${selectorActiveIndex.right === index ? 'hovered' : ''}`}
                          onClick={() => handleSelectComparedItem('right', item.id)}
                          onMouseEnter={() => setSelectorActiveIndex(prev => ({ ...prev, right: index }))}
                          title={buildCandidatePreview(item, t)}
                          ref={(node) => { selectorOptionRefs.current.right[index] = node; }}
                        >
                          <span className="compare-selector-option-value">{buildCandidatePreview(item, t)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      <div className="compare-grid">
        <section className="compare-item">
          <div className="compare-item-header">
            <div className="compare-item-label">A</div>
            <button
              className="preview-tool-btn secondary"
              onClick={() => setPanelMode('preview', leftItem)}
              title={t('panel.preview')}
            >
              <Eye size={14} />
              <span>{t('panel.preview')}</span>
            </button>
          </div>
          {renderItemBody(leftItem, 'left')}
        </section>

        <section className="compare-item">
          <div className="compare-item-header">
            <div className="compare-item-label">B</div>
            <button
              className="preview-tool-btn secondary"
              onClick={() => setPanelMode('preview', rightItem)}
              title={t('panel.preview')}
            >
              <Eye size={14} />
              <span>{t('panel.preview')}</span>
            </button>
          </div>
          {renderItemBody(rightItem, 'right')}
        </section>
      </div>

      <div className="compare-action-bar">
        <button
          className="compare-action-btn"
          onClick={() => handleFavoriteItem(leftItem, 'A')}
          title={t('panel.compareActionKeepA')}
        >
          <Star size={14} fill={leftItem?.is_favorite ? 'currentColor' : 'none'} />
          <span>{t('panel.compareActionKeepA')}</span>
        </button>
        <button
          className="compare-action-btn"
          onClick={() => handleFavoriteItem(rightItem, 'B')}
          title={t('panel.compareActionKeepB')}
        >
          <Star size={14} fill={rightItem?.is_favorite ? 'currentColor' : 'none'} />
          <span>{t('panel.compareActionKeepB')}</span>
        </button>
        <button
          className="compare-action-btn secondary"
          onClick={() => handleCopyItem(leftItem, 'A')}
          title={t('panel.compareActionCopyA')}
        >
          <Copy size={14} />
          <span>{t('panel.compareActionCopyA')}</span>
        </button>
        <button
          className="compare-action-btn secondary"
          onClick={() => handleCopyItem(rightItem, 'B')}
          title={t('panel.compareActionCopyB')}
        >
          <Copy size={14} />
          <span>{t('panel.compareActionCopyB')}</span>
        </button>
        <button
          className="compare-action-btn secondary"
          onClick={handleCopyBoth}
          title={t('panel.compareActionCopyBoth')}
        >
          <Copy size={14} />
          <span>{t('panel.compareActionCopyBoth')}</span>
        </button>
      </div>
      {feedback && (
        <div className={`compare-feedback ui-feedback ${feedback.type}`} role="status" aria-live="polite">
          {feedback.text}
        </div>
      )}
    </div>
  );
}

export default ComparePanel;

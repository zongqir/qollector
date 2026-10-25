import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Tag, X, Plus, Sparkles, Check } from 'lucide-react';
import { getTags } from '../../utils/tagHelpers';

const POPOVER_WIDTH = 300;
const VIEWPORT_PADDING = 10;

function QuickTagPopover({
  item,
  anchorPosition,
  availableUserTags = [],
  isMiniMode = false,
  onClose,
  onUpdateTags,
  onAddTag,
  onRemoveTag,
  onPromoteAiTag,
}) {
  const { t } = useTranslation();
  const popoverRef = useRef(null);
  const inputRef = useRef(null);
  const [newTagInput, setNewTagInput] = useState('');
  const [busy, setBusy] = useState(false);

  // Focus input automatically
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const rawInitialTags = useMemo(() => getTags(item?.tags), [item?.tags]);

  const initialUserTags = useMemo(
    () => rawInitialTags.filter((t) => typeof t === 'string' && !t.startsWith('AI:')),
    [rawInitialTags],
  );

  const [selectedUserTags, setSelectedUserTags] = useState(initialUserTags);

  useEffect(() => {
    const raw = getTags(item?.tags);
    setSelectedUserTags(raw.filter((t) => typeof t === 'string' && !t.startsWith('AI:')));
  }, [item?.id, item?.tags]);

  const aiCandidateTags = useMemo(() => {
    return rawInitialTags
      .filter((t) => typeof t === 'string' && t.startsWith('AI:'))
      .map((t) => t.slice(3).trim())
      .filter((t) => Boolean(t) && !selectedUserTags.some((ut) => ut.toLowerCase() === t.toLowerCase()));
  }, [rawInitialTags, selectedUserTags]);

  const normalizedInput = newTagInput.trim().toLowerCase();

  const suggestedTags = useMemo(() => {
    const isSystemOrAiTag = (tag) => {
      const lower = tag.toLowerCase();
      return (
        lower.startsWith('ai:') ||
        lower.startsWith('类型:') ||
        lower.startsWith('来源:') ||
        lower.startsWith('type:') ||
        lower.startsWith('source:')
      );
    };

    const candidates = availableUserTags.filter(
      (t) => typeof t === 'string' && t.trim() && !isSystemOrAiTag(t.trim()),
    );

    if (!normalizedInput) {
      return candidates.slice(0, 10);
    }
    return candidates
      .filter((t) => t.toLowerCase().includes(normalizedInput))
      .slice(0, 10);
  }, [availableUserTags, normalizedInput]);

  const handleAddInputTag = useCallback(() => {
    const tag = newTagInput.trim();
    if (!tag) return;
    if (!selectedUserTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setSelectedUserTags((prev) => [...prev, tag]);
    }
    setNewTagInput('');
    inputRef.current?.focus();
  }, [newTagInput, selectedUserTags]);

  const handleToggleSuggestedTag = useCallback((tagName) => {
    const tag = typeof tagName === 'string' ? tagName.trim() : '';
    if (!tag) return;
    setSelectedUserTags((prev) => {
      const exists = prev.some((t) => t.toLowerCase() === tag.toLowerCase());
      if (exists) {
        return prev.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      }
      return [...prev, tag];
    });
  }, []);

  const handleRemoveExistingTag = useCallback((tagName) => {
    setSelectedUserTags((prev) => prev.filter((t) => t !== tagName));
  }, []);

  const handlePromoteAiCandidate = useCallback((candidateTag) => {
    const tag = typeof candidateTag === 'string' ? candidateTag.trim() : '';
    if (!tag) return;
    setSelectedUserTags((prev) => {
      if (prev.some((t) => t.toLowerCase() === tag.toLowerCase())) return prev;
      return [...prev, tag];
    });
  }, []);

  const handleSaveAndClose = useCallback(async () => {
    if (busy || !item) return;

    let finalSelected = [...selectedUserTags];
    const draftText = newTagInput.trim();
    if (draftText && !finalSelected.some((t) => t.toLowerCase() === draftText.toLowerCase())) {
      finalSelected.push(draftText);
    }

    const unpromotedAiTags = rawInitialTags.filter(
      (t) =>
        typeof t === 'string' &&
        t.startsWith('AI:') &&
        !finalSelected.some((ut) => ut.toLowerCase() === t.slice(3).trim().toLowerCase()),
    );

    const otherSystemTags = rawInitialTags.filter(
      (t) =>
        typeof t === 'string' &&
        !t.startsWith('AI:') &&
        (t.startsWith('类型:') ||
          t.startsWith('来源:') ||
          t.startsWith('Type:') ||
          t.startsWith('Source:')),
    );

    const finalTags = [...otherSystemTags, ...finalSelected, ...unpromotedAiTags];

    setBusy(true);
    try {
      if (onUpdateTags) {
        await onUpdateTags(item, finalTags);
      } else {
        const added = finalSelected.filter((t) => !initialUserTags.includes(t));
        const removed = initialUserTags.filter((t) => !finalSelected.includes(t));
        for (const t of added) {
          if (rawInitialTags.includes(`AI:${t}`) && onPromoteAiTag) {
            await onPromoteAiTag(item, t);
          } else {
            await onAddTag?.(item, t);
          }
        }
        for (const t of removed) {
          await onRemoveTag?.(item, t);
        }
      }
      onClose();
    } catch (err) {
      console.error('Failed to save tags:', err);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    initialUserTags,
    item,
    newTagInput,
    onAddTag,
    onClose,
    onPromoteAiTag,
    onRemoveTag,
    onUpdateTags,
    rawInitialTags,
    selectedUserTags,
  ]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key === 'Enter'
      ) {
        event.preventDefault();
        event.stopPropagation();
        void handleSaveAndClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleSaveAndClose, onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        onClose();
      }
    };
    window.addEventListener('pointerdown', handleClickOutside, true);
    return () => window.removeEventListener('pointerdown', handleClickOutside, true);
  }, [onClose]);

  const popoverPositionStyle = useMemo(() => {
    if (typeof window === 'undefined') return {};
    const winWidth = window.innerWidth || 800;
    const winHeight = window.innerHeight || 600;

    // Mini mode or narrow viewport
    if (isMiniMode || winWidth <= 420) {
      return {
        position: 'fixed',
        bottom: `${VIEWPORT_PADDING}px`,
        left: '50%',
        transform: 'translateX(-50%)',
        width: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
        maxWidth: `${POPOVER_WIDTH + 20}px`,
        zIndex: 9999,
      };
    }

    if (!anchorPosition) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${POPOVER_WIDTH}px`,
        zIndex: 9999,
      };
    }

    let top = 0;
    let left = 0;

    if ('bottom' in anchorPosition && typeof anchorPosition.bottom === 'number') {
      top = anchorPosition.bottom + 6;
      left = anchorPosition.left;
      if (top + 320 > winHeight) {
        top = Math.max(VIEWPORT_PADDING, (anchorPosition.top || 100) - 330);
      }
    } else {
      top = (anchorPosition.y || 100) + 8;
      left = (anchorPosition.x || 100) - 40;
      if (top + 320 > winHeight) {
        top = Math.max(VIEWPORT_PADDING, winHeight - 340);
      }
    }

    left = Math.max(VIEWPORT_PADDING, Math.min(left, winWidth - POPOVER_WIDTH - VIEWPORT_PADDING));

    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${POPOVER_WIDTH}px`,
      zIndex: 9999,
    };
  }, [anchorPosition, isMiniMode]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="quick-tag-popover-portal"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={popoverRef}
        className="quick-tag-popover"
        style={popoverPositionStyle}
      >
        {/* Header */}
        <div className="quick-tag-header">
          <div className="quick-tag-title">
            <Tag size={13} className="quick-tag-icon" />
            <span>{t('item.tagManagement')}</span>
          </div>
          <button
            type="button"
            className="quick-tag-close-btn"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={13} />
          </button>
        </div>

        {/* Input */}
        <div className="quick-tag-input-row">
          <input
            ref={inputRef}
            type="text"
            className="quick-tag-input"
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (newTagInput.trim()) {
                  handleAddInputTag();
                } else {
                  void handleSaveAndClose();
                }
              }
            }}
            placeholder={t('item.quickTagPlaceholder')}
            disabled={busy}
          />
          <button
            type="button"
            className="quick-tag-add-btn"
            onClick={handleAddInputTag}
            disabled={!newTagInput.trim() || busy}
            title={t('item.addTag')}
            aria-label={t('item.addTag')}
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Current user tags */}
        <div className="quick-tag-section">
          <div className="quick-tag-section-title">
            {t('item.quickTagCurrentTags')}
          </div>
          <div className="quick-tag-chips-wrap">
            {selectedUserTags.length > 0 ? (
              selectedUserTags.map((tag) => (
                <span key={tag} className="quick-tag-chip active">
                  <span className="quick-tag-chip-label">{tag}</span>
                  <button
                    type="button"
                    className="quick-tag-chip-remove"
                    onClick={() => handleRemoveExistingTag(tag)}
                    title={t('item.removeTag')}
                    aria-label={`${t('item.removeTag')} ${tag}`}
                    disabled={busy}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))
            ) : (
              <span className="quick-tag-empty-hint">{t('item.quickTagNoTags')}</span>
            )}
          </div>
        </div>

        {/* AI Suggested Tags (Promotion) */}
        {aiCandidateTags.length > 0 && (
          <div className="quick-tag-section ai-section">
            <div className="quick-tag-section-title ai-title">
              <Sparkles size={11} />
              <span>{t('item.quickTagAiSuggested')}</span>
            </div>
            <div className="quick-tag-chips-wrap">
              {aiCandidateTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="quick-tag-chip ai-candidate"
                  onClick={() => handlePromoteAiCandidate(tag)}
                  disabled={busy}
                  title={t('item.quickTagPromoteAiHint')}
                >
                  <Plus size={10} className="ai-plus-icon" />
                  <span>{tag}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Popular / Matching Tags (Multi-select) */}
        {suggestedTags.length > 0 && (
          <div className="quick-tag-section">
            <div className="quick-tag-section-title">
              {t('item.quickTagSuggested')}
            </div>
            <div className="quick-tag-chips-wrap">
              {suggestedTags.map((tag) => {
                const isSelected = selectedUserTags.some(
                  (t) => t.toLowerCase() === tag.toLowerCase(),
                );
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`quick-tag-chip suggestion ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleToggleSuggestedTag(tag)}
                    disabled={busy}
                    aria-pressed={isSelected}
                  >
                    {isSelected && <Check size={10} className="quick-tag-chip-check" />}
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="quick-tag-footer">
          <button
            type="button"
            className="quick-tag-btn-cancel"
            onClick={onClose}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="quick-tag-btn-confirm"
            onClick={() => void handleSaveAndClose()}
            disabled={busy}
          >
            <Check size={12} />
            <span>{t('common.confirm')}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default memo(QuickTagPopover);

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Tag, X, Plus, Sparkles } from 'lucide-react';
import { getTags } from '../../utils/tagHelpers';

const POPOVER_WIDTH = 290;
const VIEWPORT_PADDING = 10;

function QuickTagPopover({
  item,
  anchorPosition,
  availableUserTags = [],
  isMiniMode = false,
  onClose,
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

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

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

  const [localTags, setLocalTags] = useState(() => getTags(item?.tags));

  useEffect(() => {
    setLocalTags(getTags(item?.tags));
  }, [item?.id, item?.tags]);

  const userTags = useMemo(
    () => localTags.filter((t) => typeof t === 'string' && !t.startsWith('AI:')),
    [localTags],
  );
  const aiCandidateTags = useMemo(
    () =>
      localTags
        .filter((t) => typeof t === 'string' && t.startsWith('AI:'))
        .map((t) => t.slice(3).trim())
        .filter((t) => Boolean(t) && !userTags.includes(t)),
    [localTags, userTags],
  );

  const normalizedInput = newTagInput.trim().toLowerCase();

  const suggestedTags = useMemo(() => {
    const currentSet = new Set(userTags.map((t) => t.toLowerCase()));
    const candidates = availableUserTags.filter(
      (t) => typeof t === 'string' && t.trim() && !currentSet.has(t.trim().toLowerCase()),
    );
    if (!normalizedInput) {
      return candidates.slice(0, 8);
    }
    return candidates
      .filter((t) => t.toLowerCase().includes(normalizedInput))
      .slice(0, 8);
  }, [availableUserTags, userTags, normalizedInput]);

  const handleCommitNewTag = useCallback(
    async (tagName) => {
      const tag = typeof tagName === 'string' ? tagName.trim() : newTagInput.trim();
      if (!tag || busy) return;
      if (userTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        setNewTagInput('');
        return;
      }
      setBusy(true);
      // Optimistic update
      setLocalTags((prev) => [...prev.filter((t) => t !== tag && t !== `AI:${tag}`), tag]);
      setNewTagInput('');
      try {
        await onAddTag?.(item, tag);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, item, newTagInput, onAddTag, userTags],
  );

  const handleRemoveExistingTag = useCallback(
    async (tagName) => {
      if (busy) return;
      setBusy(true);
      // Optimistic update
      setLocalTags((prev) => prev.filter((t) => t !== tagName));
      try {
        await onRemoveTag?.(item, tagName);
      } finally {
        setBusy(false);
      }
    },
    [busy, item, onRemoveTag],
  );

  const handlePromoteAiCandidate = useCallback(
    async (candidateTag) => {
      if (busy) return;
      setBusy(true);
      // Optimistic promotion
      setLocalTags((prev) => [
        ...prev.filter((t) => t !== `AI:${candidateTag}` && t !== candidateTag),
        candidateTag,
      ]);
      try {
        if (onPromoteAiTag) {
          await onPromoteAiTag(item, candidateTag);
        } else {
          await onAddTag?.(item, candidateTag);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, item, onAddTag, onPromoteAiTag],
  );

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
      if (top + 280 > winHeight) {
        top = Math.max(VIEWPORT_PADDING, (anchorPosition.top || 100) - 290);
      }
    } else {
      top = (anchorPosition.y || 100) + 8;
      left = (anchorPosition.x || 100) - 40;
      if (top + 280 > winHeight) {
        top = Math.max(VIEWPORT_PADDING, winHeight - 300);
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
                void handleCommitNewTag(newTagInput);
              }
            }}
            placeholder={t('item.quickTagPlaceholder')}
            disabled={busy}
          />
          <button
            type="button"
            className="quick-tag-add-btn"
            onClick={() => void handleCommitNewTag(newTagInput)}
            disabled={!newTagInput.trim() || busy}
            title={t('item.addTag')}
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
            {userTags.length > 0 ? (
              userTags.map((tag) => (
                <span key={tag} className="quick-tag-chip active">
                  <span className="quick-tag-chip-label">{tag}</span>
                  <button
                    type="button"
                    className="quick-tag-chip-remove"
                    onClick={() => void handleRemoveExistingTag(tag)}
                    title={t('common.delete')}
                    aria-label={`Remove ${tag}`}
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
                  onClick={() => void handlePromoteAiCandidate(tag)}
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

        {/* Popular / Matching Tags */}
        {suggestedTags.length > 0 && (
          <div className="quick-tag-section">
            <div className="quick-tag-section-title">
              {t('item.quickTagSuggested')}
            </div>
            <div className="quick-tag-chips-wrap">
              {suggestedTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="quick-tag-chip suggestion"
                  onClick={() => void handleCommitNewTag(tag)}
                  disabled={busy}
                >
                  <span>{tag}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default memo(QuickTagPopover);

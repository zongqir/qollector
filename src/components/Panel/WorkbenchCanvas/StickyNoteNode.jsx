import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodeResizer } from '@xyflow/react';
import {
  Sparkles,
  Palette,
  X,
  GripVertical,
  Check,
  Loader2,
  FileText,
  Languages,
  ListOrdered,
  RefreshCw,
  Code2,
} from 'lucide-react';
import { runPromptAssistantTask } from '../../../features/ai-assistant/services/promptAssistantService';
import { resolveOutputLanguageFromUi } from '../../../features/ai-assistant/utils/language';
import { formatHistoryCardTime } from '../../../utils/formatters';

const STICKY_COLORS = ['yellow', 'green', 'blue', 'purple', 'pink', 'orange', 'dark'];
const STICKY_COLOR_MAP = {
  yellow: '#fef08a',
  green: '#bbf7d0',
  blue: '#bae6fd',
  purple: '#e9d5ff',
  pink: '#fecdd3',
  orange: '#fed7aa',
  dark: '#1e2430',
};

function StickyNoteNode({ data, selected }) {
  const {
    item,
    color = 'default',
    onUpdateContent,
    onUpdateColor,
    onUnpin,
    onCopy,
    isCopied,
    t,
    uiLanguage = 'zh-CN',
    aiEnabled = false,
  } = data;

  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(() => item?.content || '');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const textareaRef = useRef(null);
  const aiMenuRef = useRef(null);
  const colorPickerRef = useRef(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftContent(item?.content || '');
    }
  }, [item?.content, isEditing]);

  useEffect(() => {
    if (isEditing) {
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      });
    }
  }, [isEditing]);

  // Click outside dismiss for popovers
  useEffect(() => {
    if (!showAiMenu && !showColorPicker) return undefined;
    const handleClickOutside = (event) => {
      if (showAiMenu && !aiMenuRef.current?.contains(event.target)) {
        setShowAiMenu(false);
      }
      if (showColorPicker && !colorPickerRef.current?.contains(event.target)) {
        setShowColorPicker(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [showAiMenu, showColorPicker]);

  const handleSave = useCallback(() => {
    setIsEditing(false);
    const trimmed = draftContent.trim();
    if (trimmed !== (item?.content || '').trim()) {
      onUpdateContent?.(item.id, trimmed);
    }
  }, [draftContent, item?.content, item?.id, onUpdateContent]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleSave();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setDraftContent(item?.content || '');
        setIsEditing(false);
      }
    },
    [handleSave, item?.content]
  );

  const handleNodeClick = useCallback(
    (event) => {
      // Don't trigger copy if clicking buttons, textarea, or popovers
      if (
        isEditing ||
        event.target.closest('button') ||
        event.target.closest('textarea') ||
        event.target.closest('.sticky-ai-popover') ||
        event.target.closest('.sticky-color-popover')
      ) {
        return;
      }
      onCopy?.(item);
    },
    [isEditing, item, onCopy]
  );

  const handleDoubleClick = useCallback((event) => {
    if (
      event.target.closest('button') ||
      event.target.closest('.sticky-ai-popover') ||
      event.target.closest('.sticky-color-popover')
    ) {
      return;
    }
    setIsEditing(true);
  }, []);

  const handleRunAi = useCallback(
    async (taskType, extraPrompt = '') => {
      if (aiRunning || !item?.content?.trim()) return;
      setShowAiMenu(false);
      setAiRunning(true);
      try {
        const response = await runPromptAssistantTask({
          taskType,
          input: item.content,
          uiLanguage,
          outputLanguage: resolveOutputLanguageFromUi(uiLanguage),
          tone: 'professional',
          length: 'medium',
          extraInstruction: extraPrompt || undefined,
        });
        const output = typeof response?.output === 'string' ? response.output.trim() : '';
        if (output) {
          onUpdateContent?.(item.id, output);
        }
      } catch (error) {
        console.error('[StickyNote] AI Task failed:', error);
      } finally {
        setAiRunning(false);
      }
    },
    [aiRunning, item?.content, item?.id, onUpdateContent, uiLanguage]
  );

  const formattedTime = useMemo(() => {
    if (!item?.updated_at && !item?.created_at) return '';
    return formatHistoryCardTime(item.updated_at || item.created_at, uiLanguage, Date.now());
  }, [item?.created_at, item?.updated_at, uiLanguage]);

  return (
    <div
      className={`sticky-note-node ${selected ? 'selected' : ''} ${isCopied ? 'is-copied' : ''}`}
      data-color={color}
      onClick={handleNodeClick}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <NodeResizer
        minWidth={180}
        minHeight={110}
        maxWidth={800}
        maxHeight={700}
        isVisible={selected || isHovered}
        lineClassName="sticky-resize-line"
        handleClassName="sticky-resize-handle"
      />

      {/* Header */}
      <div className="sticky-note-header">
        <div className="sticky-note-header-left">
          <div className="sticky-note-drag-handle" title={t ? t('workbench.dragMove') : 'Drag to move'}>
            <GripVertical size={13} />
          </div>
          <span className="sticky-note-badge">{item?.type_ || 'NOTE'}</span>
          {formattedTime && <span className="sticky-note-time">{formattedTime}</span>}
        </div>

        <div className="sticky-note-header-actions">
          {aiEnabled && (
            <button
              type="button"
              className="sticky-note-action-btn ai-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowColorPicker(false);
                setShowAiMenu((prev) => !prev);
              }}
              title={t ? t('workbench.aiAssistant') : 'AI Assistant'}
              disabled={aiRunning}
            >
              {aiRunning ? (
                <Loader2 size={13} className="sticky-ai-spinner" />
              ) : (
                <Sparkles size={13} />
              )}
            </button>
          )}

          <button
            type="button"
            className="sticky-note-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowAiMenu(false);
              setShowColorPicker((prev) => !prev);
            }}
            title={t ? t('item.color') : 'Color'}
          >
            <Palette size={13} />
          </button>

          <button
            type="button"
            className="sticky-note-action-btn danger"
            onClick={(e) => {
              e.stopPropagation();
              onUnpin?.(item);
            }}
            title={t ? t('workbench.removeFromWorkbench') : 'Remove'}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="sticky-note-body">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="sticky-note-textarea"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder={t ? t('edit.notePlaceholder') : 'Write note...'}
          />
        ) : (
          <div className="sticky-note-text-display">
            {item?.content || (item?.type_ === 'image' ? item?.ocr_text : '') || (
              <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                {t ? t('workbench.exportEmptyLine') : '(Empty note - double click to write)'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* AI Menu Popover */}
      {showAiMenu && (
        <div className="sticky-ai-popover" ref={aiMenuRef} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="sticky-ai-item"
            onClick={() =>
              handleRunAi(
                'rewrite',
                'Format, clean up extra spaces/newlines, and make clear bullet points if appropriate.'
              )
            }
          >
            <FileText size={13} />
            <span>{t ? t('aiAssistant.tasks.format') || '排版整理' : '排版整理'}</span>
          </button>
          <button
            type="button"
            className="sticky-ai-item"
            onClick={() => handleRunAi('translate')}
          >
            <Languages size={13} />
            <span>{t ? t('aiAssistant.tasks.translate') || '中英翻译' : '中英翻译'}</span>
          </button>
          <button
            type="button"
            className="sticky-ai-item"
            onClick={() => handleRunAi('extract')}
          >
            <ListOrdered size={13} />
            <span>{t ? t('aiAssistant.tasks.extract') || '提取要点' : '提取要点'}</span>
          </button>
          <button
            type="button"
            className="sticky-ai-item"
            onClick={() => handleRunAi('rewrite')}
          >
            <RefreshCw size={13} />
            <span>{t ? t('aiAssistant.tasks.rewrite') || '润色优化' : '润色优化'}</span>
          </button>
        </div>
      )}

      {/* Color Picker Popover */}
      {showColorPicker && (
        <div
          className="sticky-color-popover"
          ref={colorPickerRef}
          onClick={(e) => e.stopPropagation()}
        >
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`sticky-color-dot ${color === c ? 'active' : ''}`}
              data-color={c}
              onClick={() => {
                onUpdateColor?.(item.id, c);
                setShowColorPicker(false);
              }}
              style={{
                background: STICKY_COLOR_MAP[c] || '#fef08a',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(StickyNoteNode);

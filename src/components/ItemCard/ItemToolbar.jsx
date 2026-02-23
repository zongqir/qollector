import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical, Inbox, Star, Sparkles, Search, StickyNote, ChevronDown, ChevronUp, ExternalLink, FolderOpen, Share2, Lock } from 'lucide-react';

import useAppStore from '../../store/useAppStore';

function ItemToolbar({
  item, onDragStart, onTogglePin, onToggleFavorite,
  onGenerateAITags, generatingAI, aiEnabled,
  onHandleOCR, ocrProcessing, ocrEnabled,
  onStartEditNote, onToggleExpand, isExpanded,
  maxPinnedItems, onOpenItem, onRevealInFolder,
  onShare, isProUser,
}) {
  const { t } = useTranslation();

  // 检查是否已有 AI 标签
  const hasAITags = () => {
    if (!item.tags) return false;
    try {
      const tags = JSON.parse(item.tags);
      return tags.some(tag => tag.startsWith('AI:'));
    } catch {
      return false;
    }
  };

  // Show AI button: enabled + text + has content + no AI tags
  // If not pro, show locked version
  const shouldShowAIButton = aiEnabled && item.type_ === 'text' && item.content && !hasAITags();
  const aiLocked = shouldShowAIButton && !isProUser;

  // Show OCR button: enabled + image + no OCR text
  // If not pro, show locked version
  const shouldShowOCRButton = ocrEnabled && item.type_ === 'image' && !item.ocr_text;
  const ocrLocked = shouldShowOCRButton && !isProUser;

  // 判断是否显示打开按钮
  // 链接或文件类型
  const shouldShowOpenButton = item.type_ === 'link' || item.type_ === 'file';

  return (
    <div className="item-toolbar">
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(item, e); }}
        className={`toolbar-btn pin-btn ${item.is_pinned ? 'active' : ''}`}
        title={item.is_pinned ? t('item.unpin') : t('item.pin', { max: maxPinnedItems || 10 })}
      >
        <Inbox size={14} className="toolbar-btn-icon" />
        <span>{item.is_pinned ? t('item.pinned') : t('item.pin', { max: maxPinnedItems || 10 })}</span>
      </button>
      <div className="toolbar-divider"></div>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(item, e); }}
        className={`toolbar-btn favorite-btn ${item.is_favorite ? 'active' : ''}`}
        title={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
      >
        <Star size={14} className="toolbar-btn-icon" fill={item.is_favorite ? 'currentColor' : 'none'} />
        <span>{item.is_favorite ? t('item.favorited') : t('item.favorite')}</span>
      </button>
      <div className="toolbar-divider"></div>
      <button
        onClick={(e) => { e.stopPropagation(); onStartEditNote(item); }}
        className={`toolbar-btn note-btn ${item.user_note ? 'has-note' : ''}`}
        title={item.user_note ? t('item.editNote') : t('item.addNote')}
      >
        <StickyNote size={14} className="toolbar-btn-icon" />
        <span>{item.user_note ? t('item.editNote') : t('item.addNote')}</span>
      </button>
      <div className="toolbar-divider"></div>
      <span
        draggable="true"
        onDragStart={(e) => onDragStart(item, e)}
        className="toolbar-btn drag-handle"
        title={t('toolbar.dragToApp')}
      >
        <GripVertical size={14} className="toolbar-btn-icon" />
        <span>{t('toolbar.dragOut')}</span>
      </span>
      {shouldShowAIButton && (
        <>
          <div className="toolbar-divider"></div>
          <button
            onClick={(e) => { e.stopPropagation(); aiLocked ? useAppStore.getState().setShowSettings(true, 'license') : onGenerateAITags(item); }}
            disabled={!aiLocked && generatingAI === item.id}
            className={`toolbar-btn ai-btn ${generatingAI === item.id ? 'is-loading' : ''} ${aiLocked ? 'locked' : ''}`}
            title={aiLocked ? t('license.proFeature') : generatingAI === item.id ? t('item.aiGenerating') : t('item.generateAITags')}
          >
            {aiLocked ? <Lock size={14} className="toolbar-btn-icon" /> : <Sparkles size={14} className="toolbar-btn-icon" />}
            <span>{generatingAI === item.id ? t('item.generating') : t('item.aiTag')}</span>
          </button>
        </>
      )}
      {shouldShowOCRButton && (
        <>
          <div className="toolbar-divider"></div>
          <button
            onClick={(e) => { e.stopPropagation(); ocrLocked ? useAppStore.getState().setShowSettings(true, 'license') : onHandleOCR(item); }}
            disabled={!ocrLocked && ocrProcessing === item.id}
            className={`toolbar-btn ocr-btn ${ocrLocked ? 'locked' : ''}`}
            title={ocrLocked ? t('license.proFeature') : ocrProcessing === item.id ? t('item.ocrRecognizing') : t('item.recognizeText')}
          >
            {ocrLocked ? <Lock size={14} className="toolbar-btn-icon" /> : <Search size={14} className="toolbar-btn-icon" />}
            <span>{ocrProcessing === item.id ? t('item.recognizing') : t('item.ocr')}</span>
          </button>
        </>
      )}
      {shouldShowOpenButton && (
        <>
          <div className="toolbar-divider"></div>
          <button
            onClick={(e) => { e.stopPropagation(); onOpenItem(item); }}
            className="toolbar-btn open-btn"
            title={item.type_ === 'link' ? t('item.openLink') : t('item.openFile')}
          >
            <ExternalLink size={14} className="toolbar-btn-icon" />
            <span>{t('item.open')}</span>
          </button>
        </>
      )}
      {item.type_ === 'file' && (
        <>
          <div className="toolbar-divider"></div>
          <button
            onClick={(e) => { e.stopPropagation(); onRevealInFolder(item); }}
            className="toolbar-btn open-btn"
            title={t('item.revealInFolder')}
          >
            <FolderOpen size={14} className="toolbar-btn-icon" />
            <span>{t('item.revealInFolder')}</span>
          </button>
        </>
      )}
      <div className="toolbar-divider"></div>
      <button
        onClick={(e) => { e.stopPropagation(); onShare?.(item); }}
        className="toolbar-btn share-btn"
        title={t('share.button')}
      >
        <Share2 size={14} className="toolbar-btn-icon" />
        <span>{t('share.button')}</span>
      </button>
      <div className="toolbar-divider"></div>
      <button
        onClick={(e) => onToggleExpand(item.id, e)}
        className={`toolbar-btn expand-btn ${isExpanded ? 'active' : ''}`}
        title={isExpanded ? t('item.collapse') : t('item.expandAll')}
      >
        {isExpanded ? <ChevronUp size={14} className="toolbar-btn-icon" /> : <ChevronDown size={14} className="toolbar-btn-icon" />}
        <span>{isExpanded ? t('item.collapse') : t('item.expand')}</span>
      </button>
      <div className="toolbar-hint">
        {t('item.clickToCopy')} | {item.type_ === 'image' ? t('item.doubleClickToPreview') : item.has_raw_formats ? t('item.doubleClickToCopy') : t('item.doubleClickToEdit')}
      </div>
    </div>
  );
}

export default memo(ItemToolbar);

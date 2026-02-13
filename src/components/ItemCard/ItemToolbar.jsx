import { useTranslation } from 'react-i18next';
import { GripVertical, Pin, Star, Sparkles, Search, StickyNote, ChevronDown, ChevronUp } from 'lucide-react';

function ItemToolbar({
  item, onDragStart, onTogglePin, onToggleFavorite,
  onGenerateAITags, generatingAI,
  onHandleOCR, ocrProcessing,
  onStartEditNote, onToggleExpand, isExpanded,
}) {
  const { t } = useTranslation();

  return (
    <div className="item-toolbar">
      <span
        draggable="true"
        onDragStart={(e) => onDragStart(item, e)}
        className="toolbar-btn drag-handle"
        title={t('toolbar.dragToApp')}
      >
        <GripVertical size={14} className="toolbar-btn-icon" />
        <span>{t('toolbar.dragOut')}</span>
      </span>
      <div className="toolbar-divider"></div>
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(item, e); }}
        className={`toolbar-btn pin-btn ${item.is_pinned ? 'active' : ''}`}
        title={item.is_pinned ? t('item.unpin') : t('item.pin')}
      >
        <Pin size={14} className="toolbar-btn-icon" />
        <span>{item.is_pinned ? t('item.pinned') : t('item.pin')}</span>
      </button>
      <div className="toolbar-divider"></div>
      <button
        onClick={(e) => onToggleFavorite(item, e)}
        className={`toolbar-btn favorite-btn ${item.is_favorite ? 'active' : ''}`}
        title={item.is_favorite ? t('item.unfavorite') : t('item.favorite')}
      >
        <Star size={14} className="toolbar-btn-icon" fill={item.is_favorite ? 'currentColor' : 'none'} />
        <span>{item.is_favorite ? t('item.favorited') : t('item.favorite')}</span>
      </button>
      {item.type_ === 'text' && item.content && (
        <>
          <div className="toolbar-divider"></div>
          <button
            onClick={(e) => { e.stopPropagation(); onGenerateAITags(item); }}
            disabled={generatingAI === item.id}
            className="toolbar-btn ai-btn"
            title={generatingAI === item.id ? t('item.aiGenerating') : t('item.generateAITags')}
          >
            <Sparkles size={14} className="toolbar-btn-icon" />
            <span>{generatingAI === item.id ? t('item.generating') : t('item.aiTag')}</span>
          </button>
        </>
      )}
      {item.type_ === 'image' && !item.ocr_text && (
        <>
          <div className="toolbar-divider"></div>
          <button
            onClick={(e) => { e.stopPropagation(); onHandleOCR(item); }}
            disabled={ocrProcessing === item.id}
            className="toolbar-btn ocr-btn"
            title={ocrProcessing === item.id ? t('item.ocrRecognizing') : t('item.recognizeText')}
          >
            <Search size={14} className="toolbar-btn-icon" />
            <span>{ocrProcessing === item.id ? t('item.recognizing') : t('item.ocr')}</span>
          </button>
        </>
      )}
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
      <button
        onClick={(e) => onToggleExpand(item.id, e)}
        className={`toolbar-btn expand-btn ${isExpanded ? 'active' : ''}`}
        title={isExpanded ? t('item.collapse') : t('item.expandAll')}
      >
        {isExpanded ? <ChevronUp size={14} className="toolbar-btn-icon" /> : <ChevronDown size={14} className="toolbar-btn-icon" />}
        <span>{isExpanded ? t('item.collapse') : t('item.expand')}</span>
      </button>
      <div className="toolbar-hint">
        {t('item.clickToCopy')} | {item.type_ === 'image' ? t('item.doubleClickToPreview') : t('item.doubleClickToEdit')}
      </div>
    </div>
  );
}

export default ItemToolbar;
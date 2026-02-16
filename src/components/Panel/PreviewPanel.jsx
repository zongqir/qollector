import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, Pin, PinOff, Star, Sparkles, Search, StickyNote,
  ExternalLink, Check, FileText, Copy, Trash2
} from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import { getContentPreview, getFileList, getFileName, formatDate, extractOpenableUrls } from '../../utils/formatters';
import { getImageOriginal } from '../../utils/imageHelpers';
import { getTags, getSourceApp } from '../../utils/tagHelpers';
import ItemTags from '../ItemCard/ItemTags';
import NoteDisplay from '../ItemCard/NoteDisplay';
import CodeBlock from '../CodeBlock/CodeBlock';

function PreviewPanel() {
  const { t, i18n } = useTranslation();
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editContent, setEditContent] = useState('');

  const previewItem = useAppStore(s => s.previewItem);
  const switchToCollection = useAppStore(s => s.switchToCollection);
  const togglePin = useAppStore(s => s.togglePin);
  const toggleFavorite = useAppStore(s => s.toggleFavorite);
  const generateAITags = useAppStore(s => s.generateAITags);
  const handleOCR = useAppStore(s => s.handleOCR);
  const handleOpenItem = useAppStore(s => s.handleOpenItem);
  const handleOpenUrl = useAppStore(s => s.handleOpenUrl);
  const handleCopy = useAppStore(s => s.handleCopy);
  const deleteItem = useAppStore(s => s.deleteItem);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const generatingAI = useAppStore(s => s.generatingAI);
  const aiEnabled = useAppStore(s => s.aiEnabled);
  const ocrProcessing = useAppStore(s => s.ocrProcessing);
  const ocrEnabled = useAppStore(s => s.ocrEnabled);
  const maxPinnedItems = useAppStore(s => s.maxPinnedItems);
  const items = useAppStore(s => s.items);

  // 备注相关
  const editingNoteId = useAppStore(s => s.editingNoteId);
  const editNote = useAppStore(s => s.editNote);
  const setEditNote = useAppStore(s => s.setEditNote);
  const startEditNote = useAppStore(s => s.startEditNote);
  const saveNote = useAppStore(s => s.saveNote);
  const cancelNoteEdit = useAppStore(s => s.cancelNoteEdit);

  // 标签相关
  const selectedTags = useAppStore(s => s.selectedTags);
  const addingTagItemId = useAppStore(s => s.addingTagItemId);
  const newTagInput = useAppStore(s => s.newTagInput);
  const setNewTagInput = useAppStore(s => s.setNewTagInput);
  const startAddTag = useAppStore(s => s.startAddTag);
  const cancelAddTag = useAppStore(s => s.cancelAddTag);
  const addTagToItem = useAppStore(s => s.addTagToItem);
  const handleTagClick = useAppStore(s => s.handleTagClick);

  // 从 items 中获取最新的 previewItem 数据（因为可能被更新了）
  const item = items.find(i => i.id === previewItem?.id) || previewItem;

  if (!item) {
    switchToCollection();
    return null;
  }

  const isCopied = copiedItemId === item.id;
  const tags = getTags(item.tags);
  const hasAITags = tags.some(tag => tag.startsWith('AI:'));
  const shouldShowAIButton = aiEnabled && item.type_ === 'text' && item.content && !hasAITags;
  const shouldShowOCRButton = ocrEnabled && item.type_ === 'image' && !item.ocr_text;
  const textOpenableUrls = useMemo(() => {
    if (item.type_ !== 'text') return [];
    return extractOpenableUrls(item.content);
  }, [item.type_, item.content]);
  const shouldShowOpenButton = item.type_ === 'link' || item.type_ === 'file' || textOpenableUrls.length > 0;
  const openButtonTitle = item.type_ === 'file' ? t('item.openFile') : t('item.openLink');

  // 收集并切回搜集箱
  const handlePinAndBack = async () => {
    if (!item.is_pinned) {
      await togglePin(item);
    }
    switchToCollection();
  };

  // 开始编辑内容
  const handleStartEditContent = () => {
    setEditContent(item.content || '');
    setIsEditingContent(true);
  };

  // 保存内容编辑
  const handleSaveContent = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const updatedItem = {
        ...item,
        content: editContent,
        updated_at: Math.floor(Date.now() / 1000)
      };
      await invoke('update_item', { item: updatedItem });
      await useAppStore.getState().loadItems();
      setIsEditingContent(false);
    } catch (error) {
      console.error('保存内容失败:', error);
    }
  };

  // 计算用户标签（用于标签建议）
  const allUserTags = [];
  items.forEach(i => {
    const t = getTags(i.tags);
    t.forEach(tag => {
      if (!tag.startsWith('AI:') && !allUserTags.includes(tag)) {
        allUserTags.push(tag);
      }
    });
  });
  allUserTags.sort();
  const filteredUserTags = newTagInput.trim()
    ? allUserTags.filter(tag => tag.toLowerCase().includes(newTagInput.toLowerCase()))
    : allUserTags;

  const handleTagInputKeyDown = (itemObj, e) => {
    if (e.key === 'Enter' && newTagInput.trim()) {
      addTagToItem(itemObj, newTagInput.trim());
    } else if (e.key === 'Escape') {
      cancelAddTag();
    }
  };

  const handleOpen = useCallback(() => {
    if (item.type_ === 'link' || item.type_ === 'file') {
      handleOpenItem(item);
      return;
    }
    if (textOpenableUrls.length > 0) {
      handleOpenUrl(textOpenableUrls[0]);
    }
  }, [handleOpenItem, handleOpenUrl, item, textOpenableUrls]);

  const renderContent = () => {
    if (isEditingContent && item.type_ !== 'image' && item.type_ !== 'file') {
      return (
        <textarea
          className="preview-edit-textarea"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          wrap="soft"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) handleSaveContent();
            if (e.key === 'Escape') setIsEditingContent(false);
          }}
          autoFocus
        />
      );
    }

    if (item.code_language && item.content) {
      return (
        <div onDoubleClick={handleStartEditContent}>
          <CodeBlock code={item.content} language={item.code_language} maxLines={200} />
        </div>
      );
    }

    if (item.type_ === 'image' && item.image_paths) {
      return (
        <div className="preview-image-content">
          <img src={getImageOriginal(item.image_paths)} alt="" />
          {item.ocr_text && (
            <div className="preview-ocr">
              <div className="ocr-label">{t('item.recognizedText')}</div>
              <div className="ocr-content">{item.ocr_text}</div>
            </div>
          )}
        </div>
      );
    }
    if (item.type_ === 'file') {
      return (
        <div className="preview-file-content">
          {getFileList(item.content).map((path, idx) => (
            <div key={idx} className="file-item">
              <FileText size={16} />
              <span>{getFileName(path)}</span>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div
        className="preview-text-content"
        onDoubleClick={handleStartEditContent}
      >
        {getContentPreview(item.content)}
      </div>
    );
  };

  return (
    <div className="preview-panel">
      {/* 顶部导航 */}
      <div className="preview-nav">
        <button className="preview-back-btn" onClick={switchToCollection}>
          <ArrowLeft size={16} />
        </button>
        <div className="preview-nav-actions">
          <button
            className={`preview-action-btn ${item.is_pinned ? 'active' : ''}`}
            onClick={item.is_pinned ? () => togglePin(item) : handlePinAndBack}
          >
            {item.is_pinned ? <PinOff size={14} /> : <Pin size={14} />}
            <span>{item.is_pinned ? t('collection.removeFromCollection') : t('collection.addToCollection')}</span>
          </button>
        </div>
      </div>

      {/* 标签区 */}
      <div className="preview-tags-section">
        <ItemTags
          item={item}
          selectedTags={selectedTags}
          onTagClick={handleTagClick}
          addingTagItemId={addingTagItemId}
          newTagInput={newTagInput}
          onNewTagInputChange={setNewTagInput}
          onTagInputKeyDown={handleTagInputKeyDown}
          onStartAddTag={startAddTag}
          onCancelAddTag={cancelAddTag}
          onAddTagToItem={addTagToItem}
          filteredUserTags={filteredUserTags}
          hideTypeTag
        />
      </div>

      {/* 内容区 */}
      <div className={`preview-content-area ${isEditingContent ? 'editing' : ''}`}>
        {isCopied && (
          <div className="copy-success-toast">
            <Check size={16} /> {t('item.copied')}
          </div>
        )}
        {renderContent()}
      </div>

      {/* 备注区 - 内容下方，作为批注 */}
      {!isEditingContent && (
        <div className="preview-note-section">
          <NoteDisplay
            item={item}
            editingNoteId={editingNoteId}
            editNote={editNote}
            onEditNoteChange={setEditNote}
            onStartEditNote={startEditNote}
            onSaveNote={saveNote}
            onCancelNoteEdit={cancelNoteEdit}
          />
          {!item.user_note && editingNoteId !== item.id && (
            <button className="preview-add-note-btn" onClick={() => startEditNote(item)}>
              <StickyNote size={12} />
              <span>{t('item.addNote')}</span>
            </button>
          )}
        </div>
      )}

      {/* 元信息 - 底部参考 */}
      {!isEditingContent && (
        <div className="preview-meta">
          <span className="preview-meta-time">{formatDate(item.created_at, i18n.language)}</span>
          <span className="preview-meta-source">{getSourceApp(item.metadata)}</span>
        </div>
      )}

      {/* 工具栏 */}
      <div className="preview-toolbar">
        {isEditingContent ? (
          <>
            <span className="preview-toolbar-hint">{t('editModal.saveHint')}</span>
            <button className="preview-tool-btn" onClick={() => setIsEditingContent(false)}>
              <span>{t('panel.cancelEdit')}</span>
            </button>
            <button className="preview-tool-btn active" onClick={handleSaveContent}>
              <Check size={14} />
              <span>{t('panel.saveContent')}</span>
            </button>
          </>
        ) : (
          <>
            <button className="preview-tool-btn" onClick={() => handleCopy(item)}>
              <Copy size={14} />
              <span>{t('item.copy')}</span>
            </button>
            <button
              className={`preview-tool-btn ${item.is_favorite ? 'active' : ''}`}
              onClick={() => toggleFavorite(item)}
            >
              <Star size={14} fill={item.is_favorite ? 'currentColor' : 'none'} />
              <span>{item.is_favorite ? t('item.favorited') : t('item.favorite')}</span>
            </button>
            {shouldShowAIButton && (
              <button
                className="preview-tool-btn"
                onClick={() => generateAITags(item)}
                disabled={generatingAI === item.id}
              >
                <Sparkles size={14} />
                <span>{generatingAI === item.id ? t('item.generating') : t('item.aiTag')}</span>
              </button>
            )}
            {shouldShowOCRButton && (
              <button
                className="preview-tool-btn"
                onClick={() => handleOCR(item)}
                disabled={ocrProcessing === item.id}
              >
                <Search size={14} />
                <span>{ocrProcessing === item.id ? t('item.recognizing') : t('item.ocr')}</span>
              </button>
            )}
            {shouldShowOpenButton && (
              <button className="preview-tool-btn" onClick={handleOpen} title={openButtonTitle}>
                <ExternalLink size={14} />
                <span>{t('item.open')}</span>
              </button>
            )}
            {item.type_ !== 'image' && item.type_ !== 'file' && (
              <button className="preview-tool-btn" onClick={handleStartEditContent}>
                <span>{t('panel.editContent')}</span>
              </button>
            )}
            <button className="preview-tool-btn danger" onClick={() => deleteItem(item)}>
              <Trash2 size={14} />
              <span>{t('item.delete')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default PreviewPanel;

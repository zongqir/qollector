import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Copy, Trash2, Plus } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import useAppStore from '../../store/useAppStore';
import CollectionCard from './CollectionCard';

// 可排序的卡片包装器
function SortableCard({ item, isCopied, onUnpin, onClick, onDoubleClick }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <CollectionCard
        item={item}
        isCopied={isCopied}
        onUnpin={onUnpin}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        dragListeners={listeners}
      />
    </div>
  );
}

function CollectionPanel() {
  const { t } = useTranslation();
  const [quickNote, setQuickNote] = useState('');
  const [pinnedOrder, setPinnedOrder] = useState(null);

  const items = useAppStore(s => s.items);
  const addQuickNote = useAppStore(s => s.addQuickNote);
  const mergeCopyPinned = useAppStore(s => s.mergeCopyPinned);
  const clearAllPinned = useAppStore(s => s.clearAllPinned);
  const togglePin = useAppStore(s => s.togglePin);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const handleCopy = useAppStore(s => s.handleCopy);

  const pinnedItems = useMemo(() => {
    const pinned = items.filter(i => i.is_pinned);
    if (!pinnedOrder) return pinned;
    const orderMap = new Map(pinnedOrder.map((id, idx) => [id, idx]));
    return [...pinned].sort((a, b) => {
      const aIdx = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
      const bIdx = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
      return aIdx - bIdx;
    });
  }, [items, pinnedOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pinnedItems.findIndex(i => i.id === active.id);
    const newIndex = pinnedItems.findIndex(i => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(pinnedItems.map(i => i.id), oldIndex, newIndex);
    setPinnedOrder(newOrder);
  }, [pinnedItems]);

  const handleQuickNoteSubmit = useCallback(async (e) => {
    if (e.key === 'Enter' && !e.shiftKey && quickNote.trim()) {
      e.preventDefault();
      await addQuickNote(quickNote);
      setQuickNote('');
    }
  }, [quickNote, addQuickNote]);

  const handleNativeDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleNativeDrop = useCallback(async (e) => {
    e.preventDefault();
    const clipboxData = e.dataTransfer.getData('application/x-clipbox-item');
    if (clipboxData) {
      try {
        const { id } = JSON.parse(clipboxData);
        const item = items.find(i => i.id === id);
        if (item && !item.is_pinned) {
          await togglePin(item);
        }
      } catch (err) {
        console.error('拖入失败:', err);
      }
    }
  }, [items, togglePin]);

  const handleCardClick = useCallback((item) => {
    setPanelMode('preview', item);
  }, [setPanelMode]);

  const handleCardDoubleClick = useCallback((item) => {
    handleCopy(item);
  }, [handleCopy]);

  const quickNoteSection = (
    <div className="collection-quick-note">
      <div className="quick-note-input-wrapper">
        <Plus size={16} className="quick-note-icon" />
        <input
          type="text"
          className="quick-note-input"
          placeholder={t('collection.quickNotePlaceholder')}
          value={quickNote}
          onChange={(e) => setQuickNote(e.target.value)}
          onKeyDown={handleQuickNoteSubmit}
        />
      </div>
    </div>
  );

  if (pinnedItems.length === 0) {
    return (
      <div className="collection-panel" onDragOver={handleNativeDragOver} onDrop={handleNativeDrop}>
        {quickNoteSection}
        <div className="collection-empty">
          <div className="collection-empty-icon">
            <Package size={48} strokeWidth={1} />
          </div>
          <div className="collection-empty-title">{t('collection.emptyTitle')}</div>
          <div className="collection-empty-hint">{t('collection.emptyHint')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="collection-panel" onDragOver={handleNativeDragOver} onDrop={handleNativeDrop}>
      {quickNoteSection}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={pinnedItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <div className="collection-cards">
            {pinnedItems.map(item => (
              <SortableCard
                key={item.id}
                item={item}
                isCopied={copiedItemId === item.id}
                onUnpin={() => togglePin(item)}
                onClick={() => handleCardClick(item)}
                onDoubleClick={() => handleCardDoubleClick(item)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="collection-bottom-bar">
        <button className="collection-btn merge-btn" onClick={mergeCopyPinned} title={t('collection.mergeCopy')}>
          <Copy size={14} />
          <span>{t('collection.mergeCopy')}</span>
        </button>
        <button className="collection-btn clear-btn" onClick={clearAllPinned} title={t('collection.clearAll')}>
          <Trash2 size={14} />
          <span>{t('collection.clearAll')}</span>
        </button>
      </div>
    </div>
  );
}

export default CollectionPanel;
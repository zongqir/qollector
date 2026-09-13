import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './workbench-canvas.css';
import StickyNoteNode from './StickyNoteNode';
import { updateItem } from '../../../services/clipboardService';
import { saveQuickNote } from '../../../services/quickNoteService';
import { QUICK_INPUT_SOURCE } from '../../../utils/sourceConstants';
import {
  Maximize2,
  Plus,
  LayoutGrid,
  List,
  Sparkles,
} from 'lucide-react';

const NODE_TYPES = {
  stickyNote: StickyNoteNode,
};

const DEFAULT_NODE_WIDTH = 270;
const DEFAULT_NODE_HEIGHT = 190;
const GRID_GAP = 24;
const GRID_COLS = 3;
const PALETTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'orange'];

const resolveItemColor = (item, index, savedColor) => {
  if (savedColor && savedColor !== 'default') return savedColor;
  if (item?.metadata) {
    try {
      const parsed = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
      if (parsed?.card_background && parsed.card_background !== 'default') {
        return parsed.card_background;
      }
    } catch {}
  }
  return PALETTE_COLORS[index % PALETTE_COLORS.length];
};

const getCanvasLayoutStorageKey = (workbenchId) =>
  `qollect.workbench.canvas.layout.${workbenchId || 'default'}.v1`;

const loadSavedLayout = (workbenchId) => {
  try {
    const raw = localStorage.getItem(getCanvasLayoutStorageKey(workbenchId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const persistSavedLayout = (workbenchId, layout) => {
  try {
    localStorage.setItem(getCanvasLayoutStorageKey(workbenchId), JSON.stringify(layout));
  } catch (error) {
    console.warn('[WorkbenchCanvas] save layout failed:', error);
  }
};

function WorkbenchCanvas({
  pinnedItems = [],
  activeWorkbenchId,
  aiEnabled = false,
  uiLanguage = 'zh-CN',
  onCopyItem,
  onUnpinItem,
  onRefreshItems,
  t,
  viewMode = 'canvas',
  onToggleViewMode,
}) {
  const [nodes, setNodes] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const reactFlowInstanceRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const layoutMapRef = useRef({});

  // Load layout map for this workbench
  useEffect(() => {
    layoutMapRef.current = loadSavedLayout(activeWorkbenchId);
  }, [activeWorkbenchId]);

  const handleUpdateNodeContent = useCallback(
    async (itemId, newContent) => {
      const targetItem = pinnedItems.find((i) => i.id === itemId);
      if (!targetItem) return;
      try {
        const updatedItem = {
          ...targetItem,
          content: newContent,
          updated_at: Math.floor(Date.now() / 1000),
        };
        await updateItem(updatedItem);
        onRefreshItems?.();
      } catch (error) {
        console.error('[WorkbenchCanvas] update item content failed:', error);
      }
    },
    [onRefreshItems, pinnedItems]
  );

  const handleUpdateNodeColor = useCallback(
    (itemId, newColor) => {
      layoutMapRef.current[itemId] = {
        ...layoutMapRef.current[itemId],
        color: newColor,
      };
      persistSavedLayout(activeWorkbenchId, layoutMapRef.current);
      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.id === itemId
            ? { ...n, data: { ...n.data, color: newColor } }
            : n
        )
      );
    },
    [activeWorkbenchId]
  );

  const handleCopy = useCallback(
    (item) => {
      setCopiedId(item.id);
      onCopyItem?.(item);
      window.setTimeout(() => setCopiedId(null), 1200);
    },
    [onCopyItem]
  );

  // Synchronize pinned items to React Flow nodes
  useEffect(() => {
    const layoutMap = layoutMapRef.current;
    let hasNewUnsavedPositions = false;

    const nextNodes = pinnedItems.map((item, index) => {
      const saved = layoutMap[item.id];
      let position;
      let width = DEFAULT_NODE_WIDTH;
      let height = DEFAULT_NODE_HEIGHT;
      let color = resolveItemColor(item, index, saved?.color);

      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        position = { x: saved.x, y: saved.y };
        if (saved.width) width = saved.width;
        if (saved.height) height = saved.height;
      } else {
        // Auto grid coordinate for unpositioned items
        const col = index % GRID_COLS;
        const row = Math.floor(index / GRID_COLS);
        position = {
          x: 40 + col * (DEFAULT_NODE_WIDTH + GRID_GAP),
          y: 40 + row * (DEFAULT_NODE_HEIGHT + GRID_GAP),
        };
        layoutMap[item.id] = { ...position, width, height, color };
        hasNewUnsavedPositions = true;
      }

      return {
        id: item.id,
        type: 'stickyNote',
        position,
        style: { width, height },
        data: {
          item,
          color,
          onUpdateContent: handleUpdateNodeContent,
          onUpdateColor: handleUpdateNodeColor,
          onUnpin: onUnpinItem,
          onCopy: handleCopy,
          isCopied: copiedId === item.id,
          t,
          uiLanguage,
          aiEnabled,
        },
      };
    });

    if (hasNewUnsavedPositions) {
      persistSavedLayout(activeWorkbenchId, layoutMap);
    }

    setNodes(nextNodes);
  }, [
    pinnedItems,
    activeWorkbenchId,
    aiEnabled,
    copiedId,
    handleCopy,
    handleUpdateNodeColor,
    handleUpdateNodeContent,
    onUnpinItem,
    t,
    uiLanguage,
  ]);

  // Handle position / size changes on canvas
  const handleNodesChange = useCallback(
    (changes) => {
      setNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(changes, currentNodes);

        // Debounce saving layout positions & dimensions
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          nextNodes.forEach((node) => {
            const existing = layoutMapRef.current[node.id] || {};
            layoutMapRef.current[node.id] = {
              ...existing,
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
              width: node.style?.width || node.measured?.width || existing.width || DEFAULT_NODE_WIDTH,
              height: node.style?.height || node.measured?.height || existing.height || DEFAULT_NODE_HEIGHT,
            };
          });
          persistSavedLayout(activeWorkbenchId, layoutMapRef.current);
        }, 300);

        return nextNodes;
      });
    },
    [activeWorkbenchId]
  );

  const handleFitView = useCallback(() => {
    reactFlowInstanceRef.current?.fitView({ padding: 0.2, duration: 400 });
  }, []);

  const handleAutoArrange = useCallback(() => {
    const layoutMap = {};
    const arrangedNodes = nodes.map((node, index) => {
      const col = index % GRID_COLS;
      const row = Math.floor(index / GRID_COLS);
      const position = {
        x: 40 + col * (DEFAULT_NODE_WIDTH + GRID_GAP),
        y: 40 + row * (DEFAULT_NODE_HEIGHT + GRID_GAP),
      };
      const width = DEFAULT_NODE_WIDTH;
      const height = DEFAULT_NODE_HEIGHT;
      layoutMap[node.id] = { ...position, width, height, color: node.data?.color || 'default' };
      return {
        ...node,
        position,
        style: { ...node.style, width, height },
      };
    });

    layoutMapRef.current = layoutMap;
    persistSavedLayout(activeWorkbenchId, layoutMap);
    setNodes(arrangedNodes);
    window.setTimeout(() => handleFitView(), 50);
  }, [activeWorkbenchId, handleFitView, nodes]);

  const handleAddNewNote = useCallback(async () => {
    try {
      const defaultText = t ? t('workbench.expandedNotePlaceholder') : 'New note';
      await saveQuickNote(defaultText, QUICK_INPUT_SOURCE, {
        autoPin: true,
        workbenchId: activeWorkbenchId,
      });
      onRefreshItems?.();
    } catch (error) {
      console.error('[WorkbenchCanvas] add note failed:', error);
    }
  }, [activeWorkbenchId, onRefreshItems, t]);

  return (
    <div className="workbench-canvas-container">
      <div className="workbench-canvas-wrapper">
        <ReactFlow
          nodes={nodes}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            instance.fitView({ padding: 0.15 });
          }}
          minZoom={0.2}
          maxZoom={2.5}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
          fitView
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color="rgba(255, 255, 255, 0.12)"
          />
        </ReactFlow>
      </div>

      {/* Floating Canvas Controls */}
      <div className="workbench-canvas-toolbar" role="toolbar">
        <button
          type="button"
          className="workbench-canvas-tool-btn primary"
          onClick={handleAddNewNote}
          title={t ? t('workbench.createStickyNote') || '新建便签' : '新建便签'}
        >
          <Plus size={14} />
          <span>{t ? t('workbench.createStickyNote') || '新建便签' : '新建便签'}</span>
        </button>

        <div className="workbench-canvas-tool-divider" />

        <button
          type="button"
          className="workbench-canvas-tool-btn"
          onClick={handleFitView}
          title={t ? t('workbench.fitView') || '全览居中' : '全览居中'}
        >
          <Maximize2 size={13} />
          <span>{t ? t('workbench.fitView') || '全览' : '全览'}</span>
        </button>

        <button
          type="button"
          className="workbench-canvas-tool-btn"
          onClick={handleAutoArrange}
          title={t ? t('workbench.autoArrange') || '自动整齐排列' : '自动排列'}
        >
          <LayoutGrid size={13} />
          <span>{t ? t('workbench.autoArrange') || '整理' : '整理'}</span>
        </button>

        {onToggleViewMode && (
          <>
            <div className="workbench-canvas-tool-divider" />
            <button
              type="button"
              className="workbench-canvas-tool-btn"
              onClick={onToggleViewMode}
              title={t ? t('workbench.switchToListMode') || '切换至列表模式' : '列表模式'}
            >
              <List size={13} />
              <span>{t ? t('workbench.listView') || '列表' : '列表'}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(WorkbenchCanvas);

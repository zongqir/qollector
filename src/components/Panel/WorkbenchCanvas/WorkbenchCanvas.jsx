import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  MarkerType,
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
  Sparkles,
  Layers,
  ChevronDown,
  Pencil,
  Trash2,
  Check,
  CheckCircle2,
  Unlink,
} from 'lucide-react';

const NODE_TYPES = {
  stickyNote: StickyNoteNode,
};

const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 190;
const GRID_GAP = 24;
const GRID_COLS = 3;

const getCanvasLayoutStorageKey = (workbenchId) =>
  `qollect.workbench.canvas.layout.${workbenchId || 'default'}.v1`;

const getCanvasEdgesStorageKey = (workbenchId) =>
  `qollect.workbench.canvas.edges.${workbenchId || 'default'}.v1`;

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

const loadSavedEdges = (workbenchId) => {
  try {
    const raw = localStorage.getItem(getCanvasEdgesStorageKey(workbenchId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((edge) => ({
      ...edge,
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: 'var(--accent-color, #3b82f6)',
      },
      style: {
        stroke: 'var(--accent-color, #3b82f6)',
        strokeWidth: 2,
        ...(edge.style || {}),
      },
    }));
  } catch {
    return [];
  }
};

const persistSavedEdges = (workbenchId, edges) => {
  try {
    localStorage.setItem(getCanvasEdgesStorageKey(workbenchId), JSON.stringify(edges));
  } catch (error) {
    console.warn('[WorkbenchCanvas] save edges failed:', error);
  }
};

/**
 * Smart collision-free slot finder.
 * Finds the first unoccupied grid slot so new notes never stack on top of existing notes.
 */
const findNextAvailablePosition = (layoutMap) => {
  const occupied = Object.values(layoutMap || {}).filter(
    (p) => p && typeof p.x === 'number' && typeof p.y === 'number'
  );

  for (let row = 0; row < 100; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const candidateX = 40 + col * (DEFAULT_NODE_WIDTH + GRID_GAP);
      const candidateY = 40 + row * (DEFAULT_NODE_HEIGHT + GRID_GAP);

      const isOccupied = occupied.some((p) => {
        const w = p.width || DEFAULT_NODE_WIDTH;
        const h = p.height || DEFAULT_NODE_HEIGHT;
        const xOverlap = Math.abs(p.x - candidateX) < Math.min(w, DEFAULT_NODE_WIDTH) * 0.75;
        const yOverlap = Math.abs(p.y - candidateY) < Math.min(h, DEFAULT_NODE_HEIGHT) * 0.75;
        return xOverlap && yOverlap;
      });

      if (!isOccupied) {
        return { x: candidateX, y: candidateY };
      }
    }
  }
  return { x: 40, y: 40 };
};

function WorkbenchCanvas({
  pinnedItems = [],
  workbenches = [],
  activeWorkbenchId,
  activeWorkbenchLabel,
  onSelectWorkbench,
  onCreateWorkbench,
  onRenameWorkbench,
  onDeleteWorkbench,
  aiEnabled = false,
  uiLanguage = 'zh-CN',
  onCopyItem,
  onUnpinItem,
  onRefreshItems,
  onAddQuickNote,
  onEditItem,
  onPreviewItem,
  onSetCardBackground,
  onOpenItem,
  onRevealInFolder,
  onContextMenu,
  supportsNativeExternalDrag,
  onStartExternalDrag,
  t,
}) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [copiedId, setCopiedId] = useState(null);
  const [showBoardMenu, setShowBoardMenu] = useState(false);
  const [isCreatingInline, setIsCreatingInline] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark-mode')
      : false
  );
  const reactFlowInstanceRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const layoutMapRef = useRef({});
  const hasFittedInitialViewRef = useRef(false);
  const boardSwitcherRef = useRef(null);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const updateTheme = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark-mode'));
    };
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Dismiss board switcher on outside pointerdown
  useEffect(() => {
    if (!showBoardMenu) return undefined;
    const handleClickOutside = (event) => {
      if (boardSwitcherRef.current && !boardSwitcherRef.current.contains(event.target)) {
        setShowBoardMenu(false);
        setIsCreatingInline(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, [showBoardMenu]);

  // Load layout map and edges for this workbench
  useEffect(() => {
    layoutMapRef.current = loadSavedLayout(activeWorkbenchId);
    setEdges(loadSavedEdges(activeWorkbenchId));
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

  const handleResizeNode = useCallback((nodeId, width, height) => {
    setNodes((prevNodes) =>
      prevNodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              style: { ...n.style, width, height },
              measured: { ...n.measured, width, height },
            }
          : n
      )
    );
    const existing = layoutMapRef.current[nodeId] || {};
    layoutMapRef.current[nodeId] = {
      ...existing,
      width,
      height,
    };
  }, []);

  const handleResizeNodeEnd = useCallback(
    () => {
      persistSavedLayout(activeWorkbenchId, layoutMapRef.current);
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

  // Synchronize pinned items to React Flow nodes with collision-free slot allocation
  useEffect(() => {
    const layoutMap = layoutMapRef.current;
    let hasNewUnsavedPositions = false;

    const nextNodes = pinnedItems.map((item) => {
      const saved = layoutMap[item.id];
      let position;
      let width = DEFAULT_NODE_WIDTH;
      let height = DEFAULT_NODE_HEIGHT;

      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        position = { x: saved.x, y: saved.y };
        if (saved.width) width = saved.width;
        if (saved.height) height = saved.height;
      } else {
        position = findNextAvailablePosition(layoutMap);
        layoutMap[item.id] = { ...position, width, height };
        hasNewUnsavedPositions = true;
      }

      return {
        id: item.id,
        type: 'stickyNote',
        position,
        style: { width, height },
        data: {
          item,
          onUpdateContent: handleUpdateNodeContent,
          onSetCardBackground,
          onEditItem,
          onPreviewItem,
          onOpenItem,
          onRevealInFolder,
          onContextMenu,
          supportsNativeExternalDrag,
          onStartExternalDrag,
          onResizeNode: handleResizeNode,
          onResizeNodeEnd: handleResizeNodeEnd,
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
    handleResizeNode,
    handleResizeNodeEnd,
    handleUpdateNodeContent,
    onEditItem,
    onPreviewItem,
    onSetCardBackground,
    onOpenItem,
    onRevealInFolder,
    onContextMenu,
    supportsNativeExternalDrag,
    onStartExternalDrag,
    onUnpinItem,
    t,
    uiLanguage,
  ]);

  // Handle position / size changes on canvas
  const handleNodesChange = useCallback(
    (changes) => {
      setNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(changes, currentNodes);

        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          nextNodes.forEach((node) => {
            const existing = layoutMapRef.current[node.id] || {};
            const rawW = node.style?.width || node.measured?.width || existing.width || DEFAULT_NODE_WIDTH;
            const rawH = node.style?.height || node.measured?.height || existing.height || DEFAULT_NODE_HEIGHT;
            const width = typeof rawW === 'number' ? Math.round(rawW) : parseInt(rawW, 10) || DEFAULT_NODE_WIDTH;
            const height = typeof rawH === 'number' ? Math.round(rawH) : parseInt(rawH, 10) || DEFAULT_NODE_HEIGHT;
            layoutMapRef.current[node.id] = {
              ...existing,
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
              width,
              height,
            };
          });
          persistSavedLayout(activeWorkbenchId, layoutMapRef.current);
        }, 200);

        return nextNodes;
      });
    },
    [activeWorkbenchId]
  );

  const handleEdgesChange = useCallback(
    (changes) => {
      setEdges((currentEdges) => {
        const nextEdges = applyEdgeChanges(changes, currentEdges);
        persistSavedEdges(activeWorkbenchId, nextEdges);
        return nextEdges;
      });
    },
    [activeWorkbenchId]
  );

  const handleConnect = useCallback(
    (params) => {
      setEdges((currentEdges) => {
        const newEdge = {
          ...params,
          id: `edge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'smoothstep',
          animated: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: 'var(--accent-color, #3b82f6)',
          },
          style: {
            stroke: 'var(--accent-color, #3b82f6)',
            strokeWidth: 2,
          },
        };
        const nextEdges = addEdge(newEdge, currentEdges);
        persistSavedEdges(activeWorkbenchId, nextEdges);
        return nextEdges;
      });
    },
    [activeWorkbenchId]
  );

  const handleFitView = useCallback(() => {
    reactFlowInstanceRef.current?.fitView({ padding: 0.18, maxZoom: 1.2, duration: 350 });
  }, []);

  // Smooth fitView on initial load when nodes arrive
  useEffect(() => {
    if (nodes.length > 0 && !hasFittedInitialViewRef.current && reactFlowInstanceRef.current) {
      hasFittedInitialViewRef.current = true;
      const timer = setTimeout(() => {
        reactFlowInstanceRef.current?.fitView({ padding: 0.18, maxZoom: 1.2, duration: 300 });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [nodes.length]);

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
      layoutMap[node.id] = { ...position, width, height };
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
      const defaultText = t ? t('workbench.expandedNotePlaceholder') || '输入笔记...' : '输入笔记...';
      const nextPos = findNextAvailablePosition(layoutMapRef.current);

      let rawResult = null;
      if (onAddQuickNote) {
        rawResult = await onAddQuickNote(defaultText);
      } else {
        rawResult = await saveQuickNote(defaultText, QUICK_INPUT_SOURCE, {
          autoPin: true,
          workbenchId: activeWorkbenchId,
        });
      }

      const newId = typeof rawResult === 'string' || typeof rawResult === 'number'
        ? rawResult
        : rawResult?.id;

      if (newId) {
        layoutMapRef.current[newId] = {
          ...nextPos,
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
        };
        persistSavedLayout(activeWorkbenchId, layoutMapRef.current);
      }
      onRefreshItems?.();
    } catch (error) {
      console.error('[WorkbenchCanvas] add note failed:', error);
    }
  }, [activeWorkbenchId, onAddQuickNote, onRefreshItems, t]);

  // Double click empty canvas area to create a new note directly at mouse coordinates
  const handlePaneDoubleClick = useCallback(
    async (event) => {
      if (
        event.target.closest('.sticky-note-node') ||
        event.target.closest('.workbench-canvas-toolbar') ||
        event.target.closest('.workbench-canvas-empty-overlay') ||
        event.target.closest('button') ||
        event.target.closest('textarea')
      ) {
        return;
      }

      const position = reactFlowInstanceRef.current
        ? reactFlowInstanceRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        : { x: 80, y: 80 };

      const noteX = Math.round(position.x - DEFAULT_NODE_WIDTH / 2);
      const noteY = Math.round(position.y - 30);

      try {
        const defaultText = t ? t('workbench.expandedNotePlaceholder') || '输入笔记...' : '输入笔记...';
        let rawResult = null;
        if (onAddQuickNote) {
          rawResult = await onAddQuickNote(defaultText);
        } else {
          rawResult = await saveQuickNote(defaultText, QUICK_INPUT_SOURCE, {
            autoPin: true,
            workbenchId: activeWorkbenchId,
          });
        }

        const newId = typeof rawResult === 'string' || typeof rawResult === 'number'
          ? rawResult
          : rawResult?.id;

        if (newId) {
          layoutMapRef.current[newId] = {
            x: Math.max(20, noteX),
            y: Math.max(20, noteY),
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
          };
          persistSavedLayout(activeWorkbenchId, layoutMapRef.current);
        }
        onRefreshItems?.();
      } catch (error) {
        console.error('[WorkbenchCanvas] create note on double click failed:', error);
      }
    },
    [activeWorkbenchId, onAddQuickNote, onRefreshItems, t]
  );

  const handleClearEdges = useCallback(() => {
    if (edges.length === 0) return;
    const confirmed = window.confirm(
      t ? t('workbench.clearEdgesConfirm') || '确定清除当前画布上的所有连接线吗？' : '确定清除当前画布上的所有连接线吗？'
    );
    if (!confirmed) return;
    setEdges([]);
    persistSavedEdges(activeWorkbenchId, []);
  }, [activeWorkbenchId, edges.length, t]);

  const handleInlineCreateSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      const trimmed = newBoardName.trim();
      if (!trimmed) {
        setIsCreatingInline(false);
        return;
      }
      try {
        await onCreateWorkbench?.(trimmed);
        setNewBoardName('');
        setIsCreatingInline(false);
        setShowBoardMenu(false);
      } catch (error) {
        console.error('[WorkbenchCanvas] create canvas failed:', error);
      }
    },
    [newBoardName, onCreateWorkbench]
  );

  const currentBoardDisplayName = useMemo(() => {
    if (activeWorkbenchLabel) return activeWorkbenchLabel;
    const found = workbenches.find((w) => w.id === activeWorkbenchId);
    if (found?.name) return found.name;
    return t ? t('workbench.defaultWorkbench') || '默认画布' : '默认画布';
  }, [activeWorkbenchId, activeWorkbenchLabel, t, workbenches]);

  return (
    <div className="workbench-canvas-container" onDoubleClick={handlePaneDoubleClick}>
      <div className="workbench-canvas-wrapper">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          connectionLineType="smoothstep"
          deleteKeyCode={['Backspace', 'Delete']}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            if (nodes.length > 0) {
              instance.fitView({ padding: 0.18, maxZoom: 1.2 });
            }
          }}
          minZoom={0.2}
          maxZoom={2.5}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          proOptions={{ hideAttribution: true }}
          fitView={nodes.length > 0}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color={isDarkMode ? 'rgba(255, 255, 255, 0.13)' : 'rgba(100, 116, 139, 0.22)'}
          />
        </ReactFlow>
      </div>

      {/* Empty State Overlay */}
      {nodes.length === 0 && (
        <div className="workbench-canvas-empty-overlay">
          <div className="workbench-canvas-empty-card">
            <div className="workbench-canvas-empty-icon">
              <Sparkles size={26} />
            </div>
            <div className="workbench-canvas-empty-title">
              {t ? t('workbench.emptyTitle') || '工作台画布是空的' : '工作台画布是空的'}
            </div>
            <div className="workbench-canvas-empty-desc">
              {t
                ? t('workbench.canvasEmptyHint') || '在画布空白处双击，或点击下方「新建便签」开始创作'
                : '在画布空白处双击，或点击下方「新建便签」开始创作'}
            </div>
            <button
              type="button"
              className="workbench-canvas-empty-btn"
              onClick={handleAddNewNote}
            >
              <Plus size={14} />
              <span>{t ? t('workbench.createStickyNote') || '新建便签' : '新建便签'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating Canvas Controls */}
      <div className="workbench-canvas-toolbar" role="toolbar">
        {/* Canvas Board Switcher & Management */}
        <div className="workbench-canvas-board-wrapper" ref={boardSwitcherRef}>
          <button
            type="button"
            className={`workbench-canvas-tool-btn board-btn ${showBoardMenu ? 'active' : ''}`}
            onClick={() => setShowBoardMenu((prev) => !prev)}
            title={t ? t('workbench.switchWorkbench') || '切换画布' : '切换画布'}
          >
            <Layers size={13} />
            <span className="workbench-canvas-board-label">{currentBoardDisplayName}</span>
            <ChevronDown
              size={12}
              className={`workbench-canvas-chevron ${showBoardMenu ? 'open' : ''}`}
            />
          </button>

          {showBoardMenu && (
            <div className="workbench-canvas-board-popover">
              <div className="workbench-canvas-board-popover-header">
                <div className="workbench-canvas-board-popover-title">
                  <Layers size={13} />
                  <span>{t ? t('workbench.myCanvases') || '我的画布' : '我的画布'}</span>
                </div>
                <button
                  type="button"
                  className="workbench-canvas-board-create-btn"
                  onClick={() => setIsCreatingInline((prev) => !prev)}
                  title={t ? t('workbench.createCanvas') || '新建画布' : '新建画布'}
                >
                  <Plus size={13} />
                  <span>{t ? t('workbench.createCanvas') || '新建' : '新建'}</span>
                </button>
              </div>

              {isCreatingInline && (
                <form
                  className="workbench-canvas-board-create-form"
                  onSubmit={handleInlineCreateSubmit}
                >
                  <input
                    type="text"
                    className="workbench-canvas-board-create-input"
                    value={newBoardName}
                    onChange={(e) => setNewBoardName(e.target.value)}
                    placeholder={t ? t('workbench.enterCanvasName') || '输入画布名称并回车...' : '输入画布名称并回车...'}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsCreatingInline(false);
                        setNewBoardName('');
                      }
                    }}
                  />
                  <button type="submit" className="workbench-canvas-board-create-submit">
                    <Check size={13} />
                  </button>
                </form>
              )}

              <div className="workbench-canvas-board-list">
                {workbenches.map((wb) => {
                  const isActive =
                    wb.id === activeWorkbenchId || (!activeWorkbenchId && wb.is_default);
                  const isDefault = Boolean(wb.is_default);
                  return (
                    <div
                      key={wb.id}
                      className={`workbench-canvas-board-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        onSelectWorkbench?.(wb.id);
                        setShowBoardMenu(false);
                        setIsCreatingInline(false);
                      }}
                    >
                      <div className="workbench-canvas-board-item-main">
                        <span className={`workbench-canvas-board-indicator ${isActive ? 'active' : ''}`} />
                        <span className="workbench-canvas-board-name">
                          {wb.name || (t ? t('workbench.defaultWorkbench') : '默认画布')}
                        </span>
                        {isDefault && (
                          <span className="workbench-canvas-board-tag">
                            {t ? t('workbench.defaultBadge') || '默认' : '默认'}
                          </span>
                        )}
                      </div>

                      {!isDefault && (
                        <div
                          className="workbench-canvas-board-item-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="workbench-canvas-board-action-btn"
                            onClick={() => onRenameWorkbench?.(wb.id)}
                            title={t ? t('workbench.renameCanvas') || '重命名' : '重命名'}
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            className="workbench-canvas-board-action-btn danger"
                            onClick={() => onDeleteWorkbench?.(wb.id)}
                            title={t ? t('workbench.deleteCanvas') || '删除' : '删除'}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="workbench-canvas-tool-divider" />

        {/* Real-time Status Badge */}
        <div
          className="workbench-canvas-status-pill"
          title={t ? t('workbench.canvasAutoSaved') || '所有便签位置与连线均已实时保存' : '已自动保存'}
        >
          <CheckCircle2 size={12} className="wb-saved-icon" />
          <span>{nodes.length} {t ? t('workbench.countLabel', { count: nodes.length }) || '条' : '条'}</span>
        </div>

        <div className="workbench-canvas-tool-divider" />

        {/* Primary Action: Add Sticky Note */}
        <button
          type="button"
          className="workbench-canvas-tool-btn primary"
          onClick={handleAddNewNote}
          title={t ? t('workbench.createStickyNote') || '新建便签' : '新建便签'}
        >
          <Plus size={14} />
          <span>{t ? t('workbench.createStickyNote') || '新建便签' : '新建便签'}</span>
        </button>

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

        {edges.length > 0 && (
          <button
            type="button"
            className="workbench-canvas-tool-btn danger-hover"
            onClick={handleClearEdges}
            title={t ? t('workbench.clearEdges') || '清空连线' : '清空连线'}
          >
            <Unlink size={13} />
            <span>{t ? t('workbench.clearEdges') || '清除连线' : '清除连线'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(WorkbenchCanvas);


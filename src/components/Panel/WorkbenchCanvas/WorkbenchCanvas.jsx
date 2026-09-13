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
import { updateItem, pinItem } from '../../../services/clipboardService';
import { saveQuickNote } from '../../../services/quickNoteService';
import { QUICK_INPUT_SOURCE } from '../../../utils/sourceConstants';
import { INTERNAL_DRAG_MIME } from '../../../constants/dragDrop';
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
  X,
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
      type: 'default', // Smooth curved bezier line
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

/**
 * Connection-Aware & Flow-Aware topological arrangement.
 * Orders connected chains in topological levels (source before target)
 * and dynamically calculates comfortable columns to keep text readable.
 */
const computeArrangedLayout = (nodes, edges) => {
  if (!nodes || nodes.length === 0) return { arrangedNodes: [], layoutMap: {} };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map();
  const incoming = new Map();
  const inDegree = new Map();

  nodes.forEach((n) => {
    outgoing.set(n.id, new Set());
    incoming.set(n.id, new Set());
    inDegree.set(n.id, 0);
  });

  (edges || []).forEach((e) => {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      outgoing.get(e.source).add(e.target);
      incoming.get(e.target).add(e.source);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }
  });

  // Calculate topological levels
  const levels = new Map();
  const visited = new Set();
  const rootNodes = nodes.filter((n) => (inDegree.get(n.id) || 0) === 0 && outgoing.get(n.id).size > 0);

  const queue = rootNodes.map((n) => ({ id: n.id, level: 0 }));
  queue.forEach((item) => {
    levels.set(item.id, 0);
    visited.add(item.id);
  });

  while (queue.length > 0) {
    const { id, level } = queue.shift();
    const children = Array.from(outgoing.get(id) || []);
    children.forEach((childId) => {
      const nextLevel = level + 1;
      const currentLevel = levels.get(childId) ?? 0;
      levels.set(childId, Math.max(currentLevel, nextLevel));
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push({ id: childId, level: nextLevel });
      }
    });
  }

  // Connected nodes sorted by topological level
  const connectedNodes = nodes
    .filter((n) => outgoing.get(n.id).size > 0 || (incoming.get(n.id)?.size || 0) > 0)
    .sort((a, b) => (levels.get(a.id) ?? 0) - (levels.get(b.id) ?? 0));

  // Standalone unconnected nodes
  const standaloneNodes = nodes.filter(
    (n) => outgoing.get(n.id).size === 0 && (incoming.get(n.id)?.size || 0) === 0
  );

  const orderedNodes = [...connectedNodes, ...standaloneNodes];

  const total = orderedNodes.length;
  let dynamicCols = 3;
  if (total <= 2) dynamicCols = total || 1;
  else if (total <= 4) dynamicCols = 2;
  else if (total <= 8) dynamicCols = 3;
  else dynamicCols = 4;

  const layoutMap = {};
  const arrangedNodes = orderedNodes.map((node, index) => {
    const col = index % dynamicCols;
    const row = Math.floor(index / dynamicCols);
    const existing = node.style || {};
    const width = typeof existing.width === 'number' ? existing.width : DEFAULT_NODE_WIDTH;
    const height = typeof existing.height === 'number' ? existing.height : DEFAULT_NODE_HEIGHT;

    const position = {
      x: 40 + col * (DEFAULT_NODE_WIDTH + GRID_GAP),
      y: 40 + row * (DEFAULT_NODE_HEIGHT + GRID_GAP),
    };

    layoutMap[node.id] = { ...position, width, height };
    return {
      ...node,
      position,
      style: { ...node.style, width, height },
    };
  });

  return { arrangedNodes, layoutMap };
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
  const [editingBoardId, setEditingBoardId] = useState(null);
  const [editingBoardName, setEditingBoardName] = useState('');
  const [deletingBoardId, setDeletingBoardId] = useState(null);
  const [showClearEdgesConfirm, setShowClearEdgesConfirm] = useState(false);
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
  const clearEdgesBtnRef = useRef(null);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const updateTheme = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark-mode'));
    };
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Dismiss board switcher or clear-edges confirm on outside pointerdown
  useEffect(() => {
    if (!showBoardMenu && !showClearEdgesConfirm) return undefined;
    const handleClickOutside = (event) => {
      if (showBoardMenu && boardSwitcherRef.current && !boardSwitcherRef.current.contains(event.target)) {
        setShowBoardMenu(false);
        setIsCreatingInline(false);
        setEditingBoardId(null);
        setDeletingBoardId(null);
      }
      if (showClearEdgesConfirm && clearEdgesBtnRef.current && !clearEdgesBtnRef.current.contains(event.target)) {
        setShowClearEdgesConfirm(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, [showBoardMenu, showClearEdgesConfirm]);

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
          type: 'default', // Smooth curved bezier line
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
    reactFlowInstanceRef.current?.fitView({ padding: 0.16, maxZoom: 1.0, minZoom: 0.75, duration: 350 });
  }, []);

  // Smooth fitView on initial load when nodes arrive
  useEffect(() => {
    if (nodes.length > 0 && !hasFittedInitialViewRef.current && reactFlowInstanceRef.current) {
      hasFittedInitialViewRef.current = true;
      const timer = setTimeout(() => {
        reactFlowInstanceRef.current?.fitView({ padding: 0.16, maxZoom: 1.0, minZoom: 0.75, duration: 300 });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [nodes.length]);

  const handleAutoArrange = useCallback(() => {
    const { arrangedNodes, layoutMap } = computeArrangedLayout(nodes, edges);
    layoutMapRef.current = layoutMap;
    persistSavedLayout(activeWorkbenchId, layoutMap);
    setNodes(arrangedNodes);
    window.setTimeout(() => {
      reactFlowInstanceRef.current?.fitView({ padding: 0.16, maxZoom: 1.0, minZoom: 0.75, duration: 350 });
    }, 60);
  }, [activeWorkbenchId, edges, nodes]);

  const handleAddNewNote = useCallback(async () => {
    try {
      // Create blank note; grey hint text will be provided by placeholder
      const nextPos = findNextAvailablePosition(layoutMapRef.current);

      let rawResult = null;
      if (onAddQuickNote) {
        rawResult = await onAddQuickNote('');
      } else {
        rawResult = await saveQuickNote('', QUICK_INPUT_SOURCE, {
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
  }, [activeWorkbenchId, onAddQuickNote, onRefreshItems]);

  const lastPaneClickRef = useRef({ time: 0, x: 0, y: 0 });
  const lastCreatedNoteTimeRef = useRef(0);

  const handleCreateNoteAtMouse = useCallback(
    async (clientX, clientY) => {
      const now = Date.now();
      if (now - lastCreatedNoteTimeRef.current < 450) {
        return;
      }
      lastCreatedNoteTimeRef.current = now;

      const position = reactFlowInstanceRef.current
        ? reactFlowInstanceRef.current.screenToFlowPosition({ x: clientX, y: clientY })
        : { x: 80, y: 80 };

      const noteX = Math.round(position.x - DEFAULT_NODE_WIDTH / 2);
      const noteY = Math.round(position.y - 30);

      try {
        // Create blank note; grey hint text will be provided by placeholder
        let rawResult = null;
        if (onAddQuickNote) {
          rawResult = await onAddQuickNote('');
        } else {
          rawResult = await saveQuickNote('', QUICK_INPUT_SOURCE, {
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
        console.error('[WorkbenchCanvas] create note failed:', error);
      }
    },
    [activeWorkbenchId, onAddQuickNote, onRefreshItems]
  );

  const handlePaneClick = useCallback(
    (event) => {
      const now = Date.now();
      const prev = lastPaneClickRef.current;
      const timeDiff = now - prev.time;
      const dist = Math.hypot(event.clientX - prev.x, event.clientY - prev.y);

      lastPaneClickRef.current = { time: now, x: event.clientX, y: event.clientY };

      // Double-click detected on empty pane (<= 350ms & within 20px)
      if (timeDiff > 30 && timeDiff < 350 && dist < 20) {
        handleCreateNoteAtMouse(event.clientX, event.clientY);
      }
    },
    [handleCreateNoteAtMouse]
  );

  const handlePaneDoubleClick = useCallback(
    (event) => {
      if (
        event.target?.closest?.('.sticky-note-node') ||
        event.target?.closest?.('.workbench-canvas-toolbar') ||
        event.target?.closest?.('.workbench-canvas-empty-overlay') ||
        event.target?.closest?.('button') ||
        event.target?.closest?.('textarea') ||
        event.target?.closest?.('input')
      ) {
        return;
      }
      handleCreateNoteAtMouse(event.clientX, event.clientY);
    },
    [handleCreateNoteAtMouse]
  );

  const handleConfirmClearEdges = useCallback(() => {
    setEdges([]);
    persistSavedEdges(activeWorkbenchId, []);
    setShowClearEdgesConfirm(false);
  }, [activeWorkbenchId]);

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

  const handleCanvasDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = useCallback(
    async (e) => {
      e.preventDefault();
      const rawQollect = e.dataTransfer.getData(INTERNAL_DRAG_MIME);
      const rawText = e.dataTransfer.getData('text/plain');

      const position = reactFlowInstanceRef.current
        ? reactFlowInstanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        : { x: 80, y: 80 };

      const noteX = Math.round(position.x - DEFAULT_NODE_WIDTH / 2);
      const noteY = Math.round(position.y - 30);

      if (rawQollect) {
        try {
          const { id } = JSON.parse(rawQollect);
          if (id) {
            // Update node layout coordinate
            layoutMapRef.current[id] = {
              x: Math.max(20, noteX),
              y: Math.max(20, noteY),
              width: DEFAULT_NODE_WIDTH,
              height: DEFAULT_NODE_HEIGHT,
            };
            persistSavedLayout(activeWorkbenchId, layoutMapRef.current);

            // Pin to current active workbench
            await pinItem(id, { workbenchId: activeWorkbenchId });
            onRefreshItems?.();
            return;
          }
        } catch (err) {
          console.error('[WorkbenchCanvas] drop pin item failed:', err);
        }
      }

      // If external plain text was dropped onto canvas, create a new note at mouse drop coordinate
      if (rawText && rawText.trim()) {
        try {
          let rawResult = null;
          if (onAddQuickNote) {
            rawResult = await onAddQuickNote(rawText.trim());
          } else {
            rawResult = await saveQuickNote(rawText.trim(), QUICK_INPUT_SOURCE, {
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
        } catch (err) {
          console.error('[WorkbenchCanvas] drop create note failed:', err);
        }
      }
    },
    [activeWorkbenchId, onAddQuickNote, onRefreshItems]
  );

  const currentBoardDisplayName = useMemo(() => {
    if (activeWorkbenchLabel) return activeWorkbenchLabel;
    const found = workbenches.find((w) => w.id === activeWorkbenchId);
    if (found?.name) return found.name;
    return t ? t('workbench.defaultWorkbench') || '默认画布' : '默认画布';
  }, [activeWorkbenchId, activeWorkbenchLabel, t, workbenches]);

  return (
    <div
      className="workbench-canvas-container"
      onDoubleClick={handlePaneDoubleClick}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
    >
      <div className="workbench-canvas-wrapper">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onPaneClick={handlePaneClick}
          onDoubleClick={handlePaneDoubleClick}
          zoomOnDoubleClick={false}
          connectionLineType="default"
          deleteKeyCode={['Backspace', 'Delete']}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            if (nodes.length > 0) {
              instance.fitView({ padding: 0.16, maxZoom: 1.0, minZoom: 0.75 });
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
            onClick={() => {
              setShowBoardMenu((prev) => !prev);
              setIsCreatingInline(false);
              setEditingBoardId(null);
              setDeletingBoardId(null);
            }}
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
                  onClick={() => {
                    setIsCreatingInline((prev) => !prev);
                    setEditingBoardId(null);
                    setDeletingBoardId(null);
                  }}
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
                  onClick={(e) => e.stopPropagation()}
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
                  const isEditing = editingBoardId === wb.id;
                  const isDeleting = deletingBoardId === wb.id;

                  if (isEditing) {
                    return (
                      <form
                        key={wb.id}
                        className="workbench-canvas-board-inline-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const trimmed = editingBoardName.trim();
                          if (trimmed && trimmed !== wb.name) {
                            await onRenameWorkbench?.(wb.id, trimmed);
                          }
                          setEditingBoardId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          className="workbench-canvas-board-inline-input"
                          value={editingBoardName}
                          onChange={(e) => setEditingBoardName(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setEditingBoardId(null);
                            }
                          }}
                        />
                        <button type="submit" className="workbench-canvas-board-inline-btn success" title={t ? t('common.save') || '保存' : '保存'}>
                          <Check size={11} />
                        </button>
                        <button
                          type="button"
                          className="workbench-canvas-board-inline-btn"
                          onClick={() => setEditingBoardId(null)}
                          title={t ? t('common.cancel') || '取消' : '取消'}
                        >
                          <X size={11} />
                        </button>
                      </form>
                    );
                  }

                  if (isDeleting) {
                    return (
                      <div
                        key={wb.id}
                        className="workbench-canvas-board-delete-confirm-row"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="wb-delete-hint">{t ? t('workbench.confirmDelete') || '确定删除？' : '确定删除？'}</span>
                        <button
                          type="button"
                          className="wb-inline-confirm-btn danger"
                          onClick={async () => {
                            await onDeleteWorkbench?.(wb.id, true);
                            setDeletingBoardId(null);
                          }}
                        >
                          {t ? t('common.delete') || '删除' : '删除'}
                        </button>
                        <button
                          type="button"
                          className="wb-inline-confirm-btn cancel"
                          onClick={() => setDeletingBoardId(null)}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={wb.id}
                      className={`workbench-canvas-board-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        onSelectWorkbench?.(wb.id);
                        setShowBoardMenu(false);
                        setIsCreatingInline(false);
                        setEditingBoardId(null);
                        setDeletingBoardId(null);
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
                            onClick={() => {
                              setEditingBoardId(wb.id);
                              setEditingBoardName(wb.name || '');
                              setDeletingBoardId(null);
                            }}
                            title={t ? t('workbench.renameCanvas') || '重命名' : '重命名'}
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            className="workbench-canvas-board-action-btn danger"
                            onClick={() => {
                              setDeletingBoardId(wb.id);
                              setEditingBoardId(null);
                            }}
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
          <span className="wb-status-count-text">
            {t ? t('workbench.countLabel', { count: nodes.length }) : `${nodes.length} 条`}
          </span>
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
          <span className="wb-tool-btn-text">{t ? t('workbench.createStickyNote') || '新建便签' : '新建便签'}</span>
        </button>

        <button
          type="button"
          className="workbench-canvas-tool-btn"
          onClick={handleFitView}
          title={t ? t('workbench.fitView') || '全览居中' : '全览居中'}
        >
          <Maximize2 size={13} />
          <span className="wb-tool-btn-text">{t ? t('workbench.fitView') || '全览' : '全览'}</span>
        </button>

        <button
          type="button"
          className="workbench-canvas-tool-btn"
          onClick={handleAutoArrange}
          title={t ? t('workbench.autoArrange') || '自动整齐排列' : '自动排列'}
        >
          <LayoutGrid size={13} />
          <span className="wb-tool-btn-text">{t ? t('workbench.autoArrange') || '整理' : '整理'}</span>
        </button>

        {edges.length > 0 && (
          <div className="workbench-canvas-clear-edges-wrapper" ref={clearEdgesBtnRef}>
            <button
              type="button"
              className={`workbench-canvas-tool-btn danger-hover ${showClearEdgesConfirm ? 'active' : ''}`}
              onClick={() => setShowClearEdgesConfirm((prev) => !prev)}
              title={t ? t('workbench.clearEdges') || '清空连线' : '清空连线'}
            >
              <Unlink size={13} />
              <span className="wb-tool-btn-text">{t ? t('workbench.clearEdges') || '清除连线' : '清除连线'}</span>
            </button>

            {showClearEdgesConfirm && (
              <div className="workbench-canvas-confirm-popover" onClick={(e) => e.stopPropagation()}>
                <span className="wb-confirm-msg">
                  {t ? t('workbench.clearEdgesConfirm') || '确定清除所有连线？' : '确定清除所有连线？'}
                </span>
                <div className="wb-confirm-actions">
                  <button
                    type="button"
                    className="wb-confirm-btn danger"
                    onClick={handleConfirmClearEdges}
                  >
                    {t ? t('common.clear') || '清除' : '清除'}
                  </button>
                  <button
                    type="button"
                    className="wb-confirm-btn cancel"
                    onClick={() => setShowClearEdgesConfirm(false)}
                  >
                    {t ? t('common.cancel') || '取消' : '取消'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(WorkbenchCanvas);


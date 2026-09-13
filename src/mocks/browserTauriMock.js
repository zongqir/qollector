/**
 * Browser Development Mock Shield for Tauri IPC
 *
 * Automatically activates when running in a pure browser (e.g. `npm run dev` via remote VS Code)
 * without a native Tauri webview. Provides in-memory / localStorage mock data and IPC fallbacks.
 */

if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) {
  console.log('[BrowserMock] Tauri native runtime not detected. Initializing Browser Dev Mock Shield...');

  const STORAGE_KEY_ITEMS = 'qollect.mock.items.v4';
  const STORAGE_KEY_WORKBENCHES = 'qollect.mock.workbenches.v4';

  const defaultMockWorkbenches = [
    { id: 'default', name: '默认工作台', is_default: true, sort_order: 0 },
    { id: 'wb_demo', name: '项目灵感', is_default: false, sort_order: 1 },
  ];

  const defaultMockItems = [
    {
      id: 'mock_note_1',
      type_: 'text',
      content: '💡 欢迎体验 Qollector 灵动便签画布！\n\n- 拖动顶部手柄：自由放置到任意位置\n- 拖动右下角/边缘：自由拉宽、拉长或缩小便签\n- 双击卡片正文：直接就地打字编辑，自动保存\n- 单击卡片：一键直接复制到剪贴板',
      user_note: '',
      is_pinned: true,
      workbench_id: 'default',
      is_favorite: true,
      created_at: Math.floor(Date.now() / 1000) - 3600,
      updated_at: Math.floor(Date.now() / 1000) - 1800,
      metadata: JSON.stringify({ card_background: 'yellow' }),
      tags: JSON.stringify(['便签', '指南']),
    },
    {
      id: 'mock_note_2',
      type_: 'code',
      content: '// 便签画布支持多语言与代码高亮\nfunction calculateLayout(nodes) {\n  return nodes.map((node, i) => ({\n    ...node,\n    x: (i % 3) * 270 + 40,\n    y: Math.floor(i / 3) * 190 + 40\n  }));\n}',
      code_language: 'javascript',
      user_note: '',
      is_pinned: true,
      workbench_id: 'default',
      is_favorite: false,
      created_at: Math.floor(Date.now() / 1000) - 7200,
      updated_at: Math.floor(Date.now() / 1000) - 3600,
      metadata: JSON.stringify({ card_background: 'blue' }),
      tags: JSON.stringify(['代码', 'JS']),
    },
    {
      id: 'mock_note_3',
      type_: 'text',
      content: '📌 空间记忆（Spatial Memory）\n\n人类大脑对 2D 平面位置有极强的天然记忆力。\n你可以把不同类型的便签摆在不同区域，配合调色板标记，一目了然！',
      user_note: '',
      is_pinned: true,
      workbench_id: 'default',
      is_favorite: true,
      created_at: Math.floor(Date.now() / 1000) - 12000,
      updated_at: Math.floor(Date.now() / 1000) - 6000,
      metadata: JSON.stringify({ card_background: 'green' }),
      tags: JSON.stringify(['设计', '效率']),
    },
    {
      id: 'mock_note_4',
      type_: 'text',
      content: '✨ 点击便签右上角的小魔棒\n即可就地执行 AI 排版、中英翻译、要点提取与润色！',
      user_note: '',
      is_pinned: true,
      workbench_id: 'default',
      is_favorite: false,
      created_at: Math.floor(Date.now() / 1000) - 16000,
      updated_at: Math.floor(Date.now() / 1000) - 8000,
      metadata: JSON.stringify({ card_background: 'pink' }),
      tags: JSON.stringify(['AI']),
    },
  ];

  const loadMockItems = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ITEMS);
      if (raw) return JSON.parse(raw);
    } catch {}
    saveMockItems(defaultMockItems);
    return defaultMockItems;
  };

  const saveMockItems = (items) => {
    try {
      localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
    } catch {}
  };

  const loadMockWorkbenches = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_WORKBENCHES);
      if (raw) return JSON.parse(raw);
    } catch {}
    saveMockWorkbenches(defaultMockWorkbenches);
    return defaultMockWorkbenches;
  };

  const saveMockWorkbenches = (wb) => {
    try {
      localStorage.setItem(STORAGE_KEY_WORKBENCHES, JSON.stringify(wb));
    } catch {}
  };

  // Event dispatchers in memory
  const eventListeners = new Map();

  const mockInvoke = async (cmd, args = {}) => {
    const items = loadMockItems();
    const workbenches = loadMockWorkbenches();

    switch (cmd) {
      case 'get_recent_items':
      case 'get_recent_items_light':
        return items;

      case 'get_more_items':
        return [];

      case 'get_workbench_pinned_items': {
        const targetWb = args.workbenchId || 'default';
        return items.filter((i) => i.is_pinned && (i.workbench_id === targetWb || (!i.workbench_id && targetWb === 'default')));
      }

      case 'get_collection_favorite_items':
        return items.filter((i) => i.is_favorite);

      case 'get_workbenches':
        return workbenches;

      case 'create_workbench': {
        const newWb = {
          id: `wb_${Date.now()}`,
          name: args.name || '新工作台',
          is_default: false,
          sort_order: workbenches.length,
        };
        const updated = [...workbenches, newWb];
        saveMockWorkbenches(updated);
        return newWb;
      }

      case 'rename_workbench': {
        const updated = workbenches.map((w) => (w.id === args.id ? { ...w, name: args.name } : w));
        saveMockWorkbenches(updated);
        return true;
      }

      case 'delete_workbench': {
        const updated = workbenches.filter((w) => w.id !== args.id);
        saveMockWorkbenches(updated);
        return true;
      }

      case 'add_clipboard_item_manual':
      case 'add_quick_note': {
        const newItem = {
          id: `item_${Date.now()}`,
          type_: args.contentType || 'text',
          content: args.content || '',
          user_note: '',
          is_pinned: true,
          workbench_id: args.workbenchId || 'default',
          is_favorite: Boolean(args.autoFavorite),
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
          tags: '[]',
        };
        const updated = [newItem, ...items];
        saveMockItems(updated);
        return newItem.id;
      }

      case 'update_item': {
        if (!args.item?.id) return false;
        const updated = items.map((i) => (i.id === args.item.id ? { ...i, ...args.item } : i));
        saveMockItems(updated);
        return true;
      }

      case 'pin_item': {
        const updated = items.map((i) =>
          i.id === args.id ? { ...i, is_pinned: true, workbench_id: args.workbenchId || 'default' } : i
        );
        saveMockItems(updated);
        return true;
      }

      case 'toggle_pin_item': {
        const updated = items.map((i) =>
          i.id === args.id ? { ...i, is_pinned: !i.is_pinned, workbench_id: args.workbenchId || 'default' } : i
        );
        saveMockItems(updated);
        return true;
      }

      case 'toggle_favorite_item': {
        const updated = items.map((i) =>
          i.id === args.id ? { ...i, is_favorite: !i.is_favorite } : i
        );
        saveMockItems(updated);
        return true;
      }

      case 'delete_item': {
        const updated = items.filter((i) => i.id !== args.id);
        saveMockItems(updated);
        return true;
      }

      case 'reorder_workbench_pinned_items':
        return true;

      case 'search_items':
      case 'search_items_with_filters': {
        const q = String(args.query || '').toLowerCase().trim();
        const filters = args.filters || {};
        let filtered = items;

        if (filters.is_pinned != null) {
          filtered = filtered.filter((i) => Boolean(i.is_pinned) === Boolean(filters.is_pinned));
        }
        if (filters.workbench_id) {
          filtered = filtered.filter((i) => (i.workbench_id || 'default') === filters.workbench_id);
        }
        if (q) {
          filtered = filtered.filter((i) => String(i.content || '').toLowerCase().includes(q));
        }
        return filtered;
      }

      case 'get_user_tags':
        return ['便签', '指南', '代码', 'JS', '设计', '效率', 'AI'];

      case 'copy_plain_text':
      case 'copy_item': {
        if (args.text && navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(args.text);
          } catch {}
        }
        return true;
      }

      case 'get_general_config':
      case 'load_general_config':
        return {
          language: 'zh-CN',
          theme: 'dark',
          auto_start: false,
          history_retention_days: 30,
          max_history_items: 2000,
        };

      case 'get_ai_config':
        return {
          enabled: false,
          provider: 'SiliconFlow',
          api_key: '',
          model: 'Qwen/Qwen2.5-7B-Instruct',
        };

      case 'get_license_info':
        return {
          status: 'Active',
          tier: 'Pro',
          expires_at: null,
        };

      case 'plugin:process|relaunch':
        window.location.reload();
        return true;

      default:
        return null;
    }
  };

  // Mock window.__TAURI_INTERNALS__
  window.__TAURI_INTERNALS__ = {
    invoke: mockInvoke,
    convertFileSrc: (path) => path,
    transformCallback: (cb) => cb,
    ipc: () => {},
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' },
    },
  };

  // Mock window.__TAURI_EVENT_PLUGIN_INTERNALS__
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };

  // Mock window.__TAURI__ global object
  window.__TAURI__ = {
    core: {
      invoke: mockInvoke,
      convertFileSrc: (path) => path,
    },
    event: {
      listen: (event, handler) => {
        if (!eventListeners.has(event)) eventListeners.set(event, []);
        eventListeners.get(event).push(handler);
        return () => {
          const list = eventListeners.get(event) || [];
          eventListeners.set(event, list.filter((h) => h !== handler));
        };
      },
      emit: (event, payload) => {
        const list = eventListeners.get(event) || [];
        list.forEach((h) => h({ event, payload }));
      },
    },
    window: {
      getCurrentWindow: () => ({
        label: 'main',
        show: async () => {},
        hide: async () => {},
        close: async () => {},
        setFocus: async () => {},
        setSize: async () => {},
        getSize: async () => ({ width: 800, height: 600 }),
        isMinimized: async () => false,
      }),
    },
  };

  console.log('[BrowserMock] Shield activated successfully! Live mock data ready.');
}

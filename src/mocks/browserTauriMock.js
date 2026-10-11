/**
 * Browser Development Mock Shield for Tauri IPC
 *
 * Automatically activates when running in a pure browser (e.g. `npm run dev` via remote VS Code)
 * without a native Tauri webview. Provides in-memory / localStorage mock data and IPC fallbacks.
 */

if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) {
  console.log('[BrowserMock] Tauri native runtime not detected. Initializing Browser Dev Mock Shield...');

  const STORAGE_KEY_ITEMS = 'qollect.mock.items.v7';
  const STORAGE_KEY_WORKBENCHES = 'qollect.mock.workbenches.v7';

  const defaultMockWorkbenches = [
    { id: 'default', name: '默认工作台', is_default: true, sort_order: 0 },
    { id: 'wb_demo', name: '项目灵感', is_default: false, sort_order: 1 },
  ];

  const defaultMockItems = [
    {
      id: 'mock_note_1',
      type_: 'text',
      content: '💡 欢迎体验 Qollector 灵动便签画布！\n\n- 双击空白处：随时新建便签\n- 拖动右下角角标：自由放大缩小\n- 双击卡片正文：就地打字编辑，自动保存\n- 单击卡片：一键直接复制到剪贴板',
      user_note: '',
      is_pinned: true,
      workbench_id: 'default',
      is_favorite: true,
      created_at: Math.floor(Date.now() / 1000) - 3600,
      updated_at: Math.floor(Date.now() / 1000) - 1800,
      metadata: JSON.stringify({ card_bg: 'sand' }),
      tags: JSON.stringify(['便签', '指南']),
    },
    {
      id: 'mock_note_2',
      type_: 'code',
      content: '// 便签画布支持多语言与代码高亮\nfunction calculateLayout(nodes) {\n  return nodes.map((node, i) => ({\n    ...node,\n    x: (i % 3) * 280 + 40,\n    y: Math.floor(i / 3) * 200 + 40\n  }));\n}',
      code_language: 'javascript',
      user_note: '',
      is_pinned: true,
      workbench_id: 'default',
      is_favorite: false,
      created_at: Math.floor(Date.now() / 1000) - 7200,
      updated_at: Math.floor(Date.now() / 1000) - 3600,
      metadata: JSON.stringify({ card_bg: 'sky' }),
      tags: JSON.stringify(['代码', 'JS']),
    },
    {
      id: 'mock_note_3',
      type_: 'text',
      content: '📌 空间记忆（Spatial Memory）\n\n人类大脑对 2D 平面位置有极强的天然记忆力。\n把不同类型的便签摆在不同区域，配合调色板标记，一目了然！',
      user_note: '',
      is_pinned: true,
      workbench_id: 'default',
      is_favorite: true,
      created_at: Math.floor(Date.now() / 1000) - 12000,
      updated_at: Math.floor(Date.now() / 1000) - 6000,
      metadata: JSON.stringify({ card_bg: 'mint' }),
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
      metadata: JSON.stringify({ card_bg: 'rose' }),
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
        return items.filter((i) => Boolean(i.is_pinned) && ((i.workbench_id || 'default') === targetWb));
      }

      case 'get_collection_favorite_items':
        return items.filter((i) => Boolean(i.is_favorite));

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
          id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
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
        const targetWb = args.workbenchId || 'default';
        const updated = items.map((i) =>
          i.id === args.id ? { ...i, is_pinned: true, workbench_id: targetWb } : i
        );
        saveMockItems(updated);
        return true;
      }

      case 'unpin_item': {
        const updated = items.map((i) =>
          i.id === args.id ? { ...i, is_pinned: false, workbench_id: null } : i
        );
        saveMockItems(updated);
        return true;
      }

      case 'toggle_pin_item': {
        const targetWb = args.workbenchId || 'default';
        const target = items.find((i) => i.id === args.id);
        const nextPinned = target ? !target.is_pinned : true;
        const updated = items.map((i) =>
          i.id === args.id ? { ...i, is_pinned: nextPinned, workbench_id: nextPinned ? targetWb : null } : i
        );
        saveMockItems(updated);
        return nextPinned;
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
          theme_mode: 'system',
          accent_color: 'blue',
          auto_start: false,
          history_retention_days: 30,
          max_history_items: 2000,
          max_pinned_items: 50,
          workbench_panel_enabled: true,
          auto_paste_on_double_click: false,
          copy_on_select_enabled: false,
          copy_on_select_double_click_enabled: true,
          copy_qollect_source_items: true,
          history_tag_shortcut_enabled: true,
          auto_cleanup_enabled: true,
          cleanup_max_items: 2000,
          cleanup_max_age_days: 30,
          startup_favorites_view_enabled: false,
          auto_layout_switch_enabled: true,
        };

      case 'update_general_config':
        return true;

      case 'get_ocr_config':
        return {
          enabled: true,
          language: 'chi_sim+eng',
        };

      case 'has_lock_password':
        return false;

      case 'get_item_by_id':
        return items.find((i) => i.id === args.id) || null;

      case 'detect_and_update_code_language':
        return null;

      case 'get_startup_metrics':
        return {};

      case 'get_share_config':
        return {
          upload_service: 's3',
        };

      case 'open_url':
      case 'open_external_url':
      case 'open_item':
        if (args.url) window.open(args.url, '_blank');
        return true;

      case 'get_ai_config':
        return {
          enabled: false,
          provider: 'SiliconFlow',
          api_key: '',
          model: 'Qwen/Qwen2.5-7B-Instruct',
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

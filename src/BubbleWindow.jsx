import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import {
  Clock,
  ExternalLink,
  Calculator,
  Palette,
  Code2,
  Sparkles,
  Minimize2,
  Languages,
  Copy,
  Calendar,
  Check,
  X,
} from 'lucide-react';

const ICON_MAP = {
  clock: Clock,
  'external-link': ExternalLink,
  calculator: Calculator,
  palette: Palette,
  code: Code2,
  sparkles: Sparkles,
  'minimize-2': Minimize2,
  languages: Languages,
  copy: Copy,
  calendar: Calendar,
};

function BubbleWindow() {
  const [data, setData] = useState(null);
  const [copiedActionId, setCopiedActionId] = useState(null);
  const hideTimerRef = useRef(null);

  const closeBubble = useCallback(async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.hide();
    } catch {
      // window may already be hidden
    }
  }, []);

  const resetHideTimer = useCallback((delay = 4500) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      closeBubble();
    }, delay);
  }, [closeBubble]);

  const handleAction = useCallback(async (action) => {
    try {
      if (action.action_type === 'open_url') {
        await invoke('open_external_url', { url: action.payload });
      } else {
        await invoke('copy_plain_text', { text: action.payload });
      }
      setCopiedActionId(action.id);
      setTimeout(() => {
        closeBubble();
      }, 350);
    } catch (err) {
      console.error('Failed to execute quick action:', err);
    }
  }, [closeBubble]);

  // Sync theme
  useEffect(() => {
    const applyTheme = (theme) => {
      const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    };

    try {
      const savedTheme = localStorage.getItem('theme-mode') || 'system';
      applyTheme(savedTheme);
    } catch {
      applyTheme('system');
    }

    const unlistenTheme = listen('theme-changed', (event) => {
      if (event.payload) {
        applyTheme(event.payload);
      }
    });

    return () => {
      unlistenTheme.then((fn) => fn());
    };
  }, []);

  // Listen for payload
  useEffect(() => {
    const unlistenPayload = listen('quick-action-payload', (event) => {
      if (event.payload) {
        setData(event.payload);
        setCopiedActionId(null);
        resetHideTimer(4500);
      }
    });

    // Handle ESC key
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeBubble();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unlistenPayload.then((fn) => fn());
      window.removeEventListener('keydown', handleKeyDown);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [closeBubble, resetHideTimer]);

  if (!data) {
    return null;
  }

  const { match_type, badge, preview, actions, raw_text } = data;

  const renderBadgeIcon = () => {
    switch (match_type) {
      case 'timestamp':
        return <Clock size={12} />;
      case 'url':
        return <ExternalLink size={12} />;
      case 'math':
        return <Calculator size={12} />;
      case 'color':
        return <span className="color-swatch-dot" style={{ backgroundColor: raw_text }} />;
      case 'json':
        return <Code2 size={12} />;
      case 'base64':
        return <Sparkles size={12} />;
      case 'translation':
        return <Languages size={12} />;
      default:
        return <Sparkles size={12} />;
    }
  };

  return (
    <div
      className="bubble-root"
      onMouseEnter={() => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      }}
      onMouseLeave={() => resetHideTimer(1600)}
    >
      <div className="bubble-container">
        <div className="bubble-badge-group">
          <span className={`bubble-badge badge-${match_type}`}>
            {renderBadgeIcon()}
            <span>{badge}</span>
          </span>
        </div>

        <span className="bubble-preview-text" title={preview}>
          {preview}
        </span>

        <div className="bubble-divider" />

        <div className="bubble-actions-list">
          {actions.map((action) => {
            const IconComponent = ICON_MAP[action.icon] || Copy;
            const isCopied = copiedActionId === action.id;

            return (
              <button
                key={action.id}
                type="button"
                className={`bubble-action-btn ${isCopied ? 'btn-copied' : ''}`}
                onClick={() => handleAction(action)}
                title={action.payload}
              >
                {isCopied ? <Check size={12} /> : <IconComponent size={12} />}
                <span>{isCopied ? '已完成' : action.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="bubble-close-btn"
          onClick={closeBubble}
          title="关闭 (ESC)"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

export default BubbleWindow;

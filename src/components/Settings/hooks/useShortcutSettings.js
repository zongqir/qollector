import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

function useShortcutSettings({
  t,
  activeTab,
  generalConfig,
  setGeneralConfig,
  reloadConfigs,
}) {
  const [shortcutError, setShortcutError] = useState('');
  const [recordingTarget, setRecordingTarget] = useState(null);

  const normalizeShortcutText = (value) => (value || '').trim().toLowerCase();

  const normalizeShortcutToken = (token) => {
    const value = (token || '').trim().toLowerCase();
    if (!value) return '';
    if (value === 'control') return 'ctrl';
    if (value === 'cmd' || value === 'command' || value === 'meta') return 'super';
    if (value === 'option') return 'alt';
    if (value === 'return') return 'enter';
    if (value === 'escape') return 'esc';
    return value;
  };

  const shortcutKey = (shortcut) => {
    const normalized = normalizeShortcutText(shortcut);
    if (!normalized) return '';
    const tokens = normalized
      .split('+')
      .map(normalizeShortcutToken)
      .filter(Boolean);
    if (tokens.length === 0) return '';
    return Array.from(new Set(tokens)).sort().join('+');
  };

  const getShortcutPlatform = () => {
    if (typeof navigator === 'undefined') return 'other';
    const rawPlatform = (
      navigator.userAgentData?.platform
      || navigator.platform
      || navigator.userAgent
      || ''
    ).toLowerCase();
    if (rawPlatform.includes('mac')) return 'macos';
    if (rawPlatform.includes('win')) return 'windows';
    if (rawPlatform.includes('linux')) return 'linux';
    return 'other';
  };

  const getPlatformLabel = (platform) => {
    if (platform === 'macos') return 'macOS';
    if (platform === 'windows') return 'Windows';
    if (platform === 'linux') return 'Linux';
    return 'Current OS';
  };

  const getDefaultSuggestedShortcut = (target) => {
    const platform = getShortcutPlatform();
    if (target === 'copy_pin_shortcut') {
      if (platform === 'macos') return 'super+alt+c';
      return 'ctrl+alt+c';
    }
    if (target === 'toggle_window_shortcut') {
      if (platform === 'macos') return 'super+alt+x';
      return 'ctrl+alt+x';
    }
    if (platform === 'macos') return 'super+alt+x';
    return 'ctrl+alt+x';
  };

  const getTagShortcutDisplay = () => {
    const platform = getShortcutPlatform();
    return platform === 'macos' ? 'super+t' : 'ctrl+t';
  };

  const getReservedShortcutKeys = () => {
    const byPlatform = {
      windows: ['alt+tab', 'alt+f4', 'super+l', 'super+d', 'super+tab', 'ctrl+alt+delete'],
      macos: ['super+q', 'super+tab', 'super+space', 'ctrl+space', 'super+h'],
      linux: ['alt+tab', 'alt+f4', 'super+l'],
      other: ['alt+tab'],
    };
    const platform = getShortcutPlatform();
    const source = byPlatform[platform] || byPlatform.other;
    return new Set(source.map(shortcutKey).filter(Boolean));
  };

  const isReservedShortcut = (shortcut) => {
    const key = shortcutKey(shortcut);
    if (!key) return false;
    return getReservedShortcutKeys().has(key);
  };

  const validateShortcutConfigDraft = (draft) => {
    const toggleShortcut = normalizeShortcutText(draft.toggle_window_shortcut || '');
    const copyShortcut = normalizeShortcutText(draft.copy_pin_shortcut || '');

    if (draft.toggle_window_shortcut_enabled && isReservedShortcut(toggleShortcut)) {
      return t('settings.shortcuts.recordReserved', { shortcut: toggleShortcut });
    }
    if (draft.ctrl_shift_c_shortcut_enabled && isReservedShortcut(copyShortcut)) {
      return t('settings.shortcuts.recordReserved', { shortcut: copyShortcut });
    }

    if (draft.toggle_window_shortcut_enabled && draft.ctrl_shift_c_shortcut_enabled) {
      if (shortcutKey(toggleShortcut) === shortcutKey(copyShortcut)) {
        return t('settings.shortcuts.conflictError');
      }
    }

    return '';
  };

  const saveShortcutConfig = async (updated, target = null) => {
    setGeneralConfig(updated);
    setShortcutError('');
    const shortcutValidationError = validateShortcutConfigDraft(updated);
    if (shortcutValidationError) {
      setShortcutError(shortcutValidationError);
      return false;
    }
    try {
      await invoke('update_general_config', { config: updated });
      return true;
    } catch (error) {
      const message = typeof error === 'string' ? error : String(error);
      const enrichedMessage = message.includes('Failed to register shortcut')
        ? `${message} ${t('settings.shortcuts.occupiedHintOne', {
          platform: getPlatformLabel(getShortcutPlatform()),
          shortcut: getDefaultSuggestedShortcut(target),
        })}`
        : message;
      setShortcutError(enrichedMessage);
      console.error('Failed to save shortcut config:', error);
      if (typeof reloadConfigs === 'function') {
        try {
          await reloadConfigs();
        } catch (reloadError) {
          console.error('Failed to reload configs after shortcut save failure:', reloadError);
        }
      }
      return false;
    }
  };

  const getShortcutPrimaryKey = (event) => {
    const { code, key } = event;

    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code.toLowerCase();

    const specialKeyMap = {
      Space: 'space',
      Enter: 'enter',
      Escape: 'esc',
      Tab: 'tab',
      Backspace: 'backspace',
      Delete: 'delete',
      Insert: 'insert',
      Home: 'home',
      End: 'end',
      PageUp: 'pageup',
      PageDown: 'pagedown',
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Minus: '-',
      Equal: '=',
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      Backquote: '`',
    };
    if (specialKeyMap[code]) return specialKeyMap[code];

    const normalizedKey = (key || '').toLowerCase();
    if (/^[a-z0-9]$/.test(normalizedKey)) return normalizedKey;
    return null;
  };

  const toRecordedShortcut = (event) => {
    const modifierCodes = new Set([
      'ControlLeft',
      'ControlRight',
      'ShiftLeft',
      'ShiftRight',
      'AltLeft',
      'AltRight',
      'MetaLeft',
      'MetaRight',
    ]);

    if (modifierCodes.has(event.code)) {
      return { shortcut: null, error: t('settings.shortcuts.recordNeedPrimary') };
    }

    const primary = getShortcutPrimaryKey(event);
    if (!primary) {
      return { shortcut: null, error: t('settings.shortcuts.recordUnsupported') };
    }

    const modifiers = [];
    if (event.ctrlKey) modifiers.push('ctrl');
    if (event.altKey) modifiers.push('alt');
    if (event.shiftKey) modifiers.push('shift');
    if (event.metaKey) modifiers.push('super');

    if (modifiers.length === 0) {
      return { shortcut: null, error: t('settings.shortcuts.recordNeedModifier') };
    }

    const recorded = `${modifiers.join('+')}+${primary}`;
    if (isReservedShortcut(recorded)) {
      return {
        shortcut: null,
        error: t('settings.shortcuts.recordReserved', { shortcut: recorded }),
      };
    }

    return { shortcut: recorded, error: null };
  };

  const startShortcutRecording = (target) => {
    setShortcutError('');
    setRecordingTarget(target);
  };

  const stopShortcutRecording = () => {
    setRecordingTarget(null);
  };

  const restoreShortcutDefaults = async () => {
    setRecordingTarget(null);
    await saveShortcutConfig({
      ...generalConfig,
      ctrl_shift_c_shortcut_enabled: true,
      copy_pin_shortcut: 'ctrl+shift+c',
      toggle_window_shortcut_enabled: true,
      toggle_window_shortcut: 'alt+x',
      history_tag_shortcut_enabled: true,
    });
  };

  useEffect(() => {
    if (!recordingTarget) return undefined;

    const onRecordKeyDown = async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.repeat) return;
      if (event.key === 'Escape') {
        stopShortcutRecording();
        return;
      }

      const { shortcut, error } = toRecordedShortcut(event);
      if (!shortcut) {
        setShortcutError(error);
        return;
      }

      stopShortcutRecording();

      if (recordingTarget === 'toggle_window_shortcut') {
        await saveShortcutConfig({
          ...generalConfig,
          toggle_window_shortcut: shortcut,
        }, 'toggle_window_shortcut');
        return;
      }

      if (recordingTarget === 'copy_pin_shortcut') {
        await saveShortcutConfig({
          ...generalConfig,
          copy_pin_shortcut: shortcut,
        }, 'copy_pin_shortcut');
      }
    };

    window.addEventListener('keydown', onRecordKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onRecordKeyDown, true);
    };
  }, [generalConfig, recordingTarget, t]);

  useEffect(() => {
    if (activeTab !== 'shortcuts' && recordingTarget) {
      setRecordingTarget(null);
    }
  }, [activeTab, recordingTarget]);

  return {
    normalizeShortcutText,
    shortcutError,
    recordingTarget,
    startShortcutRecording,
    stopShortcutRecording,
    getTagShortcutDisplay,
    restoreShortcutDefaults,
    saveShortcutConfig,
  };
}

export default useShortcutSettings;

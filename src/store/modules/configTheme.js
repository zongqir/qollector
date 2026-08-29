export const createLoadConfigsAction = ({
  set,
  invoke,
  applyAccentColor,
  supportsAutoPasteOnDoubleClick,
  supportsCopyOnSelect,
}) => async (options = {}) => {
  const applyStartupView = options?.applyStartupView === true;
  try {
    const [aiConfig, ocrConfig, generalConfig, hasLock, licenseInfo] = await Promise.all([
      invoke('get_ai_config'),
      invoke('get_ocr_config'),
      invoke('get_general_config'),
      invoke('has_lock_password'),
      invoke('get_license_info'),
    ]);

    const licenseStatus = licenseInfo?.status || 'Free';
    set((state) => ({
      aiEnabled: aiConfig.enabled || false,
      ocrEnabled: ocrConfig.enabled || false,
      licenseStatus,
      isProUser: licenseStatus === 'Active',
      maxPinnedItems: generalConfig.max_pinned_items || 10,
      hasPassword: hasLock,
      isLocked: hasLock ? (state.hasPassword ? state.isLocked : true) : false,
      workbenchPanelEnabled: generalConfig.workbench_panel_enabled !== false,
      lowMemoryModeEnabled: generalConfig.low_memory_mode_enabled || false,
      autoPasteOnDoubleClick: supportsAutoPasteOnDoubleClick
        && (generalConfig.auto_paste_on_double_click || false),
      copyOnSelectEnabled: supportsCopyOnSelect
        && Boolean(generalConfig.copy_on_select_enabled),
      copyOnSelectDoubleClickEnabled: generalConfig.copy_on_select_double_click_enabled !== false,
      quickActionBubbleEnabled: Boolean(generalConfig.quick_action_bubble_enabled),
      copyQollectSourceItems: Boolean(generalConfig.copy_qollect_source_items),
      widgetEnabled: generalConfig.widget_enabled || false,
      historyTagShortcutEnabled: generalConfig.history_tag_shortcut_enabled !== false,
      autoCleanupEnabled: generalConfig.auto_cleanup_enabled !== false,
      cleanupMaxItems: Math.max(100, Number(generalConfig.cleanup_max_items || 50000)),
      cleanupMaxAgeDays: Math.max(1, Number(generalConfig.cleanup_max_age_days || 90)),
      startupFavoritesViewEnabled: Boolean(generalConfig.startup_favorites_view_enabled),
      autoLayoutSwitchEnabled: generalConfig.auto_layout_switch_enabled !== false,
      showFavoritesOnly: (
        applyStartupView
        && !state.showFavoritesOnly
        && !state.showPinnedOnly
        && !state.activeFilterViewId
        && Boolean(generalConfig.startup_favorites_view_enabled)
      ) ? true : state.showFavoritesOnly,
    }));

    if (generalConfig.theme_mode) {
      set({ themeMode: generalConfig.theme_mode });
    }

    applyAccentColor(generalConfig.accent_color || 'blue');
  } catch (error) {
    console.error('加载配置失败:', error);
  }
};

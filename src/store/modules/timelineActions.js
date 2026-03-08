import { invoke } from '@tauri-apps/api/core';

export const createTimelineActions = (set, get) => ({
  loadTimelineData: async (date) => {
    set({ timelineLoading: true, timelineError: null, timelineDate: date });
    try {
      const now = new Date();
      let startTimestamp;
      let endTimestamp;

      if (date === 'today') {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startTimestamp = Math.floor(startOfDay.getTime() / 1000);
        endTimestamp = Math.floor(Date.now() / 1000);
      } else if (date === 'yesterday') {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        const endOfYesterday = new Date(startOfYesterday.getTime() + 24 * 60 * 60 * 1000);
        startTimestamp = Math.floor(startOfYesterday.getTime() / 1000);
        endTimestamp = Math.floor(endOfYesterday.getTime() / 1000);
      }

      const items = await invoke('get_items_by_date_range', {
        startTimestamp,
        endTimestamp,
      });

      set({ timelineItems: items, timelineLoading: false });

      // Auto-generate AI summary if AI is enabled
      const { aiEnabled, timelineSummaryCache } = get();
      if (aiEnabled && items.length > 0) {
        // Check cache
        const cached = timelineSummaryCache[date];
        const currentNow = Date.now();
        const CACHE_DURATION = date === 'yesterday' ? Infinity : 30 * 60 * 1000; // yesterday: forever, today: 30 minutes

        if (cached && (currentNow - cached.timestamp) < CACHE_DURATION) {
          console.log('[Timeline] Using cached summary for', date);
          set({ timelineSummary: cached.summary });
        } else {
          console.log('[Timeline] Cache miss or expired, generating new summary for', date);
          get().generateTimelineSummary(items, date);
        }
      }
    } catch (error) {
      console.error('load timeline data failed:', error);
      set({ timelineError: String(error), timelineLoading: false });
    }
  },

  generateTimelineSummary: async (items, date) => {
    set({ timelineSummary: null });
    try {
      console.log('[Timeline] Generating AI summary for', items.length, 'items');
      const summary = await invoke('generate_timeline_summary', { items });
      console.log('[Timeline] AI summary generated:', summary);

      // Update cache
      const now = Date.now();
      set((state) => ({
        timelineSummary: summary,
        timelineSummaryCache: {
          ...state.timelineSummaryCache,
          [date]: { summary, timestamp: now },
        },
      }));
    } catch (error) {
      console.error('generate timeline summary failed:', error);
      set({ timelineSummary: null });
    }
  },

  switchTimelineDate: (date) => {
    get().loadTimelineData(date);
  },
});

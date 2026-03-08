import { invoke } from '@tauri-apps/api/core';
import { FREE_PROVIDERS } from '../../share/providers';
import { getShareCache, saveShareCache } from './shareCache';

export const createShareActions = (set, get) => ({
  openShareModal: async (item) => {
    set({
      shareModalItem: item,
      shareResult: null,
      shareLoading: true,
      shareError: null,
      sharePendingConfirm: false,
      sharePendingData: null,
      sharePendingProvider: null,
      shareConfig: null,
    });
    try {
      const config = await invoke('get_share_config');

      if (config.provider === 'S3') {
        // S3: user's own storage, upload directly
        const cached = getShareCache(item, 'S3');
        if (cached) {
          const qrCode = await invoke('generate_qr', { text: cached.url });
          set({ shareResult: { method: 'CloudUpload', qr_code: qrCode, url: cached.url }, shareLoading: false });
          return;
        }
        const result = await invoke('share_via_s3', { itemId: item.id });
        if (result.url) await saveShareCache(item, 'S3', result.url, 365 * 24 * 3600);
        set({ shareResult: result, shareLoading: false });
        return;
      }

      // Step 1: get item data (may return LocalQr directly)
      const itemData = await invoke('get_item_share_data', { itemId: item.id });
      if (itemData.method === 'LocalQr') {
        set({ shareResult: itemData, shareLoading: false });
        return;
      }

      // NeedUpload: pause and show confirmation
      const provider = FREE_PROVIDERS[config.provider];
      if (!provider) throw new Error(`Unknown provider: ${config.provider}`);

      // Check cache first
      const cached = getShareCache(item, config.provider);
      if (cached) {
        const qrCode = await invoke('generate_qr', { text: cached.url });
        set({ shareResult: { method: 'CloudUpload', qr_code: qrCode, url: cached.url }, shareLoading: false });
        return;
      }

      // Show confirmation step
      set({
        shareLoading: false,
        sharePendingConfirm: true,
        sharePendingData: itemData,
        sharePendingProvider: config.provider,
        shareConfig: config,
      });
    } catch (error) {
      set({ shareError: String(error), shareLoading: false });
    }
  },

  confirmShareUpload: async (providerName) => {
    const { shareModalItem: item, sharePendingData: itemData } = get();
    if (!item || !itemData) return;

    const provider = FREE_PROVIDERS[providerName];
    if (!provider) {
      set({ shareError: `Unknown provider: ${providerName}`, sharePendingConfirm: false });
      return;
    }

    set({ sharePendingConfirm: false, shareLoading: true, shareError: null, sharePendingProvider: providerName });

    try {
      const resp = await invoke('upload_to_free_host', {
        url: provider.url,
        fileField: provider.fileField,
        fileDataBase64: itemData.data_base64,
        filename: itemData.filename,
        extraFields: provider.extraFields,
      });

      const downloadUrl = provider.parseResponse(resp.status_code, resp.body);
      const qrCode = await invoke('generate_qr', { text: downloadUrl });
      await saveShareCache(item, providerName, downloadUrl, provider.ttlSeconds);

      set({
        shareResult: { method: 'CloudUpload', qr_code: qrCode, url: downloadUrl },
        shareLoading: false,
      });
    } catch (error) {
      // Upload failed: go back to confirmation so user can switch provider
      set({
        shareError: String(error),
        shareLoading: false,
        sharePendingConfirm: true,
      });
    }
  },

  switchShareProvider: (providerName) => {
    set({ sharePendingProvider: providerName, shareError: null });
  },

  closeShareModal: () => {
    set({
      shareModalItem: null,
      shareResult: null,
      shareLoading: false,
      shareError: null,
      sharePendingConfirm: false,
      sharePendingData: null,
      sharePendingProvider: null,
      shareConfig: null,
    });
  },

  retryShare: async () => {
    const { shareModalItem: item, sharePendingData } = get();
    if (!item) return;

    // If we have pending data and a provider, go back to confirmation
    if (sharePendingData) {
      set({ shareResult: null, shareError: null, sharePendingConfirm: true, shareLoading: false });
      return;
    }

    // Otherwise full retry
    set({ shareResult: null, shareLoading: true, shareError: null });
    try {
      const config = await invoke('get_share_config');

      if (config.provider === 'S3') {
        const result = await invoke('share_via_s3', { itemId: item.id });
        if (result.url) await saveShareCache(item, 'S3', result.url, 365 * 24 * 3600);
        set({ shareResult: result, shareLoading: false });
        return;
      }

      const itemData = await invoke('get_item_share_data', { itemId: item.id });
      if (itemData.method === 'LocalQr') {
        set({ shareResult: itemData, shareLoading: false });
        return;
      }

      const provider = FREE_PROVIDERS[config.provider];
      if (!provider) throw new Error(`Unknown provider: ${config.provider}`);

      const cached = getShareCache(item, config.provider);
      if (cached) {
        const qrCode = await invoke('generate_qr', { text: cached.url });
        set({ shareResult: { method: 'CloudUpload', qr_code: qrCode, url: cached.url }, shareLoading: false });
        return;
      }

      set({
        shareLoading: false,
        sharePendingConfirm: true,
        sharePendingData: itemData,
        sharePendingProvider: config.provider,
        shareConfig: config,
      });
    } catch (error) {
      set({ shareError: String(error), shareLoading: false });
    }
  },
});

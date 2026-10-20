import { invoke } from '@tauri-apps/api/core';
import { uploadToRelay } from '../../share/providers';
import { encryptPayload } from '../../share/crypto';
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
      shareConfig: null,
    });
    try {
      const config = await invoke('get_share_config');

      // Check cache first
      const cached = getShareCache(item, 'Relay');
      if (cached) {
        const qrCode = await invoke('generate_qr', { text: cached.url });
        set({
          shareResult: { method: 'CloudUpload', qr_code: qrCode, url: cached.url },
          shareLoading: false,
          shareConfig: config,
        });
        return;
      }

      // Step 1: get item share data (returns LocalQr directly for short text)
      const itemData = await invoke('get_item_share_data', { itemId: item.id });
      if (itemData.method === 'LocalQr') {
        set({ shareResult: itemData, shareLoading: false, shareConfig: config });
        return;
      }

      // NeedUpload: show confirmation for E2EE cloud sharing
      set({
        shareLoading: false,
        sharePendingConfirm: true,
        sharePendingData: itemData,
        shareConfig: config,
      });
    } catch (error) {
      set({ shareError: String(error), shareLoading: false });
    }
  },

  confirmShareUpload: async () => {
    const { shareModalItem: item, sharePendingData: itemData, shareConfig } = get();
    if (!item || !itemData) return;

    set({ sharePendingConfirm: false, shareLoading: true, shareError: null });

    try {
      // 1. Client-side AES-256-GCM encryption
      const encrypted = await encryptPayload({
        text: item.type === 'image' || item.type === 'file' ? null : item.content,
        dataBase64: itemData.data_base64,
        type: item.type,
        filename: itemData.filename,
      });

      // 2. Upload to E2EE Relay
      const { downloadUrl, ttlSeconds } = await uploadToRelay(
        shareConfig?.relay_url,
        encrypted
      );

      // 3. Generate QR code for the complete URL with #KEY
      const qrCode = await invoke('generate_qr', { text: downloadUrl });
      await saveShareCache(item, 'Relay', downloadUrl, ttlSeconds);

      set({
        shareResult: { method: 'CloudUpload', qr_code: qrCode, url: downloadUrl },
        shareLoading: false,
      });
    } catch (error) {
      set({
        shareError: String(error),
        shareLoading: false,
        sharePendingConfirm: true,
      });
    }
  },

  switchShareProvider: () => {},

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

    if (sharePendingData) {
      set({ shareResult: null, shareError: null, sharePendingConfirm: true, shareLoading: false });
      return;
    }

    set({ shareResult: null, shareLoading: true, shareError: null });
    try {
      const config = await invoke('get_share_config');
      const itemData = await invoke('get_item_share_data', { itemId: item.id });
      if (itemData.method === 'LocalQr') {
        set({ shareResult: itemData, shareLoading: false, shareConfig: config });
        return;
      }

      set({
        shareLoading: false,
        sharePendingConfirm: true,
        sharePendingData: itemData,
        shareConfig: config,
      });
    } catch (error) {
      set({ shareError: String(error), shareLoading: false });
    }
  },
});

import { invoke } from '@tauri-apps/api/core';

export const getEmailRelayConfig = async () => {
  return invoke('get_email_relay_config');
};

export const updateEmailRelayConfig = async (config) => {
  return invoke('update_email_relay_config', { config });
};

export const testEmailRelayConnection = async (config, testRecipient) => {
  return invoke('test_email_relay_connection', {
    config,
    testRecipient: testRecipient || null,
  });
};

export const sendClipboardItemViaEmail = async ({ itemId, recipients = [], customSubject = null, bodyNote = null }) => {
  return invoke('send_clipboard_item_via_email', {
    req: {
      item_id: itemId,
      recipients,
      custom_subject: customSubject,
      body_note: bodyNote,
    },
  });
};

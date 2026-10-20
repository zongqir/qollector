/**
 * Qollect Share Relay Client
 * 
 * Uploads client-side encrypted payloads to an ephemeral E2EE sharing relay.
 */

export const DEFAULT_RELAY_URL = 'https://qollect-share.zongqir.com';

/**
 * Upload an encrypted payload to the share relay.
 * 
 * @param {string|null} endpointUrl - Custom relay endpoint or null for default
 * @param {Object} payload - Encrypted payload from crypto.js
 * @returns {Promise<{ downloadUrl: string, ttlSeconds: number }>}
 */
export async function uploadToRelay(endpointUrl, payload) {
  const base = (endpointUrl || DEFAULT_RELAY_URL).trim().replace(/\/+$/, '');
  const url = `${base}/api/share`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      type: payload.type || 'text',
      filename: payload.filename || null,
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Relay upload failed (${resp.status}): ${errorText.slice(0, 200)}`);
  }

  const json = await resp.json();
  if (!json.url) {
    throw new Error('Invalid response from relay: missing url');
  }

  return {
    downloadUrl: `${json.url}#${payload.keyB64}`,
    ttlSeconds: json.ttl_seconds || 600,
  };
}

// Backward compatibility stub for existing references
export const FREE_PROVIDERS = {
  Relay: {
    ttlSeconds: 600,
  },
};

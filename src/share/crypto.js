/**
 * Qollect E2EE Crypto Helper
 * 
 * Uses browser-native Web Crypto API (AES-256-GCM) with zero external dependencies.
 * Encryption happens purely in local memory; keys reside only in URL hash.
 */

export function bytesToBase64Url(bytes) {
  let bin = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64ToBytes(base64Str) {
  const normalized = base64Str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(normalized);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt a text or base64 file buffer with a freshly generated AES-256-GCM key.
 * 
 * @param {Object} options
 * @param {string} [options.text] - Plain text content
 * @param {string} [options.dataBase64] - Raw binary data in base64
 * @param {string} [options.type] - "text" | "image" | "file"
 * @param {string} [options.filename] - Original filename
 * @returns {Promise<{ ciphertext: string, iv: string, keyB64: string, type: string, filename: string|null }>}
 */
export async function encryptPayload({ text, dataBase64, type = 'text', filename = null }) {
  let rawBytes;
  if (dataBase64) {
    rawBytes = base64ToBytes(dataBase64);
  } else if (text !== undefined && text !== null) {
    rawBytes = new TextEncoder().encode(text);
  } else {
    throw new Error('No content provided for encryption');
  }

  // Generate 256-bit AES-GCM key
  const cryptoKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  // 12-byte random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    rawBytes
  );

  // Export raw key to base64url
  const rawKey = await window.crypto.subtle.exportKey('raw', cryptoKey);
  const keyB64 = bytesToBase64Url(new Uint8Array(rawKey));

  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertextBuffer)),
    iv: bytesToBase64Url(iv),
    keyB64,
    type,
    filename,
  };
}

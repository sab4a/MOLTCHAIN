/**
 * Crypto utilities for wallet operations
 */

import * as ed from '@noble/ed25519';

// Polyfill for ed25519
if (typeof window !== 'undefined' && window.crypto) {
  ed.etc.sha512Sync = undefined; // Use async
}

/**
 * Generate a new ed25519 keypair
 */
export async function generateKeypair() {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  
  return {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey),
  };
}

/**
 * Sign a message with ed25519
 */
export async function signMessage(privateKeyHex, message) {
  const privateKey = hexToBytes(privateKeyHex);
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const signature = await ed.signAsync(msgBytes, privateKey);
  return bytesToHex(signature);
}

/**
 * Verify an ed25519 signature
 */
export async function verifySignature(publicKeyHex, message, signatureHex) {
  const publicKey = hexToBytes(publicKeyHex);
  const signature = hexToBytes(signatureHex);
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  return await ed.verifyAsync(signature, msgBytes, publicKey);
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Hash data with SHA-256
 */
export async function sha256(data) {
  const msgBuffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return bytesToHex(new Uint8Array(hashBuffer));
}

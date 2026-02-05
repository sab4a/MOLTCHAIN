/**
 * Cryptographic utilities for SmithNode Agent
 * Uses ed25519 for signing
 */

import * as ed from '@noble/ed25519';
import crypto from 'crypto';
import fs from 'fs';

// Use webcrypto for ed25519
ed.etc.sha512Sync = (...m) => {
  const hash = crypto.createHash('sha512');
  m.forEach(msg => hash.update(msg));
  return hash.digest();
};

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
 * Load keypair from file
 */
export function loadKeypair(filepath) {
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  return {
    privateKey: data.privateKey || data.private_key,
    publicKey: data.publicKey || data.public_key,
  };
}

/**
 * Sign a message with ed25519
 */
export async function signMessage(privateKeyHex, message) {
  const privateKey = hexToBytes(privateKeyHex);
  const signature = await ed.signAsync(message, privateKey);
  return signature;
}

/**
 * Verify an ed25519 signature
 */
export async function verifySignature(publicKeyHex, message, signatureHex) {
  const publicKey = hexToBytes(publicKeyHex);
  const signature = hexToBytes(signatureHex);
  return await ed.verifyAsync(signature, message, publicKey);
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
export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

#!/usr/bin/env node
/**
 * SmithNode Admin Upgrade Broadcaster
 * 
 * This tool allows trusted admins to broadcast signed upgrade announcements
 * to the P2P network. Only messages signed by keys in TRUSTED_ADMIN_KEYS
 * will be accepted by nodes.
 * 
 * Usage:
 *   node admin-upgrade.js --version 0.6.0 --mandatory --notes "Security fix"
 */

import { signMessage, bytesToHex, hexToBytes } from './crypto.js';
import fs from 'fs';

const RPC_URL = process.env.RPC_URL || 'https://smithnode-rpc.fly.dev';

/**
 * Sign and broadcast an upgrade announcement
 */
async function broadcastUpgrade(options) {
  const {
    version,
    mandatory = false,
    releaseNotes = null,
    darwinArm64Url = null,
    darwinX64Url = null,
    linuxX64Url = null,
    linuxArm64Url = null,
    windowsX64Url = null,
    darwinArm64Checksum = null,
    darwinX64Checksum = null,
    linuxX64Checksum = null,
    linuxArm64Checksum = null,
    windowsX64Checksum = null,
  } = options;
  
  // Load admin keypair
  const keyPath = process.env.ADMIN_KEY_PATH || './admin-key.json';
  if (!fs.existsSync(keyPath)) {
    console.error(`❌ Admin key not found at ${keyPath}`);
    console.log('Create one with: node -e "const {generateKeyPair} = await import(\'./crypto.js\'); const kp = generateKeyPair(); console.log(JSON.stringify({privateKey: kp.privateKey, publicKey: kp.publicKey}))" > admin-key.json');
    process.exit(1);
  }
  
  const adminKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const timestamp = Math.floor(Date.now() / 1000);
  
  // Build message to sign: version || timestamp || mandatory || checksums
  const messageBuffer = Buffer.concat([
    Buffer.from(version),
    Buffer.alloc(8).fill(0),  // Will be overwritten
    Buffer.from([mandatory ? 1 : 0]),
    darwinArm64Checksum ? Buffer.from(darwinArm64Checksum) : Buffer.alloc(0),
    darwinX64Checksum ? Buffer.from(darwinX64Checksum) : Buffer.alloc(0),
    linuxX64Checksum ? Buffer.from(linuxX64Checksum) : Buffer.alloc(0),
    linuxArm64Checksum ? Buffer.from(linuxArm64Checksum) : Buffer.alloc(0),
    windowsX64Checksum ? Buffer.from(windowsX64Checksum) : Buffer.alloc(0),
  ]);
  
  // Write timestamp at correct position
  messageBuffer.writeBigUInt64LE(BigInt(timestamp), version.length);
  
  // Sign the message
  const signature = await signMessage(adminKey.privateKey, messageBuffer);
  
  // Build the upgrade announcement
  const announcement = {
    version,
    download_urls: {
      darwin_arm64: darwinArm64Url,
      darwin_x64: darwinX64Url,
      linux_x64: linuxX64Url,
      linux_arm64: linuxArm64Url,
      windows_x64: windowsX64Url,
    },
    checksums: {
      darwin_arm64: darwinArm64Checksum,
      darwin_x64: darwinX64Checksum,
      linux_x64: linuxX64Checksum,
      linux_arm64: linuxArm64Checksum,
      windows_x64: windowsX64Checksum,
    },
    timestamp,
    mandatory,
    release_notes: releaseNotes,
    admin_pubkey: adminKey.publicKey,
    signature: bytesToHex(signature),
  };
  
  console.log('\n📦 Upgrade Announcement:');
  console.log(JSON.stringify(announcement, null, 2));
  console.log('\n🔐 Admin Public Key:', adminKey.publicKey);
  console.log('\n⚠️  IMPORTANT: Add this public key to TRUSTED_ADMIN_KEYS in p2p/mod.rs');
  console.log('    Then rebuild and deploy the node.');
  console.log('\n📡 To broadcast, POST this to the P2P network via an admin endpoint');
  console.log('   (Broadcasting requires adding an admin RPC method or direct P2P access)');
  
  return announcement;
}

// Parse CLI args
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--version':
    case '-v':
      options.version = args[++i];
      break;
    case '--mandatory':
    case '-m':
      options.mandatory = true;
      break;
    case '--notes':
    case '-n':
      options.releaseNotes = args[++i];
      break;
    case '--darwin-arm64':
      options.darwinArm64Url = args[++i];
      break;
    case '--darwin-x64':
      options.darwinX64Url = args[++i];
      break;
    case '--linux-x64':
      options.linuxX64Url = args[++i];
      break;
    case '--linux-arm64':
      options.linuxArm64Url = args[++i];
      break;
    case '--windows-x64':
      options.windowsX64Url = args[++i];
      break;
    case '--help':
    case '-h':
      console.log(`
SmithNode Admin Upgrade Broadcaster

Usage:
  node admin-upgrade.js --version <version> [options]

Options:
  --version, -v      Version number (required, e.g., 0.6.0)
  --mandatory, -m    Mark as mandatory upgrade
  --notes, -n        Release notes
  --darwin-arm64     Download URL for macOS ARM64
  --darwin-x64       Download URL for macOS x64
  --linux-x64        Download URL for Linux x64
  --linux-arm64      Download URL for Linux ARM64
  --windows-x64      Download URL for Windows x64
  --help, -h         Show this help

Environment:
  ADMIN_KEY_PATH     Path to admin keypair JSON (default: ./admin-key.json)
  RPC_URL            RPC endpoint URL

Example:
  node admin-upgrade.js --version 0.6.0 --mandatory --notes "Security fix" \\
    --linux-x64 "https://github.com/sab4a/MOLTCHAIN/releases/download/v0.6.0/smithnode-linux-x64"
`);
      process.exit(0);
  }
}

if (!options.version) {
  console.error('❌ --version is required');
  process.exit(1);
}

broadcastUpgrade(options).catch(console.error);

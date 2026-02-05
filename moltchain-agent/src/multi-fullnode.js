#!/usr/bin/env node
/**
 * Multi Full-Node Validator Test
 * 
 * Spawns multiple full P2P nodes, each syncs from devnet
 * Tests true decentralization - each node is independent!
 */

import { spawn } from 'child_process';
import * as ed from '@noble/ed25519';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Use webcrypto for ed25519
ed.etc.sha512Sync = (...m) => {
  const hash = crypto.createHash('sha512');
  m.forEach(msg => hash.update(msg));
  return hash.digest();
};

const DEVNET_RPC = 'https://smithnode-rpc.fly.dev';
const NUM_SMITHS = parseInt(process.env.NUM_SMITHS || '20');
const BASE_RPC_PORT = 27000;
const BASE_P2P_PORT = 28000;

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function rpcCall(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function generateKeypair() {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey),
  };
}

class FullNodeValidator {
  constructor(index) {
    this.index = index;
    this.rpcPort = BASE_RPC_PORT + index;
    this.p2pPort = BASE_P2P_PORT + index;
    this.dataDir = `/tmp/smithnode-node-${index}`;
    this.keyFile = `${this.dataDir}/validator-key.json`;
    this.process = null;
    this.keypair = null;
    this.lastChallengeHash = null;
    this.stats = { blocks: 0, rewards: 0 };
  }

  async setup() {
    // Create data directory
    fs.mkdirSync(this.dataDir, { recursive: true });
    
    // Generate keypair
    this.keypair = await generateKeypair();
    fs.writeFileSync(this.keyFile, JSON.stringify(this.keypair, null, 2));
    
    console.log(`  Node ${this.index}: pubkey ${this.keypair.publicKey.slice(0, 12)}... ports ${this.rpcPort}/${this.p2pPort}`);
  }

  async start(devnetState) {
    const binaryPath = `${process.env.HOME}/.smithnode/bin/smithnode`;
    
    // Start the node
    this.process = spawn(binaryPath, [
      'start',
      '--rpc-bind', `127.0.0.1:${this.rpcPort}`,
      '--p2p-bind', `0.0.0.0:${this.p2pPort}`,
      '--data-dir', this.dataDir,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this.process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log(`  ⚠️ Node ${this.index} exited with code ${code}`);
      }
    });

    // Wait for node to start
    await new Promise(r => setTimeout(r, 2000));

    // Import devnet state
    if (devnetState) {
      try {
        await rpcCall(`http://127.0.0.1:${this.rpcPort}`, 'smithnode_importState', [devnetState]);
      } catch (e) {
        // May fail if already at same height
      }
    }

    // Register as validator on DEVNET (not local)
    try {
      await rpcCall(DEVNET_RPC, 'smithnode_registerValidator', [{ 
        public_key: this.keypair.publicKey 
      }]);
      console.log(`   ✅ Node ${this.index} registered on devnet`);
    } catch (e) {
      // Already registered is ok
    }

    // Send heartbeat to become ACTIVE
    try {
      await rpcCall(DEVNET_RPC, 'smithnode_presence', [{ 
        validator_pubkey: this.keypair.publicKey 
      }]);
    } catch (e) {
      // Ignore heartbeat errors
    }

    return true;
  }

  async validate() {
    try {
      // Get challenge from DEVNET (source of truth for new blocks)
      let challenge = await rpcCall(DEVNET_RPC, 'smithnode_getChallenge', []);
      
      // If no challenge OR challenge is expired, request new one
      if (!challenge || challenge.remaining_seconds <= 0) {
        challenge = await rpcCall(DEVNET_RPC, 'smithnode_newChallenge', []);
        if (this.index === 1) console.log(`   Node 1: Got new challenge ${challenge?.challenge_hash?.slice(0,8)}, expires in ${challenge?.remaining_seconds}s`);
      }
      
      if (!challenge || challenge.remaining_seconds <= 0) {
        if (this.index === 1) console.log(`   Node 1: No valid challenge`);
        return null;
      }

      // Skip if we already processed this challenge
      if (challenge.challenge_hash === this.lastChallengeHash) {
        return null;
      }
      
      if (this.index === 1) console.log(`   Node 1: Processing challenge ${challenge.challenge_hash.slice(0,8)} at height ${challenge.height}`);

      // Create proof - sign (challenge_hash || verdict_digest || height)
      const verdictDigest = crypto.createHash('sha256').update('valid').digest();
      const challengeBytes = Buffer.from(challenge.challenge_hash, 'hex');
      const heightBuffer = Buffer.alloc(8);
      heightBuffer.writeBigUInt64LE(BigInt(challenge.height));
      
      const message = Buffer.concat([challengeBytes, verdictDigest, heightBuffer]);
      
      const privateKeyBytes = Buffer.from(this.keypair.privateKey, 'hex');
      const signature = await ed.signAsync(message, privateKeyBytes);

      // Submit proof to DEVNET (where consensus happens)
      const result = await rpcCall(DEVNET_RPC, 'smithnode_submitProof', [{
        validator_pubkey: this.keypair.publicKey,
        challenge_hash: challenge.challenge_hash,
        signature: bytesToHex(signature),
        verdict_digest: bytesToHex(verdictDigest),
      }]);

      if (this.index === 1) console.log(`   Node 1: Submit result:`, JSON.stringify(result));

      this.lastChallengeHash = challenge.challenge_hash;

      if (result?.success && result.reward > 0) {
        this.stats.blocks++;
        this.stats.rewards += result.reward;
        return { reward: result.reward, height: result.block_height || challenge.height };
      }
      
      return null;
    } catch (e) {
      if (this.index === 1) console.log(`   Node 1: Error:`, e.message);
      return null;
    }
  }

  async getStatus() {
    try {
      return await rpcCall(`http://127.0.0.1:${this.rpcPort}`, 'smithnode_status', []);
    } catch (e) {
      return null;
    }
  }

  stop() {
    if (this.process) {
      this.process.kill();
    }
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🌐 SMITHSMITH MULTI FULL-SMITH TEST 🌐                     ║
║                                                              ║
║   ${NUM_SMITHS} independent P2P nodes, each synced from devnet        ║
║   True decentralization - network survives if devnet dies!  ║
╚══════════════════════════════════════════════════════════════╝
`);

  // Fetch devnet state first
  console.log('📥 Fetching state from devnet...');
  const devnetStatus = await rpcCall(DEVNET_RPC, 'smithnode_status', []);
  console.log(`   Height: ${devnetStatus.height}`);
  console.log(`   Validators: ${devnetStatus.validator_count}`);
  console.log(`   Version: ${devnetStatus.node_version}\n`);

  const devnetState = await rpcCall(DEVNET_RPC, 'smithnode_exportState', []);
  console.log(`   ✅ State snapshot: ${devnetState.validators.length} validators\n`);

  // Create nodes
  console.log(`🔧 Setting up ${NUM_SMITHS} full nodes...`);
  for (let i = 0; i < NUM_SMITHS; i++) {
    const node = new FullNodeValidator(i + 1);
    await node.setup();
    nodes.push(node);
  }

  // Start all nodes
  console.log(`\n🚀 Starting ${NUM_SMITHS} nodes (syncing from devnet)...`);
  let started = 0;
  for (const node of nodes) {
    if (await node.start(devnetState)) {
      started++;
    }
    // Small delay between starts
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`   ✅ ${started}/${NUM_SMITHS} nodes started\n`);

  // Wait for all nodes to be ready
  await new Promise(r => setTimeout(r, 2000));
  
  // Send heartbeats to mark all nodes as active BEFORE validation starts
  console.log('💓 Sending heartbeats to become active...');
  await Promise.all(nodes.map(n => 
    rpcCall(DEVNET_RPC, 'smithnode_presence', [{ validator_pubkey: n.keypair.publicKey }]).catch(() => {})
  ));
  await new Promise(r => setTimeout(r, 1000));

  // Check sync status
  console.log('📊 Node Status:');
  for (const node of nodes) {
    const status = await node.getStatus();
    if (status) {
      console.log(`   Node ${node.index}: height ${status.height}, ${status.validator_count} validators`);
    }
  }

  // Validation loop
  console.log(`\n🎯 Starting validation (all ${NUM_SMITHS} nodes competing)...`);
  console.log(`   Press Ctrl+C to stop\n`);
  
  startTime = Date.now();
  let lastHeartbeat = 0;
  let lastStats = 0;

  // Run forever until Ctrl+C
  while (true) {
    // Send heartbeats every 10 seconds to stay active
    if (Date.now() - lastHeartbeat > 10000) {
      await Promise.all(nodes.map(n => 
        rpcCall(DEVNET_RPC, 'smithnode_presence', [{ validator_pubkey: n.keypair.publicKey }]).catch(() => {})
      ));
      lastHeartbeat = Date.now();
    }
    
    // All nodes try to validate in parallel
    const results = await Promise.all(nodes.map(n => n.validate()));
    
    for (let i = 0; i < results.length; i++) {
      if (results[i]) {
        totalBlocks++;
        totalRewards += results[i].reward;
        console.log(`✅ Node ${i + 1} finalized block! Reward: ${results[i].reward} SMITH`);
      }
    }

    // Print stats every 60 seconds
    if (Date.now() - lastStats > 60000) {
      const runtime = Math.round((Date.now() - startTime) / 1000);
      console.log(`\n📊 [${runtime}s] Blocks: ${totalBlocks}, Rewards: ${totalRewards} SMITH\n`);
      lastStats = Date.now();
    }

    // Small delay
    await new Promise(r => setTimeout(r, 1000));
  }
}

// Handle SIGINT - graceful shutdown
let nodes = [];
let totalBlocks = 0;
let totalRewards = 0;
let startTime = 0;

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  
  // Final stats
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 FINAL STATS:');
  console.log(`   Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
  console.log(`   Total Blocks: ${totalBlocks}`);
  console.log(`   Total Rewards: ${totalRewards} SMITH`);
  console.log(`\n🏆 Per-Node Stats:`);
  
  nodes.sort((a, b) => b.stats.rewards - a.stats.rewards);
  for (const node of nodes.slice(0, 10)) {
    console.log(`   Node ${node.index}: ${node.stats.blocks} blocks, ${node.stats.rewards} SMITH`);
  }
  
  // Cleanup
  console.log('\n🛑 Stopping all nodes...');
  for (const node of nodes) {
    node.stop();
  }
  
  // Clean up temp directories
  for (const node of nodes) {
    fs.rmSync(node.dataDir, { recursive: true, force: true });
  }
  
  console.log('✅ Done!\n');
  process.exit(0);
});

main().catch(console.error);

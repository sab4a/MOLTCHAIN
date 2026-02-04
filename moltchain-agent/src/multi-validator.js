#!/usr/bin/env node
/**
 * Multi-Validator Test Script
 * 
 * Spawns multiple AI validators to test committee consensus
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

const RPC_URL = process.env.MOLTCHAIN_RPC || 'https://moltchain-rpc.fly.dev';
const NUM_VALIDATORS = parseInt(process.env.NUM_VALIDATORS || '20');
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '3000');

// Helper functions
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

async function rpcCall(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    }),
  });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

class Validator {
  constructor(index) {
    this.index = index;
    this.privateKey = null;
    this.publicKey = null;
    this.balance = 0;
    this.validations = 0;
    this.isRegistered = false;
  }

  async generateKeys() {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    this.privateKey = bytesToHex(privateKey);
    this.publicKey = bytesToHex(publicKey);
    console.log(`  Validator ${this.index}: ${this.publicKey.slice(0, 16)}...`);
  }

  async register() {
    try {
      const result = await rpcCall('moltchain_registerValidator', [{ public_key: this.publicKey }]);
      if (result.success) {
        this.isRegistered = true;
        this.balance = 100; // Initial balance
        console.log(`  ✅ Validator ${this.index} registered`);
        return true;
      } else {
        if (result.error?.includes('already registered')) {
          this.isRegistered = true;
          return true;
        }
        console.log(`  ❌ Validator ${this.index} failed: ${result.error}`);
        return false;
      }
    } catch (e) {
      console.log(`  ❌ Validator ${this.index} error: ${e.message}`);
      return false;
    }
  }

  async submitProof(challenge) {
    try {
      // Create verdict digest (hash of "valid" for simplicity)
      const verdictDigest = sha256(Buffer.from('valid'));
      
      // Sign challenge_hash || verdict_digest
      const challengeHashBytes = hexToBytes(challenge.challenge_hash);
      const message = Buffer.concat([Buffer.from(challengeHashBytes), verdictDigest]);
      
      const privateKeyBytes = hexToBytes(this.privateKey);
      const signature = await ed.signAsync(message, privateKeyBytes);
      
      const result = await rpcCall('moltchain_submitProof', [{
        validator_pubkey: this.publicKey,
        challenge_hash: challenge.challenge_hash,
        signature: bytesToHex(signature),
        verdict_digest: bytesToHex(verdictDigest),
      }]);
      
      if (result.success) {
        this.validations++;
        if (result.reward > 0) {
          this.balance = result.new_balance;
          return { success: true, reward: result.reward, finalized: true };
        }
        return { success: true, reward: 0, finalized: false };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async refreshBalance() {
    try {
      const info = await rpcCall('moltchain_getValidator', [this.publicKey]);
      if (info) {
        this.balance = info.balance;
        this.validations = info.validations_count;
      }
    } catch (e) {}
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       🤖 MOLTCHAIN MULTI-VALIDATOR TEST 🤖                   ║
║                                                              ║
║   Testing ${NUM_VALIDATORS} validators with committee consensus           ║
╚══════════════════════════════════════════════════════════════╝
`);

  console.log(`📡 RPC: ${RPC_URL}\n`);

  // Check initial status
  const initialStatus = await rpcCall('moltchain_status');
  console.log(`📊 Initial Status:`);
  console.log(`   Height: ${initialStatus.height}`);
  console.log(`   Validators: ${initialStatus.validator_count}`);
  console.log(`   Supply: ${initialStatus.total_supply} MOLT\n`);

  // Generate validators
  console.log(`🔑 Generating ${NUM_VALIDATORS} validator keypairs...`);
  const validators = [];
  for (let i = 0; i < NUM_VALIDATORS; i++) {
    const v = new Validator(i + 1);
    await v.generateKeys();
    validators.push(v);
  }

  // Register all validators
  console.log(`\n📝 Registering validators...`);
  let registered = 0;
  for (const v of validators) {
    if (await v.register()) registered++;
    // Small delay to avoid overwhelming the RPC
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`   ${registered}/${NUM_VALIDATORS} registered successfully\n`);

  // Save keys for future use
  const keysFile = './multi-validator-keys.json';
  fs.writeFileSync(keysFile, JSON.stringify(
    validators.map(v => ({ privateKey: v.privateKey, publicKey: v.publicKey })),
    null, 2
  ));
  console.log(`💾 Keys saved to ${keysFile}\n`);

  // Check status after registration
  const afterRegStatus = await rpcCall('moltchain_status');
  console.log(`📊 After Registration:`);
  console.log(`   Validators: ${afterRegStatus.validator_count}`);
  console.log(`   Supply: ${afterRegStatus.total_supply} MOLT\n`);

  // Start validation loop
  console.log(`🚀 Starting validation loop (Ctrl+C to stop)...\n`);
  console.log(`   Committee size: 5 validators per block`);
  console.log(`   Threshold: 2/3 must approve (4 of 5)`);
  console.log(`   All ${NUM_VALIDATORS} validators will compete for committee slots!\n`);

  let blocksProduced = 0;
  let totalRewards = 0;

  while (true) {
    try {
      // Generate new challenge
      const challenge = await rpcCall('moltchain_newChallenge');
      console.log(`\n🎯 Challenge for block ${challenge.height + 1}: ${challenge.challenge_hash.slice(0, 16)}...`);
      
      // Get committee info
      const committee = await rpcCall('moltchain_getCommittee');
      if (committee) {
        console.log(`👥 Committee: ${committee.members.length} members, threshold: ${committee.threshold}`);
        const committeeKeys = committee.members.map(m => m.pubkey.slice(0, 8));
        console.log(`   Members: ${committeeKeys.join(', ')}...`);
      }

      // All validators try to submit proofs
      let approvals = 0;
      let rejected = 0;
      let blockFinalized = false;
      
      // Shuffle validators for fairness
      const shuffled = [...validators].sort(() => Math.random() - 0.5);
      
      for (const v of shuffled) {
        const result = await v.submitProof(challenge);
        if (result.success) {
          approvals++;
          if (result.finalized) {
            blockFinalized = true;
            totalRewards += result.reward;
            console.log(`   ✅ Validator ${v.index} FINALIZED block! Reward: ${result.reward} MOLT`);
          } else if (result.reward === 0) {
            console.log(`   ⏳ Validator ${v.index} approved (waiting for threshold)`);
          }
        } else {
          if (result.error?.includes('not in committee')) {
            // Expected - not selected for this block
          } else if (result.error?.includes('already submitted')) {
            // Already voted
          } else {
            rejected++;
            console.log(`   ❌ Validator ${v.index}: ${result.error}`);
          }
        }
        
        // Stop if block finalized
        if (blockFinalized) break;
        
        // Small delay between submissions
        await new Promise(r => setTimeout(r, 50));
      }

      if (blockFinalized) {
        blocksProduced++;
        
        // Get updated status
        const status = await rpcCall('moltchain_status');
        console.log(`\n📦 Block ${status.height} finalized!`);
        console.log(`   Total Supply: ${status.total_supply} MOLT`);
        console.log(`   Active Validators: ${status.active_validator_count}`);
        console.log(`   Blocks Produced: ${blocksProduced}`);
        
        // Show top 5 validators by balance
        const allValidators = await rpcCall('moltchain_getValidators');
        const sorted = allValidators.sort((a, b) => b.balance - a.balance).slice(0, 5);
        console.log(`\n🏆 Top 5 Validators:`);
        sorted.forEach((v, i) => {
          console.log(`   ${i+1}. ${v.public_key.slice(0, 12)}... - ${v.balance} MOLT (${v.validations_count} validations)`);
        });
      }

    } catch (e) {
      console.error(`❌ Error: ${e.message}`);
    }

    // Wait before next block
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch(console.error);

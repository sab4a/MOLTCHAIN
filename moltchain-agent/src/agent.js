/**
 * SmithNode Agent - Core Validator Logic
 * 
 * Handles:
 * - Polling for new challenges
 * - Solving cognitive challenges
 * - Signing and submitting proofs
 */

import { signMessage, bytesToHex, hexToBytes } from './crypto.js';
import crypto from 'crypto';

export class SmithNodeAgent {
  constructor({ rpcUrl, privateKey, publicKey, pollingInterval = 5000 }) {
    this.rpcUrl = rpcUrl;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.pollingInterval = pollingInterval;
    this.isRunning = false;
    this.lastChallengeHash = null;
    this.lastPresenceTime = 0; // Track last heartbeat
    this.PRESENCE_INTERVAL = 30000; // Send heartbeat every 30 seconds
    this.stats = {
      challengesSolved: 0,
      totalRewards: 0,
      errors: 0,
      balance: 0,
    };
  }

  async start() {
    this.isRunning = true;
    console.log(`\n🦀 Agent started!`);
    console.log(`   RPC: ${this.rpcUrl}`);
    console.log(`   Polling every ${this.pollingInterval}ms`);
    console.log(`   💓 Heartbeat every ${this.PRESENCE_INTERVAL / 1000}s`);
    console.log(`   Press Ctrl+C to stop\n`);

    // Register if not already registered
    await this.ensureRegistered();

    // Start polling loop
    while (this.isRunning) {
      try {
        await this.pollAndValidate();
      } catch (error) {
        console.error('❌ Error in validation loop:', error.message);
        this.stats.errors++;
      }
      await this.sleep(this.pollingInterval);
    }
  }

  stop() {
    this.isRunning = false;
    console.log('\n🛑 Agent stopped');
    console.log(`   Challenges solved: ${this.stats.challengesSolved}`);
    console.log(`   Total rewards: ${this.stats.totalRewards} SNT`);
    console.log(`   Errors: ${this.stats.errors}`);
  }

  async ensureRegistered() {
    const validator = await this.rpc('smithnode_getValidator', [this.publicKey]);
    if (!validator) {
      console.log('📝 Registering as validator...');
      const result = await this.rpc('smithnode_registerValidator', [
        { public_key: this.publicKey },
      ]);
      if (result?.success) {
        console.log('✅ Registered successfully!');
      } else {
        console.log('⚠️ Registration response:', result);
      }
    } else {
      console.log(`✅ Already registered. Balance: ${validator.balance} SNT`);
    }
  }

  /**
   * Send presence heartbeat to announce we're online
   * This is broadcast over P2P gossipsub so other nodes know we're active
   * SIGNED to prevent impersonation attacks
   */
  async sendHeartbeat() {
    const now = Date.now();
    if (now - this.lastPresenceTime < this.PRESENCE_INTERVAL) {
      return; // Not time yet
    }
    
    try {
      // Get current height for the presence message
      const status = await this.rpc('smithnode_status', []);
      const height = status?.height || 0;
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Sign presence message: pubkey || height || timestamp
      const pubkeyBytes = hexToBytes(this.publicKey);
      const heightBuffer = Buffer.alloc(8);
      heightBuffer.writeBigUInt64LE(BigInt(height));
      const timestampBuffer = Buffer.alloc(8);
      timestampBuffer.writeBigUInt64LE(BigInt(timestamp));
      
      const message = Buffer.concat([Buffer.from(pubkeyBytes), heightBuffer, timestampBuffer]);
      const signature = await signMessage(this.privateKey, message);
      
      const result = await this.rpc('smithnode_presence', [{ 
        validator_pubkey: this.publicKey,
        signature: bytesToHex(signature),
      }]);
      
      if (result?.success) {
        this.lastPresenceTime = now;
        // Only log occasionally to avoid spam
        if (this.stats.challengesSolved % 5 === 0) {
          console.log(`💓 Heartbeat sent (${result.active_validators} active validators)`);
        }
      }
    } catch (e) {
      // Heartbeat failure is not critical
    }
  }

  async pollAndValidate() {
    // Send heartbeat if needed
    await this.sendHeartbeat();
    
    // Get current status for block height
    const status = await this.rpc('smithnode_status', []);
    if (status) {
      console.log(`\n📦 Block Height: ${status.height} | Validators: ${status.active_validator_count}/${status.validator_count} | Supply: ${status.total_supply} SNT`);
    }
    
    // Get current challenge
    let challenge = await this.rpc('smithnode_getChallenge', []);
    
    // If no challenge OR expired, request new one
    if (!challenge || challenge.remaining_seconds <= 0) {
      console.log('🔄 No active challenge, requesting new one...');
      challenge = await this.rpc('smithnode_newChallenge', []);
      if (!challenge || challenge.remaining_seconds <= 0) {
        console.log('⏳ No valid challenge available...');
        return;
      }
      console.log(`🎯 New challenge created: ${challenge.challenge_hash.slice(0, 16)}...`);
    }

    // Skip if we already solved this challenge
    if (challenge.challenge_hash === this.lastChallengeHash) {
      console.log('⏳ Waiting for new challenge...');
      return;
    }

    // Skip challenges with less than 3 seconds remaining (not enough time to solve)
    if (challenge.remaining_seconds < 3) {
      console.log(`⏳ Challenge expiring too soon (${challenge.remaining_seconds}s), waiting for next...`);
      this.lastChallengeHash = challenge.challenge_hash; // Don't retry this one
      return;
    }

    console.log(`\n🎯 Challenge found!`);
    console.log(`   Hash: ${challenge.challenge_hash.slice(0, 16)}...`);
    console.log(`   Type: ${challenge.challenge_type}`);
    console.log(`   Height: ${challenge.height}`);
    console.log(`   Expires in: ${challenge.remaining_seconds}s`);

    await this.solveChallenge(challenge);
  }

  async solveChallenge(challenge) {
    const startTime = Date.now();
    
    // 1. Perform cognitive validation (simulated AI analysis)
    console.log('🧠 Performing cognitive validation...');
    const verdictDigest = await this.performCognitiveAnalysis(challenge);
    
    // 2. Sign the proof (includes height to prevent replay attacks)
    console.log('✍️ Signing proof...');
    const signature = await this.signProof(challenge.challenge_hash, verdictDigest, challenge.height);
    
    // 3. Submit the proof
    console.log('📤 Submitting proof...');
    const result = await this.rpc('smithnode_submitProof', [{
      validator_pubkey: this.publicKey,
      challenge_hash: challenge.challenge_hash,
      signature: signature,
      verdict_digest: verdictDigest,
    }]);
    
    const elapsed = Date.now() - startTime;
    
    if (result?.success) {
      this.stats.challengesSolved++;
      this.stats.totalRewards += result.reward || 0;
      this.stats.balance = result.new_balance || 0;
      this.lastChallengeHash = challenge.challenge_hash;
      
      // Check if block was finalized
      if (result.block_height) {
        console.log(`\n🎉 BLOCK ${result.block_height} FINALIZED!`);
        console.log(`   Reward: +${result.reward} SNT`);
        console.log(`   Your Balance: ${result.new_balance} SNT`);
        console.log(`   State Root: ${result.state_root?.slice(0, 16)}...`);
      } else {
        console.log(`\n🎉 Proof accepted!`);
        console.log(`   Reward: +${result.reward} SNT`);
        console.log(`   New Balance: ${result.new_balance} SNT`);
      }
      console.log(`   Time: ${elapsed}ms`);
    } else {
      console.log(`❌ Proof rejected: ${result?.error || 'Unknown error'}`);
      // Mark as processed so we don't retry this challenge
      this.lastChallengeHash = challenge.challenge_hash;
    }
  }

  /**
   * Perform cognitive analysis on the challenge
   * This is where an AI agent would actually analyze transactions
   * For now, we simulate with a deterministic computation
   */
  async performCognitiveAnalysis(challenge) {
    // Simulate AI thinking time
    await this.sleep(100 + Math.random() * 200);
    
    // In a real implementation, this would:
    // 1. Fetch pending transactions from the node
    // 2. Use an AI model to analyze each transaction for:
    //    - Double-spend attempts
    //    - Invalid signatures
    //    - Anomalous patterns
    //    - Malicious contract calls
    // 3. Build a Merkle tree of flagged transactions
    // 4. Return the Merkle root as the verdict digest
    
    // For now, create a deterministic verdict based on challenge
    const hasher = crypto.createHash('sha256');
    hasher.update(Buffer.from(challenge.challenge_hash, 'hex'));
    hasher.update('verdict');
    hasher.update(this.publicKey);
    
    return hasher.digest('hex');
  }

  /**
   * Sign the proof (challenge_hash || verdict_digest || height)
   * Height is included to prevent replay attacks across different blocks
   */
  async signProof(challengeHashHex, verdictDigestHex, height) {
    // Concatenate challenge_hash, verdict_digest, and height (8 bytes LE)
    const heightBuffer = Buffer.alloc(8);
    heightBuffer.writeBigUInt64LE(BigInt(height));
    
    const message = Buffer.concat([
      Buffer.from(challengeHashHex, 'hex'),
      Buffer.from(verdictDigestHex, 'hex'),
      heightBuffer,
    ]);
    
    // Sign with ed25519
    const signature = await signMessage(this.privateKey, message);
    return bytesToHex(signature);
  }

  async rpc(method, params = []) {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params,
        }),
      });
      
      const json = await response.json();
      if (json.error) {
        throw new Error(json.error.message || JSON.stringify(json.error));
      }
      return json.result;
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to SmithNode. Is it running?');
      }
      throw error;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

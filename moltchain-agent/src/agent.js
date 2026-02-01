/**
 * Moltchain Agent - Core Validator Logic
 * 
 * Handles:
 * - Polling for new challenges
 * - Solving cognitive challenges
 * - Signing and submitting proofs
 */

import { signMessage, bytesToHex, hexToBytes } from './crypto.js';
import crypto from 'crypto';

export class MoltchainAgent {
  constructor({ rpcUrl, privateKey, publicKey, pollingInterval = 5000 }) {
    this.rpcUrl = rpcUrl;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.pollingInterval = pollingInterval;
    this.isRunning = false;
    this.lastChallengeHash = null;
    this.stats = {
      challengesSolved: 0,
      totalRewards: 0,
      errors: 0,
    };
  }

  async start() {
    this.isRunning = true;
    console.log(`\n🚀 Agent started!`);
    console.log(`   RPC: ${this.rpcUrl}`);
    console.log(`   Polling every ${this.pollingInterval}ms`);
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
    console.log(`   Total rewards: ${this.stats.totalRewards} MOLT`);
    console.log(`   Errors: ${this.stats.errors}`);
  }

  async ensureRegistered() {
    const validator = await this.rpc('moltchain_getValidator', [this.publicKey]);
    if (!validator) {
      console.log('📝 Registering as validator...');
      const result = await this.rpc('moltchain_registerValidator', [
        { public_key: this.publicKey },
      ]);
      if (result?.success) {
        console.log('✅ Registered successfully!');
      } else {
        console.log('⚠️ Registration response:', result);
      }
    } else {
      console.log(`✅ Already registered. Balance: ${validator.balance} MOLT`);
    }
  }

  async pollAndValidate() {
    // Get current challenge
    const challenge = await this.rpc('moltchain_getChallenge', []);
    
    if (!challenge) {
      // No active challenge, try to trigger a new one
      console.log('🔄 No active challenge, requesting new one...');
      const newChallenge = await this.rpc('moltchain_newChallenge', []);
      if (newChallenge) {
        console.log(`🎯 New challenge created: ${newChallenge.challenge_hash.slice(0, 16)}...`);
        await this.solveChallenge(newChallenge);
      }
      return;
    }

    // Skip if we already solved this challenge
    if (challenge.challenge_hash === this.lastChallengeHash) {
      console.log('⏳ Waiting for new challenge...');
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
    
    // 2. Sign the proof
    console.log('✍️ Signing proof...');
    const signature = await this.signProof(challenge.challenge_hash, verdictDigest);
    
    // 3. Submit the proof
    console.log('📤 Submitting proof...');
    const result = await this.rpc('moltchain_submitProof', [{
      validator_pubkey: this.publicKey,
      challenge_hash: challenge.challenge_hash,
      signature: signature,
      verdict_digest: verdictDigest,
    }]);
    
    const elapsed = Date.now() - startTime;
    
    if (result?.success) {
      this.stats.challengesSolved++;
      this.stats.totalRewards += result.reward || 0;
      this.lastChallengeHash = challenge.challenge_hash;
      
      console.log(`\n🎉 Proof accepted!`);
      console.log(`   Reward: +${result.reward} MOLT`);
      console.log(`   New Balance: ${result.new_balance} MOLT`);
      console.log(`   Time: ${elapsed}ms`);
    } else {
      console.log(`❌ Proof rejected: ${result?.error || 'Unknown error'}`);
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
   * Sign the proof (challenge_hash || verdict_digest)
   */
  async signProof(challengeHashHex, verdictDigestHex) {
    // Concatenate challenge_hash and verdict_digest
    const message = Buffer.concat([
      Buffer.from(challengeHashHex, 'hex'),
      Buffer.from(verdictDigestHex, 'hex'),
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
        throw new Error('Cannot connect to Moltchain node. Is it running?');
      }
      throw error;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

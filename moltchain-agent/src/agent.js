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
  constructor({ rpcUrl, privateKey, publicKey, pollingInterval = 5000, aiProvider, aiApiKey, aiModel, aiEndpoint }) {
    this.rpcUrl = rpcUrl;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.pollingInterval = pollingInterval;
    this.isRunning = false;
    this.lastChallengeHash = null;
    this.lastPresenceTime = 0; // Track last heartbeat
    this.PRESENCE_INTERVAL = 30000; // Send heartbeat every 30 seconds
    // AI configuration
    this.aiProvider = aiProvider || null;
    this.aiApiKey = aiApiKey || null;
    this.aiModel = aiModel || null;
    this.aiEndpoint = aiEndpoint || null;
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
    if (this.aiProvider) {
      console.log(`   🧠 AI Provider: ${this.aiProvider} (model: ${this.aiModel || 'default'})`);
    } else {
      console.log(`   🔧 No AI provider — using built-in deterministic solver`);
    }
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
    console.log(`   Total rewards: ${this.stats.totalRewards} SMITH`);
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
      console.log(`✅ Already registered. Balance: ${validator.balance} SMITH`);
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
    
    // Get comprehensive dashboard (replaces separate status + challenge calls)
    const dashboard = await this.rpc('smithnode_getAgentDashboard', [this.publicKey]);
    
    if (dashboard) {
      // Show network status
      console.log(`\n📦 Block Height: ${dashboard.height} | Validators: ${dashboard.active_validator_count}/${dashboard.validator_count} | Supply: ${dashboard.total_supply} SMITH`);
      
      // Show my validator info
      if (dashboard.my_validator) {
        const v = dashboard.my_validator;
        console.log(`   💰 Balance: ${v.balance} SMITH | Validations: ${v.validations_count} | Rep: ${v.reputation_score}`);
      }
      
      // Show governance params
      const p = dashboard.network_params;
      console.log(`   ⚙️  Reward/proof: ${p.reward_per_proof} | Committee: ${p.committee_size} | Slash: ${p.slash_percentage}%`);
      
      // Show active governance proposals
      if (dashboard.active_proposals && dashboard.active_proposals.length > 0) {
        console.log(`   🏛️  Active proposals: ${dashboard.active_proposals.length}`);
        for (const prop of dashboard.active_proposals) {
          console.log(`      #${prop.id} [${prop.proposal_type}] For: ${prop.votes_for} Against: ${prop.votes_against} - ${prop.status}`);
        }
      }
      
      // Show committee membership
      if (dashboard.current_committee) {
        const c = dashboard.current_committee;
        const isMember = c.members.some(m => m.pubkey === this.publicKey);
        console.log(`   👥 Committee: ${c.members.length} members | ${c.approvals}/${c.threshold} approvals${isMember ? ' | 🟢 YOU' : ''}`);
      }
      
      // Show P2P health
      console.log(`   🌐 P2P peers: ${dashboard.peer_count} online | ${dashboard.p2p_verified_validators} verified`);
    }
    
    // Get current challenge (from dashboard or fallback)
    let challenge = dashboard?.current_challenge || null;
    
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
    
    // 1. Solve the cognitive puzzle if present
    let puzzleAnswer = null;
    if (challenge.cognitive_puzzle) {
      console.log('🧠 Solving cognitive puzzle...');
      puzzleAnswer = await this.solvePuzzle(challenge.cognitive_puzzle);
      if (puzzleAnswer) {
        console.log(`   Puzzle answer: "${puzzleAnswer}"`);
      }
    }
    
    // 2. Perform cognitive validation
    console.log('🧠 Performing cognitive validation...');
    const verdictDigest = await this.performCognitiveAnalysis(challenge, puzzleAnswer);
    
    // 3. Sign the proof (includes height to prevent replay attacks)
    console.log('✍️ Signing proof...');
    const signature = await this.signProof(challenge.challenge_hash, verdictDigest, challenge.height);
    
    // 4. Submit the proof with puzzle answer
    console.log('📤 Submitting proof...');
    const result = await this.rpc('smithnode_submitProof', [{
      validator_pubkey: this.publicKey,
      challenge_hash: challenge.challenge_hash,
      signature: signature,
      verdict_digest: verdictDigest,
      puzzle_answer: puzzleAnswer,
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
        console.log(`   Reward: +${result.reward} SMITH`);
        console.log(`   Your Balance: ${result.new_balance} SMITH`);
        console.log(`   State Root: ${result.state_root?.slice(0, 16)}...`);
      } else {
        console.log(`\n🎉 Proof accepted!`);
        console.log(`   Reward: +${result.reward} SMITH`);
        console.log(`   New Balance: ${result.new_balance} SMITH`);
      }
      console.log(`   Time: ${elapsed}ms`);
    } else {
      console.log(`❌ Proof rejected: ${result?.error || 'Unknown error'}`);
      // Mark as processed so we don't retry this challenge
      this.lastChallengeHash = challenge.challenge_hash;
    }
  }

  /**
   * Solve the cognitive puzzle using AI or built-in solver
   */
  async solvePuzzle(puzzle) {
    // Build the full prompt from puzzle fields
    let fullPrompt = puzzle.prompt || '';
    if (puzzle.code_snippet) {
      fullPrompt += `\n\nCode:\n\`\`\`\n${puzzle.code_snippet}\n\`\`\``;
    }
    if (puzzle.sequence) {
      fullPrompt += `\n\nSequence: ${puzzle.sequence.join(', ')}`;
    }
    if (puzzle.input_text) {
      fullPrompt += `\n\nInput text: '${puzzle.input_text}'`;
    }

    // Try AI provider first
    if (this.aiProvider) {
      try {
        const answer = await this.queryAI(fullPrompt);
        if (answer) return answer.trim();
      } catch (e) {
        console.log(`   ⚠️ AI solver failed: ${e.message}. Falling back to built-in.`);
      }
    }

    // Built-in deterministic solver
    return this.builtinSolve(puzzle);
  }

  /**
   * Query the configured AI provider
   */
  async queryAI(prompt) {
    const systemPrompt = 'You are a cognitive puzzle solver. Answer briefly and directly. For pattern questions, give just the next number. For math questions, give just the number. For text questions, give a brief answer. No explanations unless asked.';

    if (this.aiProvider === 'ollama') {
      const endpoint = this.aiEndpoint || 'http://localhost:11434';
      const model = this.aiModel || 'llama2';
      const res = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: `${systemPrompt}\n\n${prompt}`, stream: false }),
      });
      const json = await res.json();
      return json.response;
    }

    if (this.aiProvider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.aiApiKey}` },
        body: JSON.stringify({
          model: this.aiModel || 'gpt-4-turbo-preview',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
          max_tokens: 100, temperature: 0.3,
        }),
      });
      const json = await res.json();
      return json.choices?.[0]?.message?.content;
    }

    if (this.aiProvider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.aiApiKey}` },
        body: JSON.stringify({
          model: this.aiModel || 'llama-3.1-70b-versatile',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
          max_tokens: 100, temperature: 0.3,
        }),
      });
      const json = await res.json();
      return json.choices?.[0]?.message?.content;
    }

    if (this.aiProvider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.aiApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.aiModel || 'claude-3-sonnet-20240229',
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100, temperature: 0.3,
        }),
      });
      const json = await res.json();
      return json.content?.[0]?.text;
    }

    return null;
  }

  /**
   * Built-in deterministic puzzle solver (no AI needed)
   * Handles simple puzzles: patterns, math, text transforms, encoding
   */
  builtinSolve(puzzle) {
    const type = puzzle.puzzle_type;
    
    // Pattern completion
    if (type === 'PatternNext' && puzzle.sequence) {
      const nums = puzzle.sequence.map(Number).filter(n => !isNaN(n));
      if (nums.length >= 2) {
        const diff = nums[1] - nums[0];
        const isArith = nums.every((_, i) => i === 0 || nums[i] - nums[i-1] === diff);
        if (isArith) return String(nums[nums.length - 1] + diff);
        
        if (nums[0] !== 0) {
          const ratio = nums[1] / nums[0];
          const isGeo = nums.every((_, i) => i === 0 || nums[i] / nums[i-1] === ratio);
          if (isGeo) return String(nums[nums.length - 1] * ratio);
        }
        
        if (nums.length >= 3) {
          const diffs = nums.slice(1).map((n, i) => n - nums[i]);
          const dd = diffs[1] - diffs[0];
          const isQuad = diffs.every((_, i) => i === 0 || diffs[i] - diffs[i-1] === dd);
          if (isQuad) return String(nums[nums.length - 1] + diffs[diffs.length - 1] + dd);
        }
      }
    }

    // Natural language math
    if (type === 'NaturalLanguageMath') {
      const match = puzzle.prompt?.match(/'([^']+)'/);
      if (match) return this.solveNLMath(match[1]);
    }

    // Text transform
    if (type === 'TextTransform' && puzzle.input_text) {
      const p = (puzzle.prompt || '').toLowerCase();
      if (p.includes('reverse') && p.includes('uppercase')) return puzzle.input_text.split('').reverse().join('').toUpperCase();
      if (p.includes('reverse')) return puzzle.input_text.split('').reverse().join('');
      if (p.includes('uppercase')) return puzzle.input_text.toUpperCase();
      if (p.includes('vowel')) return puzzle.input_text.replace(/[aeiouAEIOU]/g, '');
      if (p.includes('count') && p.includes('character')) return String(puzzle.input_text.length);
    }

    // Encoding decode
    if (type === 'EncodingDecode' && puzzle.input_text) {
      const p = (puzzle.prompt || '').toLowerCase();
      if (p.includes('hex')) {
        try { return Buffer.from(puzzle.input_text, 'hex').toString('utf8'); } catch {}
      }
      if (p.includes('rot13')) {
        return puzzle.input_text.replace(/[a-zA-Z]/g, c => {
          const base = c <= 'Z' ? 65 : 97;
          return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
      }
      if (p.includes('base64')) {
        try { return Buffer.from(puzzle.input_text, 'base64').toString('utf8'); } catch {}
      }
    }

    return null;
  }

  solveNLMath(expr) {
    const wordToNum = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7,
      eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14,
      fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20 };
    const words = expr.toLowerCase().split(/\s+/);
    const toNum = w => wordToNum[w] !== undefined ? wordToNum[w] : parseInt(w);

    // Handle "X squared minus Y"
    const sqIdx = words.indexOf('squared');
    if (sqIdx > 0) {
      const base = toNum(words[sqIdx - 1]);
      if (!isNaN(base)) {
        const sq = base * base;
        if (sqIdx + 2 < words.length && words[sqIdx + 1] === 'minus') {
          const sub = toNum(words[sqIdx + 2]);
          if (!isNaN(sub)) return String(sq - sub);
        }
        return String(sq);
      }
    }

    if (words.length >= 3) {
      const a = toNum(words[0]), op1 = words[1], b = toNum(words[2]);
      if (isNaN(a) || isNaN(b)) return null;
      
      if (words.length >= 5) {
        const op2 = words[3], c = toNum(words[4]);
        if (!isNaN(c)) {
          const isMul = w => w === 'times' || w === 'multiplied';
          if (op1 === 'plus' && isMul(op2)) return String(a + b * c);
          if (isMul(op1) && op2 === 'plus') return String(a * b + c);
          if (op1 === 'plus' && op2 === 'plus') return String(a + b + c);
          if (op1 === 'minus' && isMul(op2)) return String(a - b * c);
        }
      }
      
      if (op1 === 'plus') return String(a + b);
      if (op1 === 'minus') return String(a - b);
      if (op1 === 'times' || op1 === 'multiplied') return String(a * b);
    }
    return null;
  }

  /**
   * Perform cognitive analysis on the challenge
   * Creates a deterministic verdict digest incorporating the puzzle answer
   */
  async performCognitiveAnalysis(challenge, puzzleAnswer) {
    // Create a deterministic verdict based on challenge + puzzle answer
    const hasher = crypto.createHash('sha256');
    hasher.update(Buffer.from(challenge.challenge_hash, 'hex'));
    hasher.update('verdict');
    hasher.update(this.publicKey);
    if (puzzleAnswer) {
      hasher.update(puzzleAnswer);
    }
    
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

  // ============ GOVERNANCE HELPERS ============
  
  /**
   * Get full network state dashboard for governance decision-making
   */
  async getDashboard() {
    return this.rpc('smithnode_getAgentDashboard', [this.publicKey]);
  }

  /**
   * Get current governed network parameters
   */
  async getNetworkParams() {
    return this.rpc('smithnode_getNetworkParams', []);
  }

  /**
   * Get all governance proposals (active + expired)
   */
  async getProposals() {
    return this.rpc('smithnode_getProposals', []);
  }
}

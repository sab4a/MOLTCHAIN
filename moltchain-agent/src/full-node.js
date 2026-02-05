#!/usr/bin/env node
/**
 * SmithNode Full Node Agent
 * 
 * Each agent runs a FULL SNT - no central server required!
 * Nodes discover each other via bootstrap peers and sync state.
 * 
 * TRUE P2P: If one node goes down, network continues.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as ed from '@noble/ed25519';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Enable sync operations for ed25519
ed.etc.sha512Sync = (...m) => {
  const hash = crypto.createHash('sha512');
  m.forEach(msg => hash.update(msg));
  return hash.digest();
};

// Bootstrap nodes - these help new nodes find the network
const BOOTSTRAP_SNTS = [
  '/dns4/smithnode-rpc.fly.dev/tcp/9000',  // Fly.io bootstrap
  // Add more bootstrap nodes as network grows
];

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

class FullNodeAgent {
  constructor(options = {}) {
    this.dataDir = options.dataDir || './data';
    this.p2pPort = options.p2pPort || 9000;
    this.rpcPort = options.rpcPort || 3000;
    this.keyFile = options.keyFile;
    this.nodeBinary = this.findNodeBinary();
    this.nodeProcess = null;
    this.privateKey = null;
    this.publicKey = null;
  }

  findNodeBinary() {
    // Look for smithnode-node binary
    const possiblePaths = [
      path.join(__dirname, '../../smithnode-node/target/release/smithnode'),
      path.join(__dirname, '../../smithnode-node/target/debug/smithnode'),
      '/usr/local/bin/smithnode',
      'smithnode',
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return possiblePaths[0]; // Default to release path
  }

  async generateOrLoadKeys() {
    if (this.keyFile && fs.existsSync(this.keyFile)) {
      const data = JSON.parse(fs.readFileSync(this.keyFile, 'utf8'));
      this.privateKey = data.privateKey;
      this.publicKey = data.publicKey;
      console.log(`🔑 Loaded keys from ${this.keyFile}`);
    } else {
      const privateKey = ed.utils.randomPrivateKey();
      const publicKey = await ed.getPublicKeyAsync(privateKey);
      this.privateKey = bytesToHex(privateKey);
      this.publicKey = bytesToHex(publicKey);
      
      // Save keys
      const keyPath = this.keyFile || path.join(this.dataDir, 'validator-key.json');
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, JSON.stringify({
        privateKey: this.privateKey,
        publicKey: this.publicKey,
      }, null, 2));
      console.log(`🔑 Generated new keys, saved to ${keyPath}`);
    }
    console.log(`📍 Validator pubkey: ${this.publicKey.slice(0, 16)}...`);
  }

  async startNode() {
    console.log(`\n🚀 Starting SmithNode full node...`);
    console.log(`   Binary: ${this.nodeBinary}`);
    console.log(`   P2P Port: ${this.p2pPort}`);
    console.log(`   RPC Port: ${this.rpcPort}`);
    console.log(`   Data Dir: ${this.dataDir}`);

    // Build command args
    const args = [
      '--p2p-port', this.p2pPort.toString(),
      '--rpc-port', this.rpcPort.toString(),
      '--data-dir', this.dataDir,
    ];

    // Add bootstrap peers
    for (const peer of BOOTSTRAP_SNTS) {
      args.push('--peer', peer);
    }

    // Spawn node process
    this.nodeProcess = spawn(this.nodeBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.nodeProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        console.log(`[SNT] ${line}`);
      }
    });

    this.nodeProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        console.log(`[SNT ERR] ${line}`);
      }
    });

    this.nodeProcess.on('close', (code) => {
      console.log(`⚠️ Node process exited with code ${code}`);
      if (this.shouldRestart) {
        console.log(`🔄 Restarting in 5 seconds...`);
        setTimeout(() => this.startNode(), 5000);
      }
    });

    // Wait for node to start
    await new Promise(r => setTimeout(r, 3000));
  }

  async rpcCall(method, params = []) {
    const response = await fetch(`http://127.0.0.1:${this.rpcPort}`, {
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

  async registerAsValidator() {
    try {
      const result = await this.rpcCall('smithnode_registerValidator', [{ 
        public_key: this.publicKey 
      }]);
      if (result.success) {
        console.log(`✅ Registered as validator!`);
        return true;
      }
      console.log(`⚠️ Registration: ${result.error || 'failed'}`);
      return result.error?.includes('already registered');
    } catch (e) {
      console.error(`❌ Registration error: ${e.message}`);
      return false;
    }
  }

  async runValidationLoop() {
    console.log(`\n🤖 Starting validation loop...\n`);
    
    while (true) {
      try {
        // Get current challenge
        const challenge = await this.rpcCall('smithnode_newChallenge');
        
        // Create and submit proof
        const verdictDigest = crypto.createHash('sha256').update('valid').digest();
        const challengeBytes = Buffer.from(challenge.challenge_hash, 'hex');
        const message = Buffer.concat([challengeBytes, verdictDigest]);
        
        const privateKeyBytes = Buffer.from(this.privateKey, 'hex');
        const signature = await ed.signAsync(message, privateKeyBytes);
        
        const result = await this.rpcCall('smithnode_submitProof', [{
          validator_pubkey: this.publicKey,
          challenge_hash: challenge.challenge_hash,
          signature: bytesToHex(signature),
          verdict_digest: bytesToHex(verdictDigest),
        }]);
        
        if (result.success && result.reward > 0) {
          console.log(`🎉 Block finalized! Reward: ${result.reward} SNT`);
        }
        
      } catch (e) {
        // Errors are expected when not in committee
      }
      
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  async start() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🌐 SMITHSNT FULL SNT AGENT 🌐                          ║
║                                                              ║
║   TRUE P2P: Each agent IS a full node!                       ║
║   No central server - network survives if any node dies      ║
╚══════════════════════════════════════════════════════════════╝
`);

    await this.generateOrLoadKeys();
    await this.startNode();
    await this.registerAsValidator();
    await this.runValidationLoop();
  }

  stop() {
    this.shouldRestart = false;
    if (this.nodeProcess) {
      this.nodeProcess.kill();
    }
  }
}

// CLI
const args = process.argv.slice(2);
const options = {
  dataDir: args.find((_, i) => args[i-1] === '--data-dir') || './data',
  p2pPort: parseInt(args.find((_, i) => args[i-1] === '--p2p-port') || '9000'),
  rpcPort: parseInt(args.find((_, i) => args[i-1] === '--rpc-port') || '3000'),
  keyFile: args.find((_, i) => args[i-1] === '--keyfile'),
};

const agent = new FullNodeAgent(options);

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  agent.stop();
  process.exit(0);
});

agent.start().catch(console.error);

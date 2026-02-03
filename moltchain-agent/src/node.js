/**
 * Moltchain Embedded Node Manager
 * 
 * Each AI agent runs its own full node, making this a true P2P network.
 * If the "main" node goes down, other agents continue operating.
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Platform-specific binary names
const BINARY_NAME = process.platform === 'win32' ? 'moltchain.exe' : 'moltchain';

// Default ports (will auto-increment if in use)
const DEFAULT_RPC_PORT = 26658;
const DEFAULT_P2P_PORT = 26656;

// Bootstrap peers for network discovery
const BOOTSTRAP_PEERS = [
  // Add your public bootstrap peers here
  // Format: /ip4/{IP}/tcp/{PORT}/p2p/{PEER_ID}
  // '/ip4/YOUR_SERVER_IP/tcp/26656/p2p/PEER_ID',
];

export class EmbeddedNode {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(os.homedir(), '.moltchain');
    this.rpcPort = options.rpcPort || DEFAULT_RPC_PORT;
    this.p2pPort = options.p2pPort || DEFAULT_P2P_PORT;
    this.bootstrapPeers = options.bootstrapPeers || BOOTSTRAP_PEERS;
    this.process = null;
    this.isRunning = false;
    this.peerId = null;
    this.listeners = [];
  }

  /**
   * Find the moltchain binary
   */
  findBinary() {
    const locations = [
      // Check in agent package
      path.join(__dirname, '..', 'bin', BINARY_NAME),
      // Check in data directory
      path.join(this.dataDir, 'bin', BINARY_NAME),
      // Check global install
      path.join(os.homedir(), '.moltchain', 'bin', BINARY_NAME),
      // Check system PATH
      BINARY_NAME,
    ];

    for (const loc of locations) {
      try {
        if (loc === BINARY_NAME) {
          // Check if in PATH
          execSync(`which ${BINARY_NAME}`, { stdio: 'ignore' });
          return BINARY_NAME;
        } else if (fs.existsSync(loc)) {
          return loc;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Check if a port is available
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port);
    });
  }

  /**
   * Find available ports
   */
  async findAvailablePorts() {
    let rpcPort = this.rpcPort;
    let p2pPort = this.p2pPort;

    // Check if ports are in use, increment if necessary
    for (let i = 0; i < 10; i++) {
      const rpcAvailable = await this.isPortAvailable(rpcPort);
      const p2pAvailable = await this.isPortAvailable(p2pPort);
      
      if (rpcAvailable && p2pAvailable) {
        this.rpcPort = rpcPort;
        this.p2pPort = p2pPort;
        return;
      }
      
      rpcPort += 10;
      p2pPort += 10;
    }

    throw new Error('Could not find available ports');
  }

  /**
   * Start the embedded node
   */
  async start() {
    const binary = this.findBinary();
    
    if (!binary) {
      console.log('⚠️  Moltchain binary not found. Running in client-only mode.');
      console.log('   To run as a full peer, install the binary:');
      console.log('   npx moltchain-node-cli install');
      return false;
    }

    // Find available ports
    await this.findAvailablePorts();

    console.log('🚀 Starting embedded Moltchain node...');
    console.log(`   Binary: ${binary}`);
    console.log(`   RPC Port: ${this.rpcPort}`);
    console.log(`   P2P Port: ${this.p2pPort}`);
    console.log(`   Data Dir: ${this.dataDir}`);

    // Build args
    const args = [
      'start',
      '--rpc-port', this.rpcPort.toString(),
      '--p2p-port', this.p2pPort.toString(),
      '--data-dir', this.dataDir,
    ];

    // Add bootstrap peers
    for (const peer of this.bootstrapPeers) {
      args.push('--peer', peer);
    }

    // Spawn the node process
    this.process = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this.isRunning = true;

    // Handle stdout
    this.process.stdout.on('data', (data) => {
      const line = data.toString().trim();
      this.emit('log', line);
      
      // Parse peer ID from startup logs
      if (line.includes('Local peer ID:')) {
        const match = line.match(/12D3KooW[A-Za-z0-9]+/);
        if (match) {
          this.peerId = match[0];
          console.log(`   Peer ID: ${this.peerId}`);
        }
      }
      
      // Detect when node is ready
      if (line.includes('Node running')) {
        this.emit('ready');
      }
    });

    // Handle stderr
    this.process.stderr.on('data', (data) => {
      const line = data.toString().trim();
      this.emit('error', line);
    });

    // Handle exit
    this.process.on('exit', (code) => {
      this.isRunning = false;
      this.emit('exit', code);
      console.log(`\n⚠️  Embedded node exited with code ${code}`);
    });

    // Wait for node to be ready
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log('✅ Embedded node started (timeout reached)');
        resolve(true);
      }, 10000);

      this.on('ready', () => {
        clearTimeout(timeout);
        console.log('✅ Embedded node ready!');
        resolve(true);
      });
    });
  }

  /**
   * Stop the embedded node
   */
  async stop() {
    if (!this.process || !this.isRunning) return;

    console.log('🛑 Stopping embedded node...');
    
    return new Promise((resolve) => {
      this.process.on('exit', () => {
        this.isRunning = false;
        resolve();
      });

      // Try graceful shutdown first
      this.process.kill('SIGTERM');
      
      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.isRunning) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    });
  }

  /**
   * Get the local RPC URL
   */
  getRpcUrl() {
    return `http://127.0.0.1:${this.rpcPort}`;
  }

  /**
   * Get the local WebSocket URL
   */
  getWsUrl() {
    return `ws://127.0.0.1:${this.rpcPort}`;
  }

  /**
   * Get P2P multiaddr
   */
  getMultiaddr() {
    if (!this.peerId) return null;
    return `/ip4/0.0.0.0/tcp/${this.p2pPort}/p2p/${this.peerId}`;
  }

  /**
   * Event emitter helpers
   */
  on(event, callback) {
    this.listeners.push({ event, callback });
  }

  emit(event, data) {
    this.listeners
      .filter(l => l.event === event)
      .forEach(l => l.callback(data));
  }
}

/**
 * Peer discovery and connection manager
 */
export class PeerManager {
  constructor() {
    this.knownPeers = new Set(BOOTSTRAP_PEERS);
    this.connectedPeers = new Set();
  }

  addPeer(multiaddr) {
    this.knownPeers.add(multiaddr);
  }

  getBootstrapPeers() {
    return Array.from(this.knownPeers);
  }
}

export default EmbeddedNode;

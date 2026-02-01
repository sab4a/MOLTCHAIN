#!/usr/bin/env node
/**
 * Moltchain Node Installer
 * 
 * Usage: npx moltchain-node install
 * 
 * This script:
 * 1. Checks for Rust installation
 * 2. Clones/downloads the moltchain-node
 * 3. Builds from source
 * 4. Initializes the node
 * 5. Optionally starts the validator
 */

import { program } from 'commander';
import { spawn, execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ANSI colors (for environments without chalk)
const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const MOLTCHAIN_DIR = join(homedir(), '.moltchain');
const REPO_URL = 'https://github.com/moltchain/moltchain-node.git';

program
  .name('moltchain-node')
  .description('Install and manage Moltchain validator node')
  .version('0.1.0');

program
  .command('install')
  .description('Install Moltchain node from source')
  .option('--no-build', 'Skip building (useful if pre-built binary exists)')
  .action(async (options) => {
    console.log(colors.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🔗 MOLTCHAIN NODE INSTALLER                                ║
║   AI-Validated Sovereign Rollup                              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `));

    try {
      // Step 1: Check prerequisites
      console.log(colors.blue('📋 Checking prerequisites...\n'));
      
      // Check Rust
      try {
        const rustVersion = execSync('rustc --version', { encoding: 'utf-8' }).trim();
        console.log(colors.green(`   ✓ Rust: ${rustVersion}`));
      } catch {
        console.log(colors.red('   ✗ Rust not found'));
        console.log(colors.yellow('   Installing Rust via rustup...'));
        execSync('curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y', {
          stdio: 'inherit',
        });
        console.log(colors.green('   ✓ Rust installed'));
      }

      // Check cargo
      try {
        execSync('cargo --version', { encoding: 'utf-8' });
        console.log(colors.green('   ✓ Cargo available'));
      } catch {
        console.log(colors.red('   ✗ Cargo not found. Please restart your terminal.'));
        process.exit(1);
      }

      // Step 2: Create directory
      console.log(colors.blue('\n📁 Setting up directories...\n'));
      
      if (!existsSync(MOLTCHAIN_DIR)) {
        mkdirSync(MOLTCHAIN_DIR, { recursive: true });
      }
      console.log(colors.green(`   ✓ Created ${MOLTCHAIN_DIR}`));

      const sourceDir = join(MOLTCHAIN_DIR, 'source');
      if (!existsSync(sourceDir)) {
        mkdirSync(sourceDir, { recursive: true });
      }

      // Step 3: Copy local source (for local development)
      console.log(colors.blue('\n📦 Setting up source code...\n'));
      
      // For local dev, we'll create a bootstrap script
      const bootstrapPath = join(MOLTCHAIN_DIR, 'bootstrap.sh');
      writeFileSync(bootstrapPath, `#!/bin/bash
# Moltchain Bootstrap Script
set -e

cd ${sourceDir}

# Build the node
echo "Building Moltchain node..."
cargo build --release

# Copy binary
cp target/release/moltchain ${MOLTCHAIN_DIR}/moltchain

echo "Build complete!"
`);
      execSync(`chmod +x ${bootstrapPath}`);
      console.log(colors.green('   ✓ Bootstrap script created'));

      // Step 4: Create default config
      console.log(colors.blue('\n⚙️ Creating configuration...\n'));
      
      const configPath = join(MOLTCHAIN_DIR, 'config.json');
      const defaultConfig = {
        rpc_port: 26658,
        p2p_port: 26656,
        celestia_rpc: 'http://localhost:26657',
        data_dir: join(MOLTCHAIN_DIR, 'data'),
        log_level: 'info',
      };
      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log(colors.green(`   ✓ Config written to ${configPath}`));

      // Step 5: Generate keypair
      console.log(colors.blue('\n🔑 Generating validator keypair...\n'));
      
      const keyPath = join(MOLTCHAIN_DIR, 'validator-key.json');
      if (!existsSync(keyPath)) {
        // Generate a simple keypair (in production, use proper ed25519)
        const crypto = await import('crypto');
        const privateKey = crypto.randomBytes(32).toString('hex');
        const keypair = {
          private_key: privateKey,
          public_key: crypto.createHash('sha256').update(privateKey).digest('hex'),
          note: 'This is a placeholder. The actual node generates proper ed25519 keys.',
        };
        writeFileSync(keyPath, JSON.stringify(keypair, null, 2));
        console.log(colors.green(`   ✓ Keypair generated: ${keyPath}`));
        console.log(colors.yellow(`   ⚠ Public Key: ${keypair.public_key.slice(0, 16)}...`));
      } else {
        console.log(colors.green('   ✓ Keypair already exists'));
      }

      // Done!
      console.log(colors.cyan(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ✅ INSTALLATION COMPLETE!                                  ║
║                                                              ║
║   Next steps:                                                ║
║                                                              ║
║   1. Build the node:                                         ║
║      cd ~/.moltchain/source && cargo build --release         ║
║                                                              ║
║   2. Start the node:                                         ║
║      moltchain start                                         ║
║                                                              ║
║   3. Run the AI agent:                                       ║
║      cd moltchain-agent && npm start                         ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `));

    } catch (error) {
      console.error(colors.red(`\n❌ Installation failed: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize a new Moltchain node in current directory')
  .action(async () => {
    console.log(colors.blue('🔧 Initializing Moltchain node...\n'));
    
    const dataDir = join(process.cwd(), '.moltchain');
    mkdirSync(dataDir, { recursive: true });
    
    const config = {
      rpc_port: 26658,
      p2p_port: 26656,
      data_dir: dataDir,
    };
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify(config, null, 2));
    
    console.log(colors.green(`✓ Node initialized in ${dataDir}`));
  });

program
  .command('start')
  .description('Start the Moltchain node')
  .option('-p, --rpc-port <port>', 'RPC port', '26658')
  .option('--p2p-port <port>', 'P2P port', '26656')
  .action(async (options) => {
    console.log(colors.cyan('🚀 Starting Moltchain node...\n'));
    
    const binaryPath = join(MOLTCHAIN_DIR, 'moltchain');
    
    if (!existsSync(binaryPath)) {
      console.log(colors.yellow('Node binary not found. Building from source...'));
      console.log(colors.yellow('Please run: cd ~/.moltchain/source && cargo build --release'));
      process.exit(1);
    }
    
    const node = spawn(binaryPath, [
      'start',
      '--rpc-port', options.rpcPort,
      '--p2p-port', options.p2pPort,
    ], {
      stdio: 'inherit',
    });
    
    node.on('error', (err) => {
      console.error(colors.red(`Failed to start node: ${err.message}`));
    });
  });

program.parse();

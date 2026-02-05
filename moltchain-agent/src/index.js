#!/usr/bin/env node
/**
 * SmithNode AI Agent - P2P Validator Node
 * 
 * Each agent IS the network - true P2P architecture!
 * 
 * This agent:
 * 1. Runs its own embedded blockchain node (full peer)
 * 2. Listens for new cognitive challenges
 * 3. Solves the challenge (validates transactions)
 * 4. Signs and submits proofs to earn SMITH tokens
 * 
 * No central server - if one agent goes down, others continue!
 */

import { program } from 'commander';
import { SmithNodeAgent } from './agent.js';
import { generateKeypair, loadKeypair } from './crypto.js';
import { checkForUpdates, installUpdate, AutoUpdater, getCurrentVersion, checkAllUpdates, installBinaryUpdate, checkBinaryUpdates } from './updater.js';
import { EmbeddedNode } from './node.js';
import fs from 'fs';
import path from 'path';

program
  .name('smithnode-agent')
  .description('P2P AI Agent for SmithNode - each agent is a full network peer!')
  .version(getCurrentVersion());

program
  .command('start')
  .description('Start the AI validator agent (runs embedded P2P node by default)')
  .option('-k, --keyfile <path>', 'Path to validator keypair file', './validator-key.json')
  .option('-i, --interval <ms>', 'Polling interval in milliseconds', '5000')
  .option('--auto-update', 'Enable automatic updates (agent + binary)')
  .option('--update-interval <hours>', 'Update check interval in hours', '6')
  .option('--auto-restart', 'Auto-restart when binary is updated')
  .option('--rpc-port <port>', 'RPC port for node', '26658')
  .option('--p2p-port <port>', 'P2P port for node', '26656')
  .option('--peer <multiaddr>', 'Bootstrap peer multiaddr (can be repeated)', (val, arr) => { arr.push(val); return arr; }, [])
  .option('--full-node', 'Run as full P2P node (embeds blockchain, syncs with network)')
  .option('--local', 'Run local embedded node (isolated, no network sync)')
  .option('-r, --rpc <url>', 'RPC URL to connect to (client mode)', 'https://smithnode-rpc.fly.dev')
  .action(async (options) => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           🤖 SMITHSMITH AI VALIDATOR AGENT 🤖                 ║
║                                                              ║
║   True P2P Network - Each Agent IS the Network!             ║
║   No central server. Fully decentralized.                   ║
╚══════════════════════════════════════════════════════════════╝
`);
    
    let embeddedNode = null;
    let rpcUrl = options.rpc;
    
    if (options.fullNode) {
      // FULL SMITH MODE: True P2P - run your own node + sync with devnet
      console.log('🌐 FULL SMITH MODE: Running as true P2P peer...');
      console.log('   Your node syncs with the network and can operate independently!\n');
      
      // First, fetch current state from devnet RPC to bootstrap
      console.log('📥 Fetching current network state from devnet...');
      let devnetState = null;
      try {
        const statusResponse = await fetch(options.rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'smithnode_status',
            params: [],
            id: 1,
          }),
        });
        const statusData = await statusResponse.json();
        
        if (statusData.result) {
          console.log(`   Devnet Height: ${statusData.result.height}`);
          console.log(`   Validators: ${statusData.result.validator_count}`);
          console.log(`   Supply: ${statusData.result.total_supply} SMITH`);
          
          // Fetch full state for import
          const stateResponse = await fetch(options.rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'smithnode_exportState',
              params: [],
              id: 2,
            }),
          });
          const stateData = await stateResponse.json();
          if (stateData.result) {
            devnetState = stateData.result;
            console.log(`   ✅ State snapshot ready (${devnetState.validators.length} validators)\n`);
          }
        }
      } catch (e) {
        console.log(`   ⚠️ Could not reach devnet: ${e.message}`);
        console.log('   Starting with fresh state...\n');
      }
      
      embeddedNode = new EmbeddedNode({
        rpcPort: parseInt(options.rpcPort),
        p2pPort: parseInt(options.p2pPort),
        bootstrapPeers: options.peer,
      });
      
      const started = await embeddedNode.start();
      if (started) {
        rpcUrl = embeddedNode.getRpcUrl();
        console.log(`✅ Local P2P Node Started!`);
        console.log(`   RPC: ${rpcUrl}`);
        console.log(`   P2P: 0.0.0.0:${embeddedNode.p2pPort}`);
        
        // Import devnet state if we got it
        if (devnetState) {
          console.log(`\n📥 Syncing state from devnet...`);
          try {
            const importResponse = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'smithnode_importState',
                params: [devnetState],
                id: 3,
              }),
            });
            const importData = await importResponse.json();
            if (importData.result?.success) {
              console.log(`   ✅ State synced! Now at height ${devnetState.height}`);
              console.log(`   ✅ ${devnetState.validators.length} validators imported`);
            } else {
              console.log(`   ⚠️ State import: ${importData.result?.error || importData.error?.message || 'failed'}`);
            }
          } catch (e) {
            console.log(`   ⚠️ State import error: ${e.message}`);
          }
        }
        
        if (embeddedNode.peerId) {
          console.log(`\n🔗 Your peer address (share with others):`);
          console.log(`   /ip4/YOUR_PUBLIC_IP/tcp/${embeddedNode.p2pPort}/p2p/${embeddedNode.peerId}`);
          console.log(`\n   Others can connect: smithnode-agent start --full-node --peer "YOUR_ADDR"\n`);
        }
      } else {
        console.error('❌ Failed to start embedded node!');
        console.log('   Make sure smithnode binary is installed:');
        console.log('   npx smithnode-node-cli install\n');
        console.log('   Falling back to client mode...\n');
      }
    } else if (options.local) {
      // LOCAL MODE: Isolated node (for testing)
      console.log('🌐 LOCAL MODE: Starting isolated node (no network sync)...');
      console.log('   This creates a fresh chain, not connected to devnet\n');
      
      embeddedNode = new EmbeddedNode({
        rpcPort: parseInt(options.rpcPort),
        p2pPort: parseInt(options.p2pPort),
        bootstrapPeers: [], // No bootstrap = isolated
      });
      
      const started = await embeddedNode.start();
      if (started) {
        rpcUrl = embeddedNode.getRpcUrl();
        console.log(`\n✅ Local Node Active!`);
        console.log(`   RPC: ${rpcUrl}`);
        console.log(`   P2P: 0.0.0.0:${embeddedNode.p2pPort}`);
        
        if (embeddedNode.peerId) {
          console.log(`\n🔗 Share this with other agents to connect:`);
          console.log(`   smithnode-agent start --peer "/ip4/YOUR_PUBLIC_IP/tcp/${embeddedNode.p2pPort}/p2p/${embeddedNode.peerId}"\n`);
        }
      } else {
        console.error('❌ Failed to start embedded node!');
        console.log('   Make sure smithnode binary is installed:');
        console.log('   npx smithnode-node-cli install\n');
        process.exit(1);
      }
    } else {
      // DEFAULT: Client mode - connect to devnet RPC (easiest)
      console.log('🌐 CLIENT MODE: Connecting to SmithNode devnet...');
      console.log(`   RPC: ${rpcUrl}`);
      console.log('   ⚠️  Depends on central RPC - not true P2P');
      console.log('   💡 Use --full-node for true decentralization\n');
    }
    
    // Start auto-updater if enabled
    let updater = null;
    if (options.autoUpdate) {
      updater = new AutoUpdater({
        checkInterval: parseInt(options.updateInterval) * 60 * 60 * 1000,
        autoInstall: true,
        restartOnBinaryUpdate: options.autoRestart,
        onUpdate: (results) => {
          console.log('\n⚠️ Updates installed!');
          if (results.binary?.success) {
            console.log('🔄 Binary updated - restart required for node');
          }
          if (results.agent?.success) {
            console.log('🔄 Agent updated - restart required');
          }
        }
      });
      updater.start();
    }
    
    // Load or generate keypair
    let keypair;
    if (fs.existsSync(options.keyfile)) {
      console.log(`📂 Loading keypair from ${options.keyfile}`);
      keypair = loadKeypair(options.keyfile);
    } else {
      console.log('🔑 No keypair found, generating new one...');
      keypair = await generateKeypair();
      fs.writeFileSync(options.keyfile, JSON.stringify(keypair, null, 2));
      console.log(`💾 Keypair saved to ${options.keyfile}`);
    }
    
    console.log(`🔐 Validator Public Key: ${keypair.publicKey}`);
    
    const agent = new SmithNodeAgent({
      rpcUrl: rpcUrl, // Use embedded node URL or provided URL
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      pollingInterval: parseInt(options.interval),
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n👋 Shutting down...');
      agent.stop();
      if (updater) updater.stop();
      if (embeddedNode) await embeddedNode.stop();
      process.exit(0);
    });
    
    await agent.start();
  });

program
  .command('keygen')
  .description('Generate a new validator keypair')
  .option('-o, --output <path>', 'Output file path', './validator-key.json')
  .action(async (options) => {
    console.log('🔑 Generating new validator keypair...');
    const keypair = await generateKeypair();
    
    fs.writeFileSync(options.output, JSON.stringify(keypair, null, 2));
    console.log(`✅ Keypair saved to ${options.output}`);
    console.log(`📍 Public Key: ${keypair.publicKey}`);
  });

program
  .command('register')
  .description('Register as a validator on the network')
  .option('-r, --rpc <url>', 'SmithNode node RPC URL', 'https://smithnode-rpc.fly.dev')
  .option('-k, --keyfile <path>', 'Path to validator keypair file', './validator-key.json')
  .action(async (options) => {
    if (!fs.existsSync(options.keyfile)) {
      console.error('❌ Keypair file not found. Run "smithnode-agent keygen" first.');
      process.exit(1);
    }
    
    const keypair = loadKeypair(options.keyfile);
    console.log(`📝 Registering validator: ${keypair.publicKey}`);
    
    const response = await fetch(options.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'smithnode_registerValidator',
        params: [{ public_key: keypair.publicKey }],
      }),
    });
    
    const result = await response.json();
    if (result.result?.success) {
      console.log('✅ Successfully registered as validator!');
    } else {
      console.error('❌ Registration failed:', result.result?.error || result.error);
    }
  });

program
  .command('update')
  .description('Check for and install updates (agent + binary)')
  .option('--check-only', 'Only check, do not install')
  .option('--agent-only', 'Only update npm agent package')
  .option('--binary-only', 'Only update Rust binary')
  .action(async (options) => {
    console.log('🔍 Checking for updates...\n');
    
    if (options.agentOnly) {
      // Only npm package
      await checkForUpdates({ autoInstall: !options.checkOnly });
    } else if (options.binaryOnly) {
      // Only binary
      const release = await checkBinaryUpdates();
      if (release && !options.checkOnly) {
        await installBinaryUpdate(release);
      } else if (release) {
        console.log(`📦 Latest binary: ${release.version}`);
        console.log('💡 Run without --check-only to install');
      }
    } else {
      // Both
      const results = await checkAllUpdates({ autoInstall: !options.checkOnly });
      
      if (options.checkOnly) {
        if (results.agent?.updateAvailable) {
          console.log('\n💡 Run "smithnode-agent update" to install agent update');
        }
        if (results.binary?.updateAvailable) {
          console.log('💡 Run "smithnode-agent update" to install binary update');
        }
      }
    }
  });

program
  .command('status')
  .description('Check node and validator status')
  .option('-r, --rpc <url>', 'SmithNode node RPC URL', 'https://smithnode-rpc.fly.dev')
  .option('-k, --keyfile <path>', 'Path to validator keypair file', './validator-key.json')
  .action(async (options) => {
    // Get node status
    const statusRes = await fetch(options.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'smithnode_status',
        params: [],
      }),
    });
    
    const status = await statusRes.json();
    console.log('\n📊 Node Status:');
    console.log(`   Height: ${status.result?.height}`);
    console.log(`   State Root: ${status.result?.state_root}`);
    console.log(`   Total Supply: ${status.result?.total_supply} SMITH`);
    console.log(`   Validators: ${status.result?.validator_count}`);
    console.log(`   Active Challenge: ${status.result?.has_active_challenge ? 'Yes' : 'No'}`);
    
    // Get validator info if keyfile exists
    if (fs.existsSync(options.keyfile)) {
      const keypair = loadKeypair(options.keyfile);
      
      const validatorRes = await fetch(options.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'smithnode_getValidator',
          params: [keypair.publicKey],
        }),
      });
      
      const validator = await validatorRes.json();
      if (validator.result) {
        console.log('\n🤖 Validator Status:');
        console.log(`   Balance: ${validator.result.balance} SMITH`);
        console.log(`   Validations: ${validator.result.validations_count}`);
        console.log(`   Reputation: ${validator.result.reputation_score}`);
      }
    }
  });

// =============================================================================
// DAEMON MANAGEMENT - Auto-start on system boot
// =============================================================================

const daemonCmd = program
  .command('daemon')
  .description('Manage agent as a system service (auto-start on boot)');

daemonCmd
  .command('install')
  .description('Install agent as a system service')
  .option('-k, --keyfile <path>', 'Path to validator keypair file', './validator-key.json')
  .option('--auto-update', 'Enable automatic updates')
  .action(async (options) => {
    const platform = process.platform;
    const agentDir = process.cwd();
    const keyfilePath = path.resolve(options.keyfile);
    const nodePath = process.execPath;
    const indexPath = path.join(agentDir, 'src', 'index.js');
    
    // Build the command args
    let args = ['start', '-k', keyfilePath];
    if (options.autoUpdate) args.push('--auto-update');
    
    if (platform === 'darwin') {
      // macOS: Use launchd
      const plistName = 'com.smithnode.agent';
      const plistPath = path.join(process.env.HOME, 'Library', 'LaunchAgents', `${plistName}.plist`);
      const logPath = path.join(process.env.HOME, 'Library', 'Logs', 'smithnode-agent.log');
      
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plistName}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${indexPath}</string>
${args.map(a => `        <string>${a}</string>`).join('\n')}
    </array>
    <key>WorkingDirectory</key>
    <string>${agentDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>`;
      
      // Ensure LaunchAgents directory exists
      const launchAgentsDir = path.dirname(plistPath);
      if (!fs.existsSync(launchAgentsDir)) {
        fs.mkdirSync(launchAgentsDir, { recursive: true });
      }
      
      fs.writeFileSync(plistPath, plistContent);
      console.log(`✅ Created launchd plist: ${plistPath}`);
      console.log(`📋 Log file: ${logPath}`);
      console.log(`\n🚀 To start the daemon now, run:`);
      console.log(`   launchctl load ${plistPath}`);
      console.log(`\n📊 To check status:`);
      console.log(`   launchctl list | grep smithnode`);
      console.log(`\n🛑 To stop:`);
      console.log(`   launchctl unload ${plistPath}`);
      
    } else if (platform === 'linux') {
      // Linux: Use systemd
      const serviceName = 'smithnode-agent';
      const servicePath = path.join(process.env.HOME, '.config', 'systemd', 'user', `${serviceName}.service`);
      
      const serviceContent = `[Unit]
Description=SmithNode AI Validator Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=${agentDir}
ExecStart=${nodePath} ${indexPath} ${args.join(' ')}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
      
      // Ensure systemd user directory exists
      const systemdDir = path.dirname(servicePath);
      if (!fs.existsSync(systemdDir)) {
        fs.mkdirSync(systemdDir, { recursive: true });
      }
      
      fs.writeFileSync(servicePath, serviceContent);
      console.log(`✅ Created systemd service: ${servicePath}`);
      console.log(`\n🚀 To enable and start the daemon, run:`);
      console.log(`   systemctl --user daemon-reload`);
      console.log(`   systemctl --user enable ${serviceName}`);
      console.log(`   systemctl --user start ${serviceName}`);
      console.log(`\n📊 To check status:`);
      console.log(`   systemctl --user status ${serviceName}`);
      console.log(`\n📋 To view logs:`);
      console.log(`   journalctl --user -u ${serviceName} -f`);
      console.log(`\n🛑 To stop:`);
      console.log(`   systemctl --user stop ${serviceName}`);
      
    } else if (platform === 'win32') {
      // Windows: Create a batch script for Task Scheduler
      const batPath = path.join(agentDir, 'start-agent.bat');
      const batContent = `@echo off
cd /d "${agentDir}"
"${nodePath}" "${indexPath}" ${args.join(' ')}
`;
      fs.writeFileSync(batPath, batContent);
      console.log(`✅ Created startup script: ${batPath}`);
      console.log(`\n🚀 To auto-start on Windows:`);
      console.log(`   1. Open Task Scheduler (taskschd.msc)`);
      console.log(`   2. Create Basic Task > "SmithNode Agent"`);
      console.log(`   3. Trigger: "When the computer starts"`);
      console.log(`   4. Action: Start a program > "${batPath}"`);
      console.log(`   5. Check "Run whether user is logged on or not"`);
    } else {
      console.log(`❌ Unsupported platform: ${platform}`);
      console.log('   Supported: macOS (darwin), Linux, Windows');
    }
  });

daemonCmd
  .command('uninstall')
  .description('Remove the system service')
  .action(async () => {
    const platform = process.platform;
    
    if (platform === 'darwin') {
      const plistPath = path.join(process.env.HOME, 'Library', 'LaunchAgents', 'com.smithnode.agent.plist');
      
      if (fs.existsSync(plistPath)) {
        console.log('🛑 Unloading daemon...');
        const { execSync } = await import('child_process');
        try {
          execSync(`launchctl unload ${plistPath}`, { stdio: 'inherit' });
        } catch (e) {
          // May fail if not loaded, that's ok
        }
        fs.unlinkSync(plistPath);
        console.log('✅ Daemon uninstalled');
      } else {
        console.log('ℹ️  Daemon not installed');
      }
      
    } else if (platform === 'linux') {
      const servicePath = path.join(process.env.HOME, '.config', 'systemd', 'user', 'smithnode-agent.service');
      
      if (fs.existsSync(servicePath)) {
        console.log('🛑 Stopping and disabling daemon...');
        const { execSync } = await import('child_process');
        try {
          execSync('systemctl --user stop smithnode-agent', { stdio: 'inherit' });
          execSync('systemctl --user disable smithnode-agent', { stdio: 'inherit' });
        } catch (e) {
          // May fail if not running
        }
        fs.unlinkSync(servicePath);
        console.log('✅ Daemon uninstalled');
      } else {
        console.log('ℹ️  Daemon not installed');
      }
      
    } else if (platform === 'win32') {
      const batPath = path.join(process.cwd(), 'start-agent.bat');
      if (fs.existsSync(batPath)) {
        fs.unlinkSync(batPath);
        console.log('✅ Startup script removed');
        console.log('ℹ️  Remember to remove the task from Task Scheduler manually');
      } else {
        console.log('ℹ️  Startup script not found');
      }
    }
  });

daemonCmd
  .command('status')
  .description('Check if daemon is running')
  .action(async () => {
    const platform = process.platform;
    const { execSync } = await import('child_process');
    
    try {
      if (platform === 'darwin') {
        const result = execSync('launchctl list | grep smithnode', { encoding: 'utf-8' });
        if (result.includes('smithnode')) {
          const parts = result.trim().split(/\s+/);
          const pid = parts[0];
          const status = parts[1];
          console.log('✅ Daemon is running');
          console.log(`   PID: ${pid === '-' ? 'Not running' : pid}`);
          console.log(`   Exit status: ${status}`);
        }
      } else if (platform === 'linux') {
        execSync('systemctl --user status smithnode-agent', { stdio: 'inherit' });
      } else {
        console.log('ℹ️  Check Task Scheduler for status on Windows');
      }
    } catch (e) {
      console.log('ℹ️  Daemon not running or not installed');
    }
  });

daemonCmd
  .command('logs')
  .description('View daemon logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Number of lines to show', '50')
  .action(async (options) => {
    const platform = process.platform;
    const { spawn } = await import('child_process');
    
    if (platform === 'darwin') {
      const logPath = path.join(process.env.HOME, 'Library', 'Logs', 'smithnode-agent.log');
      if (fs.existsSync(logPath)) {
        const args = options.follow 
          ? ['-f', '-n', options.lines, logPath]
          : ['-n', options.lines, logPath];
        spawn('tail', args, { stdio: 'inherit' });
      } else {
        console.log('ℹ️  No logs found. Has the daemon started?');
      }
    } else if (platform === 'linux') {
      const args = ['--user', '-u', 'smithnode-agent', '-n', options.lines];
      if (options.follow) args.push('-f');
      spawn('journalctl', args, { stdio: 'inherit' });
    } else {
      console.log('ℹ️  Check Task Scheduler logs on Windows');
    }
  });

program.parse();

#!/usr/bin/env node
/**
 * Moltchain AI Agent - Validator Client
 * 
 * This agent connects to a Moltchain node and:
 * 1. Listens for new cognitive challenges
 * 2. Solves the challenge (validates transactions)
 * 3. Signs and submits proofs to earn MOLT tokens
 * 4. Socializes on Moltbook (AI social network)
 */

import { program } from 'commander';
import { MoltchainAgent } from './agent.js';
import { generateKeypair, loadKeypair } from './crypto.js';
import { checkForUpdates, installUpdate, AutoUpdater, getCurrentVersion, checkAllUpdates, installBinaryUpdate, checkBinaryUpdates } from './updater.js';
import { MoltbookManager, registerOnMoltbook, loadCredentials, checkClaimStatus, postToMoltbook, getFeed } from './moltbook.js';
import { EmbeddedNode } from './node.js';
import fs from 'fs';
import path from 'path';

program
  .name('moltchain-agent')
  .description('AI Agent for Moltchain validator network')
  .version(getCurrentVersion());

program
  .command('start')
  .description('Start the AI validator agent')
  .option('-r, --rpc <url>', 'Moltchain node RPC URL (auto-detect if running embedded)')
  .option('-k, --keyfile <path>', 'Path to validator keypair file', './validator-key.json')
  .option('-i, --interval <ms>', 'Polling interval in milliseconds', '5000')
  .option('--auto-update', 'Enable automatic updates (agent + binary)')
  .option('--update-interval <hours>', 'Update check interval in hours', '6')
  .option('--auto-restart', 'Auto-restart when binary is updated')
  .option('--moltbook', 'Enable Moltbook social integration')
  .option('--embedded', 'Run embedded node (true P2P mode - each agent is a full peer)')
  .option('--rpc-port <port>', 'RPC port for embedded node', '26658')
  .option('--p2p-port <port>', 'P2P port for embedded node', '26656')
  .option('--peer <multiaddr>', 'Bootstrap peer multiaddr (can be repeated)', (val, arr) => { arr.push(val); return arr; }, [])
  .action(async (options) => {
    console.log('🤖 Starting Moltchain AI Validator Agent...');
    
    // Start embedded node if requested
    let embeddedNode = null;
    let rpcUrl = options.rpc || 'http://127.0.0.1:26658';
    
    if (options.embedded) {
      console.log('\n🌐 TRUE P2P MODE: Running as a full peer node');
      console.log('   Each agent IS the network - no central server needed!\n');
      
      embeddedNode = new EmbeddedNode({
        rpcPort: parseInt(options.rpcPort),
        p2pPort: parseInt(options.p2pPort),
        bootstrapPeers: options.peer,
      });
      
      const started = await embeddedNode.start();
      if (started) {
        rpcUrl = embeddedNode.getRpcUrl();
        console.log(`\n📡 Embedded node RPC: ${rpcUrl}`);
        
        if (embeddedNode.peerId) {
          console.log(`🔗 Share this with other agents to connect:`);
          console.log(`   --peer "/ip4/YOUR_IP/tcp/${embeddedNode.p2pPort}/p2p/${embeddedNode.peerId}"`);
        }
      } else {
        console.log('⚠️  Falling back to client mode (connecting to external node)');
      }
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
    
    // Start Moltbook integration if enabled
    let moltbook = null;
    if (options.moltbook) {
      moltbook = new MoltbookManager();
      await moltbook.start();
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
    
    const agent = new MoltchainAgent({
      rpcUrl: rpcUrl, // Use embedded node URL or provided URL
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      pollingInterval: parseInt(options.interval),
      moltbook: moltbook, // Pass moltbook manager
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
  .option('-r, --rpc <url>', 'Moltchain node RPC URL', 'http://127.0.0.1:26658')
  .option('-k, --keyfile <path>', 'Path to validator keypair file', './validator-key.json')
  .action(async (options) => {
    if (!fs.existsSync(options.keyfile)) {
      console.error('❌ Keypair file not found. Run "moltchain-agent keygen" first.');
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
        method: 'moltchain_registerValidator',
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
          console.log('\n💡 Run "moltchain-agent update" to install agent update');
        }
        if (results.binary?.updateAvailable) {
          console.log('💡 Run "moltchain-agent update" to install binary update');
        }
      }
    }
  });

program
  .command('status')
  .description('Check node and validator status')
  .option('-r, --rpc <url>', 'Moltchain node RPC URL', 'http://127.0.0.1:26658')
  .option('-k, --keyfile <path>', 'Path to validator keypair file', './validator-key.json')
  .action(async (options) => {
    // Get node status
    const statusRes = await fetch(options.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'moltchain_status',
        params: [],
      }),
    });
    
    const status = await statusRes.json();
    console.log('\n📊 Node Status:');
    console.log(`   Height: ${status.result?.height}`);
    console.log(`   State Root: ${status.result?.state_root}`);
    console.log(`   Total Supply: ${status.result?.total_supply} MOLT`);
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
          method: 'moltchain_getValidator',
          params: [keypair.publicKey],
        }),
      });
      
      const validator = await validatorRes.json();
      if (validator.result) {
        console.log('\n🤖 Validator Status:');
        console.log(`   Balance: ${validator.result.balance} MOLT`);
        console.log(`   Validations: ${validator.result.validations_count}`);
        console.log(`   Reputation: ${validator.result.reputation_score}`);
      }
    }
    
    // Check Moltbook status
    const moltbookCreds = loadCredentials();
    if (moltbookCreds?.api_key) {
      const mbStatus = await checkClaimStatus(moltbookCreds.api_key);
      console.log('\n🦞 Moltbook Status:');
      console.log(`   Account: ${moltbookCreds.agent_name || 'Unknown'}`);
      console.log(`   Status: ${mbStatus === 'claimed' ? '✅ Active' : '⏳ Pending claim'}`);
    } else {
      console.log('\n🦞 Moltbook: Not configured');
      console.log('   Run "moltchain-agent moltbook register" to join!');
    }
  });

// ==================== MOLTBOOK COMMANDS ====================

const moltbookCmd = program
  .command('moltbook')
  .description('Moltbook social network commands');

moltbookCmd
  .command('register')
  .description('Register on Moltbook (AI social network)')
  .option('-n, --name <name>', 'Your agent name')
  .option('-d, --description <desc>', 'Description of your agent')
  .action(async (options) => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🦞 MOLTBOOK                               ║
║           A Social Network for AI Agents                     ║
║   Where AI agents share, discuss, and upvote.               ║
║              Humans welcome to observe.                      ║
╚══════════════════════════════════════════════════════════════╝
`);
    
    const name = options.name || `MoltchainValidator_${Math.random().toString(36).slice(2, 8)}`;
    const description = options.description || 'AI validator on Moltchain - the blockchain validated by AI agents. Earning MOLT tokens by validating transactions!';
    
    console.log(`📝 Registering as: ${name}`);
    console.log(`📝 Description: ${description}\n`);
    
    const result = await registerOnMoltbook(name, description);
    
    if (result) {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    ✅ REGISTERED!                            ║
╚══════════════════════════════════════════════════════════════╝

Next steps:
1. Send your human the claim URL above
2. They'll post a verification tweet
3. Once claimed, you can start posting!

To start your agent with Moltbook:
  moltchain-agent start --moltbook

Join Moltbook 🦞
`);
    }
  });

moltbookCmd
  .command('status')
  .description('Check your Moltbook account status')
  .action(async () => {
    const creds = loadCredentials();
    
    if (!creds?.api_key) {
      console.log('❌ Not registered on Moltbook');
      console.log('   Run "moltchain-agent moltbook register" to join!');
      return;
    }
    
    console.log('🦞 Checking Moltbook status...\n');
    
    const status = await checkClaimStatus(creds.api_key);
    
    console.log(`Agent Name: ${creds.agent_name || 'Unknown'}`);
    console.log(`Status: ${status === 'claimed' ? '✅ Claimed & Active' : '⏳ Pending claim'}`);
    
    if (status !== 'claimed' && creds.claim_url) {
      console.log(`\n👤 Send your human this link to claim:`);
      console.log(`   ${creds.claim_url}`);
    }
  });

moltbookCmd
  .command('post')
  .description('Post to Moltbook')
  .option('-s, --submolt <name>', 'Submolt to post to', 'general')
  .option('-t, --title <title>', 'Post title')
  .option('-c, --content <content>', 'Post content')
  .action(async (options) => {
    const creds = loadCredentials();
    
    if (!creds?.api_key) {
      console.log('❌ Not registered on Moltbook');
      return;
    }
    
    if (!options.title || !options.content) {
      console.log('❌ Title and content required');
      console.log('   Example: moltchain-agent moltbook post -t "Hello!" -c "My first post"');
      return;
    }
    
    console.log('🦞 Posting to Moltbook...');
    
    const result = await postToMoltbook(
      creds.api_key,
      options.submolt,
      options.title,
      options.content
    );
    
    if (result.success) {
      console.log('✅ Posted successfully!');
      console.log(`   View at: https://www.moltbook.com/m/${options.submolt}`);
    } else {
      console.log('❌ Failed to post:', result.error);
    }
  });

moltbookCmd
  .command('feed')
  .description('Check your Moltbook feed')
  .option('-s, --sort <sort>', 'Sort by: hot, new, top', 'hot')
  .option('-l, --limit <n>', 'Number of posts', '5')
  .action(async (options) => {
    const creds = loadCredentials();
    
    if (!creds?.api_key) {
      console.log('❌ Not registered on Moltbook');
      return;
    }
    
    console.log('🦞 Fetching Moltbook feed...\n');
    
    const result = await getFeed(creds.api_key, options.sort, parseInt(options.limit));
    
    if (result.success && result.data?.length > 0) {
      for (const post of result.data) {
        console.log(`📝 ${post.title}`);
        console.log(`   by ${post.author?.name || 'Unknown'} in m/${post.submolt?.name || 'general'}`);
        console.log(`   ⬆️ ${post.upvotes || 0}  💬 ${post.comment_count || 0}`);
        console.log('');
      }
    } else {
      console.log('No posts found in feed');
    }
  });

program.parse();

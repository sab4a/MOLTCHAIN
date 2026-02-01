#!/usr/bin/env node
/**
 * Moltchain AI Agent - Validator Client
 * 
 * This agent connects to a Moltchain node and:
 * 1. Listens for new cognitive challenges
 * 2. Solves the challenge (validates transactions)
 * 3. Signs and submits proofs to earn MOLT tokens
 */

import { program } from 'commander';
import { MoltchainAgent } from './agent.js';
import { generateKeypair, loadKeypair } from './crypto.js';
import { checkForUpdates, installUpdate, AutoUpdater, getCurrentVersion } from './updater.js';
import fs from 'fs';
import path from 'path';

program
  .name('moltchain-agent')
  .description('AI Agent for Moltchain validator network')
  .version(getCurrentVersion());

program
  .command('start')
  .description('Start the AI validator agent')
  .option('-r, --rpc <url>', 'Moltchain node RPC URL', 'http://127.0.0.1:26658')
  .option('-k, --keyfile <path>', 'Path to validator keypair file', './validator-key.json')
  .option('-i, --interval <ms>', 'Polling interval in milliseconds', '5000')
  .option('--auto-update', 'Enable automatic updates')
  .option('--update-interval <hours>', 'Update check interval in hours', '6')
  .action(async (options) => {
    console.log('🤖 Starting Moltchain AI Validator Agent...');
    
    // Start auto-updater if enabled
    let updater = null;
    if (options.autoUpdate) {
      updater = new AutoUpdater({
        checkInterval: parseInt(options.updateInterval) * 60 * 60 * 1000,
        autoInstall: true,
        onUpdate: (result) => {
          console.log('\n⚠️ Agent updated! Please restart to apply changes.');
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
    
    const agent = new MoltchainAgent({
      rpcUrl: options.rpc,
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      pollingInterval: parseInt(options.interval),
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down...');
      if (updater) updater.stop();
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
  .description('Check for and install updates')
  .option('--check-only', 'Only check, do not install')
  .action(async (options) => {
    console.log('🔍 Checking for updates...\n');
    
    const result = await checkForUpdates({ 
      autoInstall: !options.checkOnly 
    });
    
    if (result.updateAvailable && options.checkOnly) {
      console.log('\n💡 Run "moltchain-agent update" to install');
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
  });

program.parse();
